/** Isolated open-vault quote workflow. Not exported by the production package.
 * No wallet signing or submission. Context enrollment belongs to a reconciler,
 * never to the quote request; Mainnet contexts are explicitly unsupported.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Pool } from "pg";
import {
  quoteContextHash,
  quoteIdForNonce,
  encodeQuoteSealV1,
  deriveQuoteMinimum,
  type QuoteContextV1,
  type QuoteAuthoritySigner,
  type QuoteSealV1,
} from "../src/quote-seal.ts";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
const assert = (condition: unknown, code: string): void => {
  if (!condition) throw new Error(`C3_OPEN_QUOTE_${code}`);
};
export type StoredQuoteContext = Readonly<{
  keeper: string;
  governance: string;
  policy: string;
  reviewedPrograms: string[];
  genesisHash: string;
  vault: string;
  configVersion: string;
  registry: string;
  registryRevision: string;
  registryHash: string;
  plan: string;
  planRevision: string;
  intent: string;
  wallet: string;
  leg: number;
  direction: 1 | 2;
  inputMint: string;
  outputMint: string;
  source: string;
  destination: string;
  routerProgram: string;
  policyRevision: string;
  inputAmount: string;
  authority: string;
  maxSlippageBps: number;
  maxQuoteAgeSeconds: number;
  planExpiresAt: string;
  configurationHash: string;
}>;
export function openQuoteContext(value: StoredQuoteContext): QuoteContextV1 {
  const hex = (v: string) => {
    assert(/^[a-f0-9]{64}$/.test(v), "INVALID_HASH");
    return Buffer.from(v, "hex");
  };
  const integer = (v: string) => {
    assert(/^(0|[1-9][0-9]{0,19})$/.test(v), "INVALID_INTEGER");
    return BigInt(v);
  };
  assert(value.direction === 1 || value.direction === 2, "INVALID_DIRECTION");
  assert(
    Number.isInteger(value.leg) && value.leg >= 0 && value.leg < 3,
    "INVALID_LEG",
  );
  assert(
    Number.isInteger(value.maxSlippageBps) &&
      value.maxSlippageBps > 0 &&
      value.maxSlippageBps <= 100,
    "INVALID_SLIPPAGE",
  );
  hex(value.authority);
  assert(
    Number.isInteger(value.maxQuoteAgeSeconds) &&
      value.maxQuoteAgeSeconds > 0 &&
      value.maxQuoteAgeSeconds <= 30,
    "INVALID_QUOTE_AGE",
  );
  integer(value.planExpiresAt);
  hex(value.configurationHash);
  integer(value.inputAmount);
  return {
    ...value,
    genesisHash: hex(value.genesisHash),
    registryHash: hex(value.registryHash),
    configVersion: integer(value.configVersion),
    registryRevision: integer(value.registryRevision),
    planRevision: integer(value.planRevision),
    policyRevision: integer(value.policyRevision),
  };
}

export type ValidatedQuoteMaterial = Readonly<{
  authorizationNonce: Uint8Array;
  quotedOutput: bigint;
  jupiterThreshold: bigint;
  slippageBps: number;
  routeHash: Uint8Array;
  instructionHash: Uint8Array;
  accountMetasHash: Uint8Array;
  altCount: number;
  altContentsHash: Uint8Array;
  builderTimestamp: bigint;
  builderSlot: bigint;
  expiresAt: bigint;
  expiresSlot: bigint;
  unsignedPacketBytes: number;
  executionMessageHash?: string;
  effectManifest?: Readonly<{
    pool: string;
    poolInput: string;
    poolOutput: string;
  }>;
}>;
/** Server-owned builder boundary. It must resolve/validate RPC accounts and the
 * actual unsigned v0 envelope. A public request cannot provide this material.
 * JupiterOpenBuilder provides the cloned-RPC implementation. Tests must clearly
 * identify synthetic materials. Neither implementation is production approval.
 */
