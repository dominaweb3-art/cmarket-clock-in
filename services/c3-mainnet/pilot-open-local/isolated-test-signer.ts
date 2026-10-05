/** Disposable PostgreSQL / ephemeral child-process quote signer ONLY.
 * Private key is generated inside the child and never exported or persisted.
 * IPC accepts a durable record ID + expected hash, never trusted context/bytes.
 * No production key loader, fallback, wallet signing or transaction submission.
 */
import { fork, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { QuoteAuthoritySigner } from "../src/quote-seal.ts";
import { loadOpenSignerRecord } from "./open-quote.ts";
import { OpenSigningJournal } from "../src/open-signing-journal.ts";
import { VerifiedOpenRecordSigner } from "../src/open-record-signer.ts";
import { encodeBase58 } from "../src/solana.ts";
import type { SettlementServerPolicy } from "../src/open-leg-factory.ts";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
type Message = {
  kind: string;
  request?: number;
  id?: string;
  hash?: string;
  publicKey?: string;
  signature?: string;
  error?: string;
};
const disposable = () => {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
    url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE ||
    url.username !== process.env.C3_DISPOSABLE_TEST_DATABASE
  )
    throw new Error("C3_OPEN_SIGNER_DISPOSABLE_DB_REQUIRED");
  return url.toString();
};
export class IsolatedOpenTestSigner implements QuoteAuthoritySigner {
  readonly publicKey: Uint8Array;
  private readonly child: ChildProcess;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (b: Buffer) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private constructor(child: ChildProcess, publicKey: Buffer) {
    this.child = child;
    this.publicKey = Buffer.from(publicKey);
    child.on("message", (m: Message) => {
      const request = this.pending.get(m.request ?? -1);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(m.request!);
      if (m.kind === "signature" && /^[a-f0-9]{128}$/.test(m.signature ?? ""))
        request.resolve(Buffer.from(m.signature!, "hex"));
      else
        request.reject(
          new Error(
            /^C3_[A-Z0-9_]+$/.test(m.error ?? "")
              ? m.error!
              : "C3_OPEN_SIGNER_REJECTED",
          ),
        );
    });
    child.on("exit", () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("C3_OPEN_SIGNER_EXITED"));
      }
      this.pending.clear();
    });
  }
  static async start(): Promise<IsolatedOpenTestSigner> {
    const database = disposable();
    const child = fork(fileURLToPath(import.meta.url), [], {
      execArgv: ["--experimental-strip-types"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        DATABASE_URL: database,
        C3_DISPOSABLE_TEST_DATABASE: process.env.C3_DISPOSABLE_TEST_DATABASE!,
        C3_OPEN_EPHEMERAL_SIGNER: "1",
      },
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("C3_OPEN_SIGNER_START_TIMEOUT"));
      }, 8000);
      child.once("error", () => {
        clearTimeout(timer);
        child.kill();
        reject(new Error("C3_OPEN_SIGNER_START_FAILED"));
      });
      child.once("message", (m: Message) => {
        clearTimeout(timer);
        if (m.kind !== "ready" || !/^[a-f0-9]{64}$/.test(m.publicKey ?? "")) {
          child.kill();
          reject(new Error("C3_OPEN_SIGNER_START_FAILED"));
          return;
        }
        resolve(
          new IsolatedOpenTestSigner(child, Buffer.from(m.publicKey!, "hex")),
        );
      });
    });
  }
  async signCanonicalBytes(bytes: Uint8Array): Promise<Uint8Array> {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length !== 300 ||
      !this.child.connected
    )
      throw new Error("C3_OPEN_SIGNER_INVALID_REQUEST");
    const request = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request);
        this.child.kill();
        reject(new Error("C3_OPEN_SIGNER_TIMEOUT"));
      }, 8000);
      this.pending.set(request, { resolve, reject, timer });
      this.child.send(
        {
          kind: "sign",
          request,
          id: Buffer.from(bytes).subarray(49, 81).toString("hex"),
          hash: hash(bytes),
        },
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(request);
            reject(new Error("C3_OPEN_SIGNER_IPC_FAILED"));
          }
        },
      );
    });
  }
  close(): void {
    this.child.kill();
  }
}
if (process.env.C3_OPEN_EPHEMERAL_SIGNER === "1") {
  const pool = new pg.Pool({
    connectionString: disposable(),
    max: 1,
  });
  const key = generateKeyPairSync("ed25519"),
    publicKey = Buffer.from(
      key.publicKey.export({ format: "der", type: "spki" }),
    ).subarray(-32);
  await pool.query("SELECT 1");
  process.send?.({ kind: "ready", publicKey: publicKey.toString("hex") });
  let queue = Promise.resolve();
  const localResults = new Map<string, Buffer>();
  const provider = {
    publicKey,
    signIdempotently: async (id: string, bytes: Uint8Array) => {
      const result = localResults.get(id) ?? sign(null, bytes, key.privateKey);
      localResults.set(id, result);
      return result;
    },
    lookupSignature: async (id: string) => localResults.get(id) ?? null,
  };
  const journal = new OpenSigningJournal(pool, provider);
  process.on("message", (m: Message) => {
    queue = queue.then(async () => {
      try {
        if (
          m.kind !== "sign" ||
          !Number.isSafeInteger(m.request) ||
          !/^[a-f0-9]{64}$/.test(m.id ?? "") ||
          !/^[a-f0-9]{64}$/.test(m.hash ?? "")
        )
          throw new Error("C3_OPEN_SIGNER_INVALID_REQUEST");
        const verified = (
          await pool.query(
            "SELECT q.*,v.context,v.scope,i.share_mint FROM c3_open.quote_authorizations q JOIN c3_open.all_quote_contexts v USING(intent_id,ordinal,intent_revision) JOIN c3_open.intents i USING(intent_id) WHERE encode(q.quote_id,'hex')=$1",
            [m.id],
          )
        ).rows[0];
        if (verified?.scope === "ISOLATED_VERIFIED") {
          const ctx = verified.context;
          const policy: SettlementServerPolicy = {
            programId: "HTc3na8WFnsExbV1oxutKhTxyWE9PEsVRhjjkXAhajwV",
            idlHash: verified.evidence.idlHash ?? "test-only",
            configurationHash: ctx.configurationHash,
            vault: ctx.vault,
            wallet: ctx.wallet,
            shareMint: verified.share_mint,
            governance: ctx.governance,
            keeper: ctx.keeper,
            quoteAuthority: encodeBase58(Buffer.from(ctx.authority, "hex")),
            registry: ctx.registry,
            registryRevision: ctx.registryRevision,
            registryHash: ctx.registryHash,
            quotePolicy: ctx.policy,
            quotePolicyRevision: ctx.policyRevision,
            maxSlippageBps: ctx.maxSlippageBps,
          };
          const signature = await new VerifiedOpenRecordSigner(
            pool,
            provider,
            policy,
            encodeBase58(Buffer.from(ctx.genesisHash, "hex")),
            "ISOLATED_VERIFIED",
          ).signRecord(m.id!, m.hash!);
          process.send?.({
            kind: "signature",
            request: m.request,
            signature: Buffer.from(signature).toString("hex"),
          });
          return;
        }
        const row = await loadOpenSignerRecord(pool, m.id!, publicKey);
        if (hash(row.canonical_payload) !== m.hash)
          throw new Error("C3_OPEN_SIGNER_PERSISTED_BYTES_MISMATCH");
        const signature =
          row.signature ??
          (await journal.obtain(
            row.quote_id,
            row.canonical_payload,
            publicKey,
          ));
        process.send?.({
          kind: "signature",
          request: m.request,
          signature: signature.toString("hex"),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        process.send?.({
          kind: "error",
          request: m.request,
          error: /^C3_[A-Z0-9_]+$/.test(message)
            ? message
            : "C3_OPEN_SIGNER_REJECTED",
        });
      }
    });
  });
  process.on("disconnect", () => {
    void pool.end().finally(() => process.exit(0));
  });
}
