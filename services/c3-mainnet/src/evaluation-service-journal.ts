/** SHARED. Devnet service identities only; never wallet authorization/custody.
 * Durable single dispatch. Uncertain results require original-signature lookup.
 * No key loader, runtime endpoint, Mainnet configuration or automatic retry. */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import type { Pool } from "pg";
import { EVALUATION } from "./evaluation-scope.ts";

export type EvaluationServicePurpose =
  "assets" | "wallet" | "faucet" | "plan" | "authorize" | "execute" | "record";
export type EvaluationPacketSigner = Readonly<{
  publicKey: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}>;
export type EvaluationPacket = Readonly<{
  operationId: string;
  scope: string;
  purpose: EvaluationServicePurpose;
  packet: Buffer;
  lastValidBlockHeight: number;
}>;
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_SERVICE_" + code);
};
export function evaluationOperationId(
  scope: string,
  purpose: string,
  generation: string,
) {
  check(
    scope.length > 0 && scope.length <= 160 && generation.length > 0,
    "IDENTITY",
  );
  return hash(
    JSON.stringify(["evaluation-service-v1", scope, purpose, generation]),
  ).toString("hex");
}
export function inspectEvaluationServicePacket(
  packet: Uint8Array,
  signer: string,
) {
  check(packet.length <= 1232, "SIZE");
  const tx = VersionedTransaction.deserialize(packet);
  check(
    tx.version === 0 && tx.message.addressTableLookups.length === 0,
    "VERSION",
  );
  check(
    tx.message.header.numRequiredSignatures === 1 && tx.signatures.length === 1,
    "SIGNERS",
  );
  check(tx.message.staticAccountKeys[0]!.toBase58() === signer, "PAYER");
  check(
    tx.signatures[0]!.every((v) => v === 0),
    "ALREADY_SIGNED",
  );
  check(
    [
      EVALUATION.governance,
      EVALUATION.keeper,
      "FUfbAJQMsm6fvmdfduNLBDDZajjZTSmjhaKq6Eew3tZq",
    ].includes(signer),
    "IDENTITY",
  );
  const programs = new Set([
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "Ed25519SigVerify111111111111111111111111111",
    EVALUATION.program,
  ]);
  check(
    tx.message.compiledInstructions.length > 0 &&
      tx.message.compiledInstructions.every((i) =>
        programs.has(
          tx.message.staticAccountKeys[i.programIdIndex]!.toBase58(),
        ),
      ),
    "PROGRAM",
  );
  return {
    tx,
    message: Buffer.from(tx.message.serialize()),
    messageHash: hash(tx.message.serialize()),
  };
}