export interface OpenQuoteBuilder {
  validateAndBuild(
    trusted: StoredQuoteContext,
  ): Promise<ValidatedQuoteMaterial>;
}
type Loaded = {
  context: StoredQuoteContext;
  context_hash: Buffer;
  db_revision: string;
  chain_revision: string;
  wallet: string;
  vault: string;
  deposit_plan: string;
  redemption_plan: string | null;
  configuration_hash: string;
  state: string;
  leg_state: string;
  submitted_signature: string | null;
  expires_at: Date;
  scope: string;
};
async function load(
  pool: Pool,
  intentId: string,
  ordinal: number,
  revision: bigint,
): Promise<Loaded> {
  assert(
    /^[0-9a-f-]{36}$/.test(intentId) &&
      Number.isInteger(ordinal) &&
      ordinal >= 0 &&
      ordinal < 6,
    "INVALID_REQUEST",
  );
  const result = await pool.query<Loaded>(
    `SELECT q.context,q.context_hash,q.scope,i.db_revision,i.chain_revision,
    i.wallet,i.vault,i.deposit_plan,i.redemption_plan,i.configuration_hash,i.state,i.expires_at,
    l.state AS leg_state,l.submitted_signature
    FROM c3_open.quote_contexts q JOIN c3_open.intents i USING(intent_id)
    JOIN c3_open.legs l ON l.intent_id=q.intent_id AND l.ordinal=q.ordinal
    WHERE q.intent_id=$1 AND q.ordinal=$2 AND q.intent_revision=$3`,
    [intentId, ordinal, revision.toString()],
  );
  const row = result.rows[0];
  assert(row && BigInt(row.db_revision) === revision, "CAS_CONFLICT");
  const c = openQuoteContext(row!.context);
  assert(
    row!.scope === "LOCAL_CLONE" || row!.scope === "LOCAL_MOCK",
    "PRODUCTION_NOT_REVIEWED",
  );
  assert(
    row!.context.wallet === row!.wallet &&
      row!.context.vault === row!.vault &&
      row!.context.configurationHash === row!.configuration_hash &&
      c.planRevision === BigInt(row!.chain_revision) &&
      c.leg === ordinal % 3 &&
      c.direction === (ordinal < 3 ? 1 : 2) &&
      c.plan === (ordinal < 3 ? row!.deposit_plan : row!.redemption_plan),
    "TRUSTED_CONTEXT_MISMATCH",
  );
  assert(
    quoteContextHash(c).equals(row!.context_hash),
    "CONTEXT_HASH_MISMATCH",
  );
  assert(
    row!.expires_at.getTime() > Date.now() &&
      !row!.submitted_signature &&
      ["pending", "leased", "prepared"].includes(row!.leg_state) &&
      ["funded", "buying", "redemption_requested", "selling"].includes(
        row!.state,
      ),
    "STATE_OR_EXPIRY",
  );
  if (ordinal < 3)
    assert(
      BigInt(row!.context.inputAmount) ===
        (1_000_000n * [4000n, 3000n, 3000n][ordinal]!) / 10000n,
      "INPUT_AMOUNT_MISMATCH",
    );
  return row!;
}
type Prepared = {
  quote_id: Buffer;
  nonce: Buffer;
  canonical_payload: Buffer;
  payload_hash: Buffer;
  authority: Buffer;
  signature: Buffer | null;
  intent_id: string;
  ordinal: number;
  intent_revision: string;
  evidence: Record<string, string | number>;
  revision: string;
  state: string;
  expires_at: Date;
};

/** Used inside the isolated TEST signer too: no context supplied by its caller. */
export async function loadOpenSignerRecord(
  pool: Pool,
  quoteId: string,
  authority: Uint8Array,
): Promise<Prepared> {
  assert(/^[a-f0-9]{64}$/.test(quoteId), "INVALID_ID");
  const row = (
    await pool.query<Prepared>(
      "SELECT * FROM c3_open.quote_authorizations WHERE quote_id=$1",
      [Buffer.from(quoteId, "hex")],
    )
  ).rows[0];
  assert(
    row &&
      ["prepared", "signed"].includes(row.state) &&
      row.expires_at.getTime() > Date.now(),
    "NOT_SIGNABLE",
  );
  const trusted = await load(
    pool,
    row!.intent_id,
    row!.ordinal,
    BigInt(row!.intent_revision),
  );
  const p = row!.canonical_payload;
  assert(
    p.length === 300 &&
      hash(p).equals(row!.payload_hash) &&
      p.subarray(17, 49).equals(trusted.context_hash) &&
      p.subarray(49, 81).equals(row!.quote_id) &&
      p.subarray(81, 113).equals(row!.nonce) &&
      quoteIdForNonce(row!.nonce).equals(row!.quote_id) &&
      p.readBigUInt64LE(113).toString() === trusted.context.inputAmount &&
      p.readUInt16LE(129) > 0 &&
      p.readUInt16LE(129) <= trusted.context.maxSlippageBps &&
      p.readBigUInt64LE(131) ===
        deriveQuoteMinimum(
          p.readBigUInt64LE(121),
          p.readUInt16LE(129),
          BigInt(row!.evidence.jupiterThreshold!),
        ) &&
      p.readBigInt64LE(268) <= BigInt(Math.floor(Date.now() / 1000)) &&
      p.readBigInt64LE(284) - p.readBigInt64LE(268) <=
        BigInt(trusted.context.maxQuoteAgeSeconds) &&
      p.readBigInt64LE(284) * 1000n === BigInt(row!.expires_at.getTime()) &&
      p.readBigInt64LE(284) <= BigInt(trusted.context.planExpiresAt) &&
      Buffer.from(authority).equals(row!.authority) &&
      row!.authority.toString("hex") === trusted.context.authority,
    "PERSISTED_TAMPERING",
  );
  return row!;
}

/** Quote signer only receives a record identifier. Trusted context and exact
 * immutable bytes are loaded from PostgreSQL again before/after isolated sign.
 */
export class OpenQuoteAuthority {
  private readonly pool: Pool;
  private readonly builder: OpenQuoteBuilder;
  constructor(pool: Pool, builder: OpenQuoteBuilder) {
    this.pool = pool;
    this.builder = builder;
  }
  async prepare(
    intentId: string,
    ordinal: number,
    expectedRevision: bigint,
  ): Promise<string> {
    const row = await load(this.pool, intentId, ordinal, expectedRevision);
    const material = await this.builder.validateAndBuild(
      Object.freeze({ ...row.context }),
    );
    assert(
      material.unsignedPacketBytes > 0 && material.unsignedPacketBytes <= 1232,
      "TRANSACTION_SIZE",
    );
    assert(
      material.slippageBps > 0 &&
        material.slippageBps <= row.context.maxSlippageBps &&
        material.builderTimestamp <= BigInt(Math.floor(Date.now() / 1000)) &&
        material.expiresAt > BigInt(Math.floor(Date.now() / 1000)) &&
        material.expiresAt - material.builderTimestamp <=
          BigInt(row.context.maxQuoteAgeSeconds) &&
        material.expiresAt <= BigInt(row.context.planExpiresAt) &&
        material.expiresAt * 1000n <= BigInt(row.expires_at.getTime()),
      "FRESHNESS_OR_POLICY",
    );
    const nonce = Buffer.from(material.authorizationNonce),
      quoteId = quoteIdForNonce(nonce);
    const seal: QuoteSealV1 = {
      ...material,
      contextHash: row.context_hash,
      quoteId,
      nonce,
      inputAmount: BigInt(row.context.inputAmount),
      minimumOutput: deriveQuoteMinimum(
        material.quotedOutput,
        material.slippageBps,
        material.jupiterThreshold,
      ),
    };
    const payload = encodeQuoteSealV1(seal);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const lock = await client.query(
        "SELECT db_revision,chain_revision FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [intentId],
      );
      assert(
        lock.rows[0]?.db_revision === expectedRevision.toString() &&
          lock.rows[0]?.chain_revision === row.chain_revision,
        "CAS_CONFLICT",
      );
      await client.query(
        `INSERT INTO c3_open.quote_authorizations(quote_id,nonce,intent_id,ordinal,intent_revision,canonical_payload,payload_hash,evidence,authority,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          quoteId,
          nonce,
          intentId,
          ordinal,
          expectedRevision.toString(),
          payload,
          hash(payload),
          {
            quotedOutput: material.quotedOutput.toString(),
            jupiterThreshold: material.jupiterThreshold.toString(),
            minimumOutput: seal.minimumOutput.toString(),
            inputAmount: seal.inputAmount.toString(),
            slippageBps: seal.slippageBps,
            unsignedPacketBytes: material.unsignedPacketBytes,
            executionMessageHash: material.executionMessageHash ?? null,
            effectManifest: material.effectManifest ?? null,
          },
          Buffer.from(row.context.authority, "hex"),
          new Date(Number(material.expiresAt) * 1000),
        ],
      );
      await client.query("COMMIT");
      return quoteId.toString("hex");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async signPersisted(
    quoteId: string,
    signer: QuoteAuthoritySigner,
  ): Promise<Readonly<{ payload: Buffer; signature: Buffer }>> {
    const row = await loadOpenSignerRecord(
      this.pool,
      quoteId,
      signer.publicKey,
    );
    const p = row.canonical_payload;
    const signature =
      row!.signature ??
      Buffer.from(await signer.signCanonicalBytes(Buffer.from(p)));
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        row!.authority,
      ]),
      format: "der",
      type: "spki",
    });
    assert(
      signature.length === 64 && verify(null, p, publicKey, signature),
      "INVALID_SIGNATURE",
    );
    // No remote signer call while holding an intent lock. Re-check state/CAS
    // after signing; a conflicting worker can never return an unpersisted sig.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const intent = await client.query(
        "SELECT db_revision FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [row!.intent_id],
      );
      assert(
        intent.rows[0]?.db_revision === row!.intent_revision,
        "CAS_CONFLICT",
      );
      const persisted = await client.query<Prepared>(
        "SELECT * FROM c3_open.quote_authorizations WHERE quote_id=$1 FOR UPDATE",
        [row!.quote_id],
      );
      const current = persisted.rows[0]!;
      assert(
        current.expires_at.getTime() > Date.now() &&
          current.canonical_payload.equals(p) &&
          current.payload_hash.equals(hash(p)),
        "PERSISTED_TAMPERING",
      );
      if (current.state === "signed")
        assert(current.signature?.equals(signature), "SIGNATURE_CONFLICT");
      else {
        assert(
          current.state === "prepared" && current.revision === row!.revision,
          "CAS_CONFLICT",
        );
        await client.query(
          "UPDATE c3_open.quote_authorizations SET signature=$2,state='signed',revision=revision+1 WHERE quote_id=$1",
          [row!.quote_id, signature],
        );
      }
      await client.query("COMMIT");
      return Object.freeze({
        payload: Buffer.from(p),
        signature: Buffer.from(signature),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