export class EvaluationServiceJournal {
  private readonly pool: Pool;
  private readonly rpc: Connection;
  constructor(pool: Pool) {
    this.pool = pool;
    this.rpc = new Connection("https://api.devnet.solana.com", {
      commitment: "finalized",
      disableRetryOnRateLimit: true,
    });
  }
  async dispatch(input: EvaluationPacket, signer: EvaluationPacketSigner) {
    check(/^[a-f0-9]{64}$/.test(input.operationId), "OPERATION_ID");
    check(
      Number.isSafeInteger(input.lastValidBlockHeight) &&
        input.lastValidBlockHeight > 0,
      "HEIGHT",
    );
    const inspected = inspectEvaluationServicePacket(
      input.packet,
      signer.publicKey,
    );
    const keeperPurpose = ["plan", "execute", "record"].includes(input.purpose);
    check(
      keeperPurpose
        ? signer.publicKey === EVALUATION.keeper
        : input.purpose === "authorize" || input.purpose === "wallet"
          ? signer.publicKey === EVALUATION.governance
          : [
              EVALUATION.governance,
              "FUfbAJQMsm6fvmdfduNLBDDZajjZTSmjhaKq6Eew3tZq",
            ].includes(signer.publicKey),
      "PURPOSE_AUTHORITY",
    );
    check((await this.rpc.getGenesisHash()) === EVALUATION.genesis, "NETWORK");
    // No RPC calls inside the transaction/row lock. Losing the signed dispatch
    // window is intentionally uncertain, rather than risking a second execution.
    const currentHeight = await this.rpc.getBlockHeight("finalized");
    // Durable reservation precedes any signer call. A crash or rejected signer
    // preserves the exact blockhash/message, rather than silently rebuilding it.
    await this.pool.query(
      "INSERT INTO c3_eval.service_packets(operation_id,scope,purpose,signer,message_hash,unsigned_packet,last_valid_height) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(operation_id) DO NOTHING",
      [
        input.operationId,
        input.scope,
        input.purpose,
        signer.publicKey,
        inspected.messageHash,
        input.packet,
        input.lastValidBlockHeight,
      ],
    );
    const c = await this.pool.connect();
    let signed: Uint8Array | undefined;
    let signature: string;
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const context = (
        await c.query(
          "SELECT intent_id,db_revision,chain_revision FROM c3_eval.service_contexts WHERE operation_id=$1",
          [input.operationId],
        )
      ).rows[0];
      // Same row-lock order as owner preparation and renewal. Provisioning has
      // no intent yet. A persisted signature is read-only recovery, never a send.
      const intent = context
        ? (
            await c.query(
              "SELECT db_revision,chain_revision FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
              [context.intent_id],
            )
          ).rows[0]
        : null;
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,7427))", [
        input.operationId,
      ]);
      const previous = (
        await c.query(
          "SELECT p.*,s.signature FROM c3_eval.service_packets p LEFT JOIN c3_eval.service_submissions s USING(operation_id) WHERE p.operation_id=$1 FOR UPDATE OF p",
          [input.operationId],
        )
      ).rows[0];
      if (previous) {
        // Return persisted original even if a caller freshly rebuilt a blockhash.
        check(
          previous.scope === input.scope &&
            previous.purpose === input.purpose &&
            previous.signer === signer.publicKey,
          "CONFLICT",
        );
        if (previous.signature) {
          await c.query("COMMIT");
          return {
            signature: previous.signature as string,
            state: "uncertain" as const,
            dispatched: false,
          };
        }
        check(
          previous.message_hash.equals(inspected.messageHash) &&
            previous.unsigned_packet.equals(input.packet),
          "REBUILD_FORBIDDEN",
        );
      } else throw Error("EVAL_SERVICE_RESERVATION_MISSING");
      if (context) {
        check(
          intent &&
            String(intent.db_revision) === String(context.db_revision) &&
            String(intent.chain_revision) === String(context.chain_revision),
          "INTENT_CAS",
        );
        check(
          !(
            await c.query(
              "SELECT 1 FROM c3_eval.service_retirements WHERE operation_id=$1",
              [input.operationId],
            )
          ).rowCount,
          "RETIRED",
        );
        check(
          !(
            await c.query(
              "SELECT 1 FROM c3_eval.owner_requests r LEFT JOIN c3_eval.owner_effect_receipts e USING(request_id) LEFT JOIN c3_eval.owner_request_outcomes o USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL",
              [context.intent_id],
            )
          ).rowCount,
          "OWNER_REQUEST_PENDING",
        );
      }
      check(currentHeight <= input.lastValidBlockHeight, "EXPIRED");
      // Isolated signer contract signs this exact public message, not arbitrary
      // client data. A signature cannot escape before its journal commit.
      const sig = await signer.signMessage(inspected.message);
      const key = createPublicKey({
        format: "der",
        type: "spki",
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          new PublicKey(signer.publicKey).toBuffer(),
        ]),
      });
      check(
        sig.length === 64 && verify(null, inspected.message, key, sig),
        "SIGNATURE",
      );
      inspected.tx.signatures[0] = sig;
      signed = inspected.tx.serialize();
      signature = encodeSignature(sig);
      await c.query(
        "INSERT INTO c3_eval.service_submissions(operation_id,signature,signed_message_hash) VALUES($1,$2,$3)",
        [input.operationId, signature, inspected.messageHash],
      );
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
    try {
      check(
        (await this.rpc.getGenesisHash()) === EVALUATION.genesis,
        "NETWORK",
      );
      const returned = await this.rpc.sendRawTransaction(signed!, {
        skipPreflight: false,
        maxRetries: 0,
        preflightCommitment: "finalized",
      });
      check(returned === signature!, "RESPONSE_SIGNATURE");
      return {
        signature: signature!,
        state: "submitted" as const,
        dispatched: true,
      };
    } catch {
      return {
        signature: signature!,
        state: "uncertain" as const,
        dispatched: true,
      };
    }
  }
  async reconcile(
    operationId: string,
    verifyEffects: (tx: VersionedTransactionResponse) => Promise<Uint8Array>,
  ) {
    check((await this.rpc.getGenesisHash()) === EVALUATION.genesis, "NETWORK");
    const row = (
      await this.pool.query(
        "SELECT p.*,s.signature FROM c3_eval.service_packets p JOIN c3_eval.service_submissions s USING(operation_id) WHERE p.operation_id=$1",
        [operationId],
      )
    ).rows[0];
    check(row, "NOT_DISPATCHED");
    const tx = await this.rpc.getTransaction(row.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx)
      return {
        signature: row.signature as string,
        state: "uncertain" as const,
      };
    check(
      tx.meta && tx.transaction.signatures[0] === row.signature,
      "EVIDENCE",
    );
    check(
      hash(tx.transaction.message.serialize()).equals(row.message_hash),
      "MESSAGE_SUBSTITUTION",
    );
    // Successful execution alone does not establish expected economic effects.
    const evidence = tx.meta!.err
      ? hash(JSON.stringify(tx.meta!.err))
      : Buffer.from(await verifyEffects(tx));
    check(evidence.length === 32, "EFFECTS_HASH");
    const outcome = tx.meta!.err ? "failed" : "effects_verified";
    await this.pool.query(
      "INSERT INTO c3_eval.service_receipts(operation_id,finalized_slot,outcome,evidence_hash) VALUES($1,$2,$3,$4) ON CONFLICT(operation_id) DO NOTHING",
      [operationId, tx.slot, outcome, evidence],
    );
    const stored = (
      await this.pool.query(
        "SELECT * FROM c3_eval.service_receipts WHERE operation_id=$1",
        [operationId],
      )
    ).rows[0];
    check(
      stored.outcome === outcome &&
        stored.finalized_slot === String(tx.slot) &&
        stored.evidence_hash.equals(evidence),
      "RECEIPT_CONFLICT",
    );
    return {
      signature: row.signature as string,
      state: outcome,
      slot: tx.slot,
    };
  }
}
// Public signature encoding only. No dependency on vulnerable SPL layout helpers.
function encodeSignature(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let result = "";
  while (n > 0n) {
    result = alphabet[Number(n % 58n)]! + result;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    result = "1" + result;
  }
  return result;
}
