/** Isolated local durable journal. Deliberately excluded from the production service build. */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import type { Connection } from "@solana/web3.js";
import { reconcilePersistedOpenLeg } from "./open-reconcile.ts";
import { verifyLocalLifecycle, type LifecycleStage } from "./open-lifecycle.ts";
import type { Idl } from "@coral-xyz/anchor";
import { quoteContextHash } from "../src/quote-seal.ts";
import { openQuoteContext, type StoredQuoteContext } from "./open-quote.ts";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HASH = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const MIGRATION = "0001_open_settlement";
const MIGRATION_URL = new URL(
  "./migrations/0001_open_settlement.sql",
  import.meta.url,
);
const RECOVERY_MIGRATION = "0002_open_recovery";
const RECOVERY_MIGRATION_URL = new URL(
  "./migrations/0002_open_recovery.sql",
  import.meta.url,
);
const QUOTE_MIGRATION = "0003_open_quote_authority";
const QUOTE_MIGRATION_URL = new URL(
  "./migrations/0003_open_quote_authority.sql",
  import.meta.url,
);
const FINALIZED_MIGRATION = "0004_open_finalized_evidence";
const FINALIZED_MIGRATION_URL = new URL(
  "./migrations/0004_open_finalized_evidence.sql",
  import.meta.url,
);
const fail = (code: string): never => {
  throw new Error(`C3_OPEN_${code}`);
};
const assert = (condition: unknown, code: string): void => {
  if (!condition) fail(code);
};

export type OpenState =
  | "draft"
  | "funded"
  | "buying"
  | "active"
  | "redemption_requested"
  | "selling"
  | "claimable"
  | "redeemed"
  | "expired"
  | "cancelled"
  | "failed_recoverable"
  | "partially_completed"
  | "reconciliation_required"
  | "manual_review"
  | "paused";
export type LocalIntent = Readonly<{
  intentId: string;
  wallet: string;
  vault: string;
  shareMint: string;
  depositPlan: string;
  configurationHash: string;
  expiresAt: Date;
  idempotencyHash: string;
}>;
export type Scope = Readonly<{
  intentId: string;
  wallet: string;
  vault: string;
  expectedDbRevision: bigint;
  expectedChainRevision: bigint;
  idempotencyHash: string;
}>;
export type OpenSnapshot = Readonly<{
  intentId: string;
  wallet: string;
  vault: string;
  state: OpenState;
  dbRevision: bigint;
  chainRevision: bigint;
  depositPlan: string;
  redemptionPlan: string | null;
  expiresAt: Date;
}>;
type IntentRow = {
  intent_id: string;
  wallet: string;
  vault: string;
  state: OpenState;
  db_revision: string;
  chain_revision: string;
  deposit_plan: string;
  redemption_plan: string | null;
  expires_at: Date;
};
type LegRow = {
  state: string;
  chain_revision: string;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  submitted_signature: string | null;
  route_hash: string | null;
  instruction_hash: string | null;
  authorization_hash: string | null;
  minimum_output: string | null;
  quote_expires_at: Date | null;
  submitted_at: Date | null;
  recovery_attempts: number;
};
const snapshot = (row: IntentRow): OpenSnapshot =>
  Object.freeze({
    intentId: row.intent_id,
    wallet: row.wallet,
    vault: row.vault,
    state: row.state,
    dbRevision: BigInt(row.db_revision),
    chainRevision: BigInt(row.chain_revision),
    depositPlan: row.deposit_plan,
    redemptionPlan: row.redemption_plan,
    expiresAt: row.expires_at,
  });

/** Once enrolled, an intent/leg cannot downgrade to the historical unsealed
 * mock-fixture preparation. No signing operation occurs under this PG lock. */
async function signedOpenSeal(
  client: PoolClient,
  intentId: string,
  ordinal: number,
  authorizationHash: string,
) {
  const enrolled = await client.query(
    "SELECT 1 FROM c3_open.quote_contexts WHERE intent_id=$1 AND ordinal=$2 LIMIT 1",
    [intentId, ordinal],
  );
  if (!enrolled.rowCount) return null; // historical mock-only regression fixtures
  const q = (
    await client.query(
      `SELECT q.*,ctx.context,ctx.context_hash,ctx.scope AS context_scope FROM c3_open.quote_authorizations q
    JOIN c3_open.quote_contexts ctx USING(intent_id,ordinal,intent_revision)
    WHERE q.intent_id=$1 AND q.ordinal=$2 AND q.state='signed' AND encode(q.payload_hash,'hex')=$3 FOR SHARE OF q`,
      [intentId, ordinal, authorizationHash],
    )
  ).rows[0];
  assert(
    q &&
      q.signature &&
      q.canonical_payload.length === 300 &&
      q.signature.length === 64,
    "SIGNED_OPEN_SEAL_REQUIRED",
  );
  const payload = q.canonical_payload as Buffer;
  assert(
    createHash("sha256").update(payload).digest().equals(q.payload_hash) &&
      payload.subarray(17, 49).equals(q.context_hash) &&
      quoteContextHash(openQuoteContext(q.context)).equals(q.context_hash) &&
      Buffer.from(q.context.authority, "hex").equals(q.authority) &&
      verify(
        null,
        payload,
        createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            q.authority,
          ]),
          format: "der",
          type: "spki",
        }),
        q.signature,
      ),
    "OPEN_SEAL_CORRUPTED",
  );
  return q as {
    quote_id: Buffer;
    canonical_payload: Buffer;
    intent_revision: string;
    context: StoredQuoteContext;
    context_scope: "LOCAL_MOCK" | "LOCAL_CLONE";
  };
}

/** Explicit migration; production bootstrap never calls this. */
export async function applyOpenLocalMigration(
  client: PoolClient,
): Promise<"applied" | "already_applied"> {
  const sql = await readFile(MIGRATION_URL, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const recoverySql = await readFile(RECOVERY_MIGRATION_URL, "utf8");
  const recoveryChecksum = createHash("sha256")
    .update(recoverySql)
    .digest("hex");
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(304137, 5)");
    const namespace = await client.query<{ schema: string | null }>(
      "SELECT to_regnamespace('c3_open')::text AS schema",
    );
    let changed = false;
    if (!namespace.rows[0]?.schema) {
      await client.query(sql);
      await client.query(
        "INSERT INTO c3_open.schema_migrations(migration_id,checksum_sha256) VALUES($1,$2)",
        [MIGRATION, checksum],
      );
      changed = true;
    } else {
      const existing = await client.query<{ checksum_sha256: string }>(
        "SELECT checksum_sha256 FROM c3_open.schema_migrations WHERE migration_id=$1",
        [MIGRATION],
      );
      assert(
        existing.rows.length === 1 &&
          existing.rows[0]?.checksum_sha256 === checksum,
        "MIGRATION_CHECKSUM_MISMATCH",
      );
    }
    const recovery = await client.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3_open.schema_migrations WHERE migration_id=$1",
      [RECOVERY_MIGRATION],
    );
    if (recovery.rows.length === 0) {
      await client.query(recoverySql);
      await client.query(
        "INSERT INTO c3_open.schema_migrations(migration_id,checksum_sha256) VALUES($1,$2)",
        [RECOVERY_MIGRATION, recoveryChecksum],
      );
      changed = true;
    } else {
      assert(
        recovery.rows[0]?.checksum_sha256 === recoveryChecksum,
        "MIGRATION_CHECKSUM_MISMATCH",
      );
    }
    const quoteSql = await readFile(QUOTE_MIGRATION_URL, "utf8");
    const quoteChecksum = createHash("sha256").update(quoteSql).digest("hex");
    const quoteExisting = await client.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3_open.schema_migrations WHERE migration_id=$1",
      [QUOTE_MIGRATION],
    );
    if (!quoteExisting.rows.length) {
      await client.query(quoteSql);
      await client.query(
        "INSERT INTO c3_open.schema_migrations(migration_id,checksum_sha256) VALUES($1,$2)",
        [QUOTE_MIGRATION, quoteChecksum],
      );
      changed = true;
    } else
      assert(
        quoteExisting.rows[0]?.checksum_sha256 === quoteChecksum,
        "MIGRATION_CHECKSUM_MISMATCH",
      );
    const finalizedSql = await readFile(FINALIZED_MIGRATION_URL, "utf8");
    const finalizedHash = createHash("sha256")
      .update(finalizedSql)
      .digest("hex");
    const finalizedExisting = await client.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3_open.schema_migrations WHERE migration_id=$1",
      [FINALIZED_MIGRATION],
    );
    if (!finalizedExisting.rows.length) {
      await client.query(finalizedSql);
      await client.query(
        "INSERT INTO c3_open.schema_migrations(migration_id,checksum_sha256) VALUES($1,$2)",
        [FINALIZED_MIGRATION, finalizedHash],
      );
      changed = true;
    } else
      assert(
        finalizedExisting.rows[0]!.checksum_sha256 === finalizedHash,
        "MIGRATION_CHECKSUM_MISMATCH",
      );
    await client.query("COMMIT");
    return changed ? "applied" : "already_applied";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function assertOpenLocalSchema(pool: Pool): Promise<void> {
  for (const [id, url] of [
    [MIGRATION, MIGRATION_URL],
    [RECOVERY_MIGRATION, RECOVERY_MIGRATION_URL],
    [QUOTE_MIGRATION, QUOTE_MIGRATION_URL],
    [FINALIZED_MIGRATION, FINALIZED_MIGRATION_URL],
  ] as const) {
    const checksum = createHash("sha256")
      .update(await readFile(url))
      .digest("hex");
    const found = await pool.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3_open.schema_migrations WHERE migration_id=$1",
      [id],
    );
    assert(found.rows[0]?.checksum_sha256 === checksum, "SCHEMA_MISMATCH");
  }
}

async function atomic<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const SELECT_INTENT = `SELECT intent_id,wallet,vault,state,db_revision,chain_revision,
  deposit_plan,redemption_plan,expires_at FROM c3_open.intents`;
async function locked(
  client: PoolClient,
  scope: Scope,
  allowExpired = false,
): Promise<IntentRow> {
  assert(
    ID.test(scope.intentId) &&
      KEY.test(scope.wallet) &&
      KEY.test(scope.vault) &&
      HASH.test(scope.idempotencyHash),
    "INVALID_SCOPE",
  );
  const result = await client.query<IntentRow>(
    `${SELECT_INTENT} WHERE intent_id=$1 FOR UPDATE`,
    [scope.intentId],
  );
  const row = result.rows[0];
  if (!row || row.wallet !== scope.wallet || row.vault !== scope.vault)
    throw new Error("C3_OPEN_AUTHORIZATION_MISMATCH");
  assert(
    BigInt(row.db_revision) === scope.expectedDbRevision &&
      BigInt(row.chain_revision) === scope.expectedChainRevision,
    "COMPARE_AND_SWAP_CONFLICT",
  );
  if (!allowExpired) assert(row.expires_at.getTime() > Date.now(), "EXPIRED");
  const used = await client.query(
    "SELECT 1 FROM c3_open.events WHERE idempotency_hash=$1",
    [scope.idempotencyHash],
  );
  assert(!used.rows.length, "DUPLICATE_OPERATION");
  return row;
}
async function event(
  client: PoolClient,
  scope: Scope,
  revision: bigint,
  state: string,
  ordinal: number | null = null,
  evidenceHash: string | null = null,
  reason: string | null = null,
): Promise<void> {
  const eventId = randomUUID();
  await client.query(
    `INSERT INTO c3_open.events(event_id,intent_id,idempotency_hash,db_revision,state,ordinal,evidence_hash,safe_reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      eventId,
      scope.intentId,
      scope.idempotencyHash,
      revision.toString(),
      state,
      ordinal,
      evidenceHash,
      reason,
    ],
  );
  await client.query("INSERT INTO c3_open.outbox(event_id) VALUES($1)", [
    eventId,
  ]);
}
async function bump(
  client: PoolClient,
  scope: Scope,
  state: OpenState,
  chainRevision = scope.expectedChainRevision,
  redemptionPlan: string | null = null,
): Promise<OpenSnapshot> {
  const result = await client.query<IntentRow>(
    `UPDATE c3_open.intents SET state=$2,chain_revision=$3,db_revision=db_revision+1,
      redemption_plan=COALESCE(redemption_plan,$4),updated_at=clock_timestamp() WHERE intent_id=$1 RETURNING
      intent_id,wallet,vault,state,db_revision,chain_revision,deposit_plan,redemption_plan,expires_at`,
    [scope.intentId, state, chainRevision.toString(), redemptionPlan],
  );
  assert(result.rows[0], "STATE_UPDATE_FAILED");
  return snapshot(result.rows[0]!);
}
async function legForUpdate(
  client: PoolClient,
  intentId: string,
  ordinal: number,
): Promise<LegRow> {
  assert(
    Number.isInteger(ordinal) && ordinal >= 0 && ordinal < 6,
    "INVALID_LEG",
  );
  const result = await client.query<LegRow>(
    `SELECT state,chain_revision,lease_owner,lease_expires_at,submitted_signature,
      route_hash,instruction_hash,authorization_hash,minimum_output,quote_expires_at,
      submitted_at,recovery_attempts
     FROM c3_open.legs WHERE intent_id=$1 AND ordinal=$2 FOR UPDATE`,
    [intentId, ordinal],
  );
  assert(result.rows[0], "MISSING_LEG");
  return result.rows[0]!;
}

/** Local-only persistence. Real cloned Jupiter legs require the independent
 * message/effects/plan verifier; mock attestations cannot confirm cloned legs.
 * Neither is Mainnet production confirmation.
 */
export class OpenLocalSettlementRepository {
  private readonly pool: Pool;
  private constructor(pool: Pool) {
    this.pool = pool;
  }
  static async fromVerifiedPool(
    pool: Pool,
  ): Promise<OpenLocalSettlementRepository> {
    await assertOpenLocalSchema(pool);
    return new OpenLocalSettlementRepository(pool);
  }
  async read(intentId: string): Promise<OpenSnapshot | null> {
    assert(ID.test(intentId), "INVALID_ID");
    const result = await this.pool.query<IntentRow>(
      `${SELECT_INTENT} WHERE intent_id=$1`,
      [intentId],
    );
    return result.rows[0] ? snapshot(result.rows[0]) : null;
  }
  async activity(wallet: string): Promise<readonly OpenSnapshot[]> {
    assert(KEY.test(wallet), "INVALID_WALLET");
    const result = await this.pool.query<IntentRow>(
      `${SELECT_INTENT} WHERE wallet=$1 ORDER BY created_at DESC LIMIT 30`,
      [wallet],
    );
    return Object.freeze(result.rows.map(snapshot));
  }
  async createDraft(input: LocalIntent): Promise<OpenSnapshot> {
    assert(
      ID.test(input.intentId) &&
        KEY.test(input.wallet) &&
        KEY.test(input.vault) &&
        KEY.test(input.shareMint) &&
        KEY.test(input.depositPlan) &&
        HASH.test(input.configurationHash) &&
        HASH.test(input.idempotencyHash) &&
        input.expiresAt instanceof Date &&
        input.expiresAt.getTime() > Date.now() + 1_000,
      "INVALID_DRAFT",
    );
    return atomic(this.pool, async (client) => {
      const result = await client.query<IntentRow>(
        `INSERT INTO c3_open.intents(intent_id,wallet,vault,share_mint,deposit_plan,
         configuration_hash,deposit_amount,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,1000000,$7) RETURNING
         intent_id,wallet,vault,state,db_revision,chain_revision,deposit_plan,redemption_plan,expires_at`,
        [
          input.intentId,
          input.wallet,
          input.vault,
          input.shareMint,
          input.depositPlan,
          input.configurationHash,
          input.expiresAt,
        ],
      );
      for (let ordinal = 0; ordinal < 6; ordinal++)
        await client.query(
          "INSERT INTO c3_open.legs(intent_id,ordinal) VALUES($1,$2)",
          [input.intentId, ordinal],
        );
      await event(
        client,
        { ...input, expectedDbRevision: 0n, expectedChainRevision: 0n },
        1n,
        "draft",
      );
      return snapshot(result.rows[0]!);
    });
  }
  async transition(
    scope: Scope,
    from: OpenState,
    to: OpenState,
    evidenceHash: string | null,
    chainRevision = scope.expectedChainRevision,
  ): Promise<OpenSnapshot> {
    const edges: Readonly<Record<string, readonly string[]>> = {
      draft: ["funded", "cancelled", "expired", "manual_review"],
      funded: ["buying", "manual_review", "paused"],
      buying: ["active", "partially_completed", "manual_review", "paused"],
      active: ["redemption_requested", "paused", "manual_review"],
      redemption_requested: ["selling", "manual_review", "paused"],
      selling: ["claimable", "partially_completed", "manual_review", "paused"],
      claimable: ["redeemed", "manual_review"],
      partially_completed: ["buying", "selling", "manual_review", "paused"],
      failed_recoverable: ["manual_review"],
      reconciliation_required: ["manual_review"],
      paused: ["manual_review"],
      manual_review: [],
    };
    assert(edges[from]?.includes(to), "INVALID_TRANSITION");
    assert(
      evidenceHash === null || HASH.test(evidenceHash),
      "INVALID_EVIDENCE",
    );
    // A state resembling confirmed on-chain effects requires independently verified evidence.
    // No production verifier is wired, so this local journal cannot promote to success states.
    assert(
      !["funded", "active", "claimable", "redeemed"].includes(to),
      "RECONCILIATION_GATE_CLOSED",
    );
    return atomic(this.pool, async (client) => {
      const row = await locked(
        client,
        scope,
        to === "expired" || to === "manual_review",
      );
      assert(row.state === from, "INVALID_PREVIOUS_STATE");
      assert(
        chainRevision >= scope.expectedChainRevision,
        "CHAIN_REVISION_REGRESSION",
      );
      const next = await bump(client, scope, to, chainRevision);
      await event(client, scope, next.dbRevision, to, null, evidenceHash);
      return next;
    });
  }
  /** Accepts only an explicit MOCK_LOCAL_ONLY test attestation, never a production RPC response. */
  async recordLocalChainCheckpoint(
    scope: Scope,
    from: OpenState,
    to: "funded" | "active" | "redemption_requested" | "claimable" | "redeemed",
    attestation: Readonly<{
      source: "MOCK_LOCAL_ONLY";
      plan: string;
      wallet: string;
      vault: string;
      amount: bigint;
      chainRevision: bigint;
      evidenceHash: string;
      redemptionPlan?: string;
    }>,
  ): Promise<OpenSnapshot> {
    assert(
      attestation.source === "MOCK_LOCAL_ONLY" &&
        KEY.test(attestation.plan) &&
        attestation.wallet === scope.wallet &&
        attestation.vault === scope.vault &&
        attestation.amount === 1_000_000n &&
        HASH.test(attestation.evidenceHash) &&
        (attestation.chainRevision >= scope.expectedChainRevision ||
          (to === "redemption_requested" && attestation.chainRevision === 0n)),
      "LOCAL_ATTESTATION_MISMATCH",
    );
    return this.#checkpoint(scope, from, to, attestation, true);
  }
  async reconcileLocalLifecycle(
    scope: Scope,
    from: OpenState,
    to: LifecycleStage,
    rpc: Connection,
    idl: Idl,
    signatures: readonly string[],
  ): Promise<OpenSnapshot> {
    const proof = await verifyLocalLifecycle(
      this.pool,
      rpc,
      idl,
      scope.intentId,
      to,
      signatures,
    );
    assert(
      proof.wallet === scope.wallet && proof.vault === scope.vault,
      "LOCAL_CONTEXT_MISMATCH",
    );
    return this.#checkpoint(scope, from, to, proof, false);
  }
  async #checkpoint(
    scope: Scope,
    from: OpenState,
    to: LifecycleStage,
    attestation: Readonly<{
      plan: string;
      wallet: string;
      vault: string;
      amount: bigint;
      chainRevision: bigint;
      evidenceHash: string;
      redemptionPlan?: string;
    }>,
    mock: boolean,
  ): Promise<OpenSnapshot> {
    const required: Readonly<Record<string, readonly string[]>> = {
      funded: ["draft"],
      active: ["buying"],
      redemption_requested: ["active"],
      claimable: ["selling"],
      redeemed: ["claimable"],
    };
    assert(required[to]?.includes(from), "INVALID_TRANSITION");
    return atomic(this.pool, async (client) => {
      const row = await locked(client, scope);
      assert(row.state === from, "INVALID_PREVIOUS_STATE");
      if (mock) {
        const cloned = await client.query(
          "SELECT 1 FROM c3_open.quote_contexts WHERE intent_id=$1 AND scope='LOCAL_CLONE' LIMIT 1",
          [scope.intentId],
        );
        assert(!cloned.rowCount, "CLONE_REQUIRES_RPC_RECONCILIATION");
      }
      let redemptionPlan: string | null = null;
      if (to === "redemption_requested") {
        assert(
          KEY.test(attestation.redemptionPlan ?? "") &&
            attestation.plan === attestation.redemptionPlan,
          "REDEMPTION_PLAN_REQUIRED",
        );
        redemptionPlan = attestation.redemptionPlan ?? null;
      } else {
        assert(
          attestation.plan ===
            (to === "claimable" || to === "redeemed"
              ? row.redemption_plan
              : row.deposit_plan),
          "PLAN_MISMATCH",
        );
      }
      if (to === "active" || to === "claimable") {
        const range = to === "active" ? [0, 1, 2] : [3, 4, 5];
        const confirmed = await client.query<{ ordinal: number }>(
          "SELECT ordinal FROM c3_open.legs WHERE intent_id=$1 AND state='confirmed' AND ordinal = ANY($2::smallint[])",
          [scope.intentId, range],
        );
        assert(confirmed.rows.length === 3, "INCOMPLETE_SETTLEMENT");
      }
      const next = await bump(
        client,
        scope,
        to,
        attestation.chainRevision,
        redemptionPlan,
      );
      await event(
        client,
        scope,
        next.dbRevision,
        to,
        null,
        attestation.evidenceHash,
      );
      return next;
    });
  }
  async lease(
    scope: Scope,
    ordinal: number,
    worker: string,
    ttlSeconds = 30,
  ): Promise<OpenSnapshot> {
    assert(
      ID.test(worker) &&
        Number.isInteger(ttlSeconds) &&
        ttlSeconds >= 5 &&
        ttlSeconds <= 60,
      "INVALID_LEASE",
    );
    return atomic(this.pool, async (client) => {
      const row = await locked(client, scope);
      assert(
        (ordinal < 3 && ["funded", "buying"].includes(row.state)) ||
          (ordinal >= 3 &&
            ["redemption_requested", "selling"].includes(row.state)),
        "INVALID_STATE",
      );
      if (ordinal > 0) {
        const previous = await legForUpdate(
          client,
          scope.intentId,
          ordinal - 1,
        );
        assert(previous.state === "confirmed", "PREVIOUS_LEG_NOT_CONFIRMED");
      }
      const leg = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        leg.submitted_signature === null,
        "SIGNATURE_REQUIRES_MANUAL_REVIEW",
      );
      assert(
        leg.state === "pending" ||
          (leg.state === "leased" &&
            leg.lease_expires_at !== null &&
            leg.lease_expires_at.getTime() < Date.now()),
        "LEG_BUSY_OR_COMPLETE",
      );
      await client.query(
        `UPDATE c3_open.legs SET state='leased',lease_owner=$3,
           lease_expires_at=clock_timestamp()+($4::int * interval '1 second'),updated_at=clock_timestamp()
         WHERE intent_id=$1 AND ordinal=$2`,
        [scope.intentId, ordinal, worker, ttlSeconds],
      );
      const next = await bump(client, scope, row.state);
      await event(client, scope, next.dbRevision, "leased", ordinal);
      return next;
    });
  }
  async prepare(
    scope: Scope,
    ordinal: number,
    worker: string,
    details: Readonly<{
      routeHash: string;
      instructionHash: string;
      authorizationHash: string;
      inputMint: string;
      outputMint: string;
      source: string;
      destination: string;
      inputAmount: bigint;
      minimumOutput: bigint;
      quoteExpiresAt: Date;
      expectedEffects: Record<string, unknown>;
    }>,
  ): Promise<OpenSnapshot> {
    assert(
      [
        details.routeHash,
        details.instructionHash,
        details.authorizationHash,
      ].every((x) => HASH.test(x)) &&
        [
          details.inputMint,
          details.outputMint,
          details.source,
          details.destination,
        ].every((x) => KEY.test(x)) &&
        details.inputAmount > 0n &&
        details.minimumOutput > 0n &&
        details.quoteExpiresAt.getTime() > Date.now() &&
        details.quoteExpiresAt.getTime() <= Date.now() + 120_000 &&
        ID.test(worker),
      "INVALID_PREPARATION",
    );
    return atomic(this.pool, async (client) => {
      const row = await locked(client, scope);
      const leg = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        leg.state === "leased" &&
          leg.lease_owner === worker &&
          leg.lease_expires_at !== null &&
          leg.lease_expires_at.getTime() > Date.now(),
        "LEASE_REQUIRED",
      );
      const seal = await signedOpenSeal(
        client,
        scope.intentId,
        ordinal,
        details.authorizationHash,
      );
      if (seal)
        assert(
          seal.intent_revision === scope.expectedDbRevision.toString() &&
            seal.canonical_payload.readBigUInt64LE(113) ===
              details.inputAmount &&
            seal.canonical_payload.readBigUInt64LE(131) ===
              details.minimumOutput &&
            seal.canonical_payload.subarray(139, 171).toString("hex") ===
              details.routeHash &&
            seal.canonical_payload.subarray(171, 203).toString("hex") ===
              details.instructionHash &&
            Number(seal.canonical_payload.readBigInt64LE(284)) * 1000 ===
              details.quoteExpiresAt.getTime() &&
            seal.context.inputMint === details.inputMint &&
            seal.context.outputMint === details.outputMint &&
            seal.context.source === details.source &&
            seal.context.destination === details.destination,
          "OPEN_SEAL_PREPARATION_MISMATCH",
        );
      await client.query(
        `UPDATE c3_open.legs SET state='prepared',route_hash=$3,instruction_hash=$4,
          authorization_hash=$5,input_mint=$6,output_mint=$7,source_account=$8,
          destination_account=$9,input_amount=$10,minimum_output=$11,quote_expires_at=$12,
          expected_effects=$13,updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2`,
        [
          scope.intentId,
          ordinal,
          details.routeHash,
          details.instructionHash,
          details.authorizationHash,
          details.inputMint,
          details.outputMint,
          details.source,
          details.destination,
          details.inputAmount.toString(),
          details.minimumOutput.toString(),
          details.quoteExpiresAt,
          JSON.stringify(details.expectedEffects),
        ],
      );
      const next = await bump(client, scope, row.state);
      await event(client, scope, next.dbRevision, "prepared", ordinal);
      return next;
    });
  }
  /** Persist the signature before the caller is ever allowed to attempt network submission. */
  async recordSignature(
    scope: Scope,
    ordinal: number,
    worker: string,
    signature: string,
    authorizationHash: string,
  ): Promise<OpenSnapshot> {
    assert(
      SIGNATURE.test(signature) && HASH.test(authorizationHash),
      "INVALID_SIGNATURE",
    );
    return atomic(this.pool, async (client) => {
      const row = await locked(client, scope);
      const leg = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        leg.state === "prepared" &&
          leg.lease_owner === worker &&
          leg.lease_expires_at !== null &&
          leg.lease_expires_at.getTime() > Date.now() &&
          leg.quote_expires_at !== null &&
          leg.quote_expires_at.getTime() > Date.now() &&
          leg.authorization_hash === authorizationHash &&
          leg.submitted_signature === null,
        "PREPARED_AUTHORIZATION_REQUIRED",
      );
      await signedOpenSeal(client, scope.intentId, ordinal, authorizationHash);
      await client.query(
        "UPDATE c3_open.legs SET state='signed',submitted_signature=$3,updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2",
        [scope.intentId, ordinal, signature],
      );
      const next = await bump(client, scope, row.state);
      await event(client, scope, next.dbRevision, "signed", ordinal);
      return next;
    });
  }
  /** One-shot marker. Any network uncertainty must be reconciled; never retry here. */
  async markSubmitted(
    scope: Scope,
    ordinal: number,
    worker: string,
    signature: string,
  ): Promise<OpenSnapshot> {
    return atomic(this.pool, async (client) => {
      const row = await locked(client, scope);
      const leg = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        leg.state === "signed" &&
          leg.lease_owner === worker &&
          leg.submitted_signature === signature &&
          leg.submitted_signature !== null,
        "SUBMISSION_ALREADY_ATTEMPTED_OR_MISMATCH",
      );
      await client.query(
        `UPDATE c3_open.legs SET state='submitted',submitted_at=clock_timestamp(),
          lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
         WHERE intent_id=$1 AND ordinal=$2`,
        [scope.intentId, ordinal],
      );
      const next = await bump(client, scope, row.state);
      await event(client, scope, next.dbRevision, "submitted", ordinal);
      return next;
    });
  }
  async uncertain(
    scope: Scope,
    ordinal: number,
    reason: string,
  ): Promise<OpenSnapshot> {
    assert(/^[A-Z0-9_]{3,64}$/.test(reason), "INVALID_REASON");
    return atomic(this.pool, async (client) => {
      await locked(client, scope, true);
      const leg = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        ["signed", "submitted"].includes(leg.state) &&
          leg.submitted_signature !== null,
        "NO_SIGNATURE_TO_RECONCILE",
      );
      await client.query(
        `UPDATE c3_open.legs SET state='uncertain',reason_code=$3,
          submitted_at=COALESCE(submitted_at,clock_timestamp()),
          lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
         WHERE intent_id=$1 AND ordinal=$2`,
        [scope.intentId, ordinal, reason],
      );
      const next = await bump(client, scope, "reconciliation_required");
      await event(
        client,
        scope,
        next.dbRevision,
        "reconciliation_required",
        ordinal,
        null,
        reason,
      );
      return next;
    });
  }
  /** A bounded, operator-triggered read attempt; it never rebuilds or resends a transaction. */
  async beginReconciliation(
    scope: Scope,
    ordinal: number,
  ): Promise<OpenSnapshot> {
    return atomic(this.pool, async (client) => {
      const row = await locked(client, scope, true);
      const leg = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        row.state === "reconciliation_required" &&
          ["uncertain", "reconciliation_required"].includes(leg.state) &&
          leg.submitted_signature !== null,
        "RECONCILIATION_NOT_REQUIRED",
      );
      const clock = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const now = clock.rows[0]!.now.getTime();
      const expired =
        leg.submitted_at === null ||
        now >= leg.submitted_at.getTime() + 24 * 60 * 60 * 1_000;
      if (expired || leg.recovery_attempts >= 3) {
        await client.query(
          "UPDATE c3_open.legs SET state='manual_review',updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2",
          [scope.intentId, ordinal],
        );
        const next = await bump(client, scope, "manual_review");
        await event(
          client,
          scope,
          next.dbRevision,
          "manual_review",
          ordinal,
          null,
          expired ? "RECOVERY_EXPIRED" : "RECOVERY_EXHAUSTED",
        );
        return next;
      }
      await client.query(
        `UPDATE c3_open.legs SET state='reconciliation_required',
          recovery_attempts=recovery_attempts+1,updated_at=clock_timestamp()
         WHERE intent_id=$1 AND ordinal=$2`,
        [scope.intentId, ordinal],
      );
      const next = await bump(client, scope, "reconciliation_required");
      await event(
        client,
        scope,
        next.dbRevision,
        "reconciliation_attempt",
        ordinal,
      );
      return next;
    });
  }
  /** Test-only finality hook; never exported by the production service entrypoint. */
  async recordLocalConfirmedLeg(
    scope: Scope,
    ordinal: number,
    attestation: Readonly<{
      source: "MOCK_LOCAL_ONLY";
      plan: string;
      signature: string;
      evidenceHash: string;
      chainRevision: bigint;
      observedEffects: Record<string, unknown>;
    }>,
  ): Promise<OpenSnapshot> {
    assert(attestation.source === "MOCK_LOCAL_ONLY", "MOCK_SOURCE_REQUIRED");
    return this.#commitLocalLeg(scope, ordinal, attestation);
  }
  /** No caller-supplied effects or proof. Read-only loopback RPC first, short
   * serializable CAS second. A failed/uncertain read never resends anything.
   */
  async reconcileLocalJupiterLeg(
    scope: Scope,
    ordinal: number,
    rpc: Connection,
  ): Promise<OpenSnapshot> {
    const proof = await reconcilePersistedOpenLeg(
      this.pool,
      rpc,
      scope.intentId,
      ordinal,
    );
    assert(
      proof.dbRevision === scope.expectedDbRevision &&
        proof.chainRevision === scope.expectedChainRevision + 1n,
      "COMPARE_AND_SWAP_CONFLICT",
    );
    return this.#commitLocalLeg(scope, ordinal, {
      source: "LOCAL_CHAIN_ONLY",
      plan: proof.plan,
      signature: proof.signature,
      evidenceHash: proof.evidenceHash,
      chainRevision: proof.chainRevision,
      observedEffects: {
        scope: proof.scope,
        inputAmount: proof.debit,
        outputAmount: proof.credit,
        planStateHash: proof.planStateHash,
        quoteId: proof.quoteId,
        authorizationHash: proof.authorizationHash,
        chainRevision: proof.chainRevision.toString(),
      },
      authorizationHash: proof.authorizationHash,
      quoteId: proof.quoteId,
    });
  }
  async #commitLocalLeg(
    scope: Scope,
    ordinal: number,
    attestation: Readonly<{
      source: "MOCK_LOCAL_ONLY" | "LOCAL_CHAIN_ONLY";
      plan: string;
      signature: string;
      evidenceHash: string;
      chainRevision: bigint;
      observedEffects: Record<string, unknown>;
      authorizationHash?: string;
      quoteId?: string;
    }>,
  ): Promise<OpenSnapshot> {
    assert(
      ["MOCK_LOCAL_ONLY", "LOCAL_CHAIN_ONLY"].includes(attestation.source) &&
        KEY.test(attestation.plan) &&
        SIGNATURE.test(attestation.signature) &&
        HASH.test(attestation.evidenceHash) &&
        attestation.chainRevision === scope.expectedChainRevision + 1n,
      "LOCAL_ATTESTATION_MISMATCH",
    );
    return atomic(this.pool, async (client) => {
      // Expiry forbids new execution, not recording an already finalized effect.
      // The preserved signature and bounded recovery window are still mandatory.
      const row = await locked(
        client,
        scope,
        attestation.source === "LOCAL_CHAIN_ONLY",
      );
      const expectedPlan = ordinal < 3 ? row.deposit_plan : row.redemption_plan;
      assert(attestation.plan === expectedPlan, "PLAN_MISMATCH");
      assert(
        (ordinal < 3 &&
          ["funded", "buying", "reconciliation_required"].includes(
            row.state,
          )) ||
          (ordinal >= 3 &&
            [
              "redemption_requested",
              "selling",
              "reconciliation_required",
            ].includes(row.state)),
        "INVALID_STATE",
      );
      if (ordinal > 0) {
        const previous = await legForUpdate(
          client,
          scope.intentId,
          ordinal - 1,
        );
        assert(previous.state === "confirmed", "PREVIOUS_LEG_NOT_CONFIRMED");
      }
      const leg = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        ["submitted", "reconciliation_required"].includes(leg.state) &&
          leg.submitted_signature === attestation.signature,
        "SUBMISSION_OR_SIGNATURE_MISMATCH",
      );
      if (
        attestation.source === "LOCAL_CHAIN_ONLY" ||
        leg.state === "reconciliation_required"
      ) {
        const clock = await client.query<{ now: Date }>(
          "SELECT clock_timestamp() AS now",
        );
        assert(
          (leg.state !== "reconciliation_required" ||
            leg.recovery_attempts >= 1) &&
            leg.recovery_attempts <= 3 &&
            leg.submitted_at !== null &&
            clock.rows[0]!.now.getTime() <
              leg.submitted_at.getTime() + 24 * 60 * 60 * 1_000,
          "RECOVERY_WINDOW_CLOSED",
        );
      }
      const seal = await signedOpenSeal(
        client,
        scope.intentId,
        ordinal,
        leg.authorization_hash!,
      );
      if (attestation.source === "MOCK_LOCAL_ONLY") {
        assert(
          !seal || seal.context_scope === "LOCAL_MOCK",
          "CLONED_LEG_REQUIRES_RPC_VERIFICATION",
        );
        const expectations = await client.query<{ expected_effects: unknown }>(
          "SELECT expected_effects FROM c3_open.legs WHERE intent_id=$1 AND ordinal=$2",
          [scope.intentId, ordinal],
        );
        const expected = expectations.rows[0]?.expected_effects;
        assert(
          expected && isDeepStrictEqual(expected, attestation.observedEffects),
          "LOCAL_EFFECT_MISMATCH",
        );
      } else {
        assert(
          seal &&
            seal.context_scope === "LOCAL_CLONE" &&
            seal.context.plan === attestation.plan &&
            BigInt(seal.context.planRevision) === scope.expectedChainRevision &&
            seal.context.leg === ordinal % 3 &&
            seal.context.direction === (ordinal < 3 ? 1 : 2) &&
            seal.quote_id.toString("hex") === attestation.quoteId &&
            leg.authorization_hash === attestation.authorizationHash &&
            seal.context.inputAmount ===
              attestation.observedEffects.inputAmount &&
            typeof attestation.observedEffects.outputAmount === "string" &&
            /^(0|[1-9][0-9]{0,19})$/.test(
              attestation.observedEffects.outputAmount,
            ) &&
            BigInt(attestation.observedEffects.outputAmount) >=
              seal.canonical_payload.readBigUInt64LE(131),
          "RPC_PROOF_OR_AUTHORIZATION_CHANGED",
        );
      }
      await client.query(
        `UPDATE c3_open.legs SET state='confirmed',chain_revision=$3,evidence_hash=$4,
          observed_effects=$5,updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2`,
        [
          scope.intentId,
          ordinal,
          attestation.chainRevision.toString(),
          attestation.evidenceHash,
          JSON.stringify(attestation.observedEffects),
        ],
      );
      if (seal)
        assert(
          (
            await client.query(
              "UPDATE c3_open.quote_authorizations SET state='consumed',revision=revision+1 WHERE quote_id=$1 AND state='signed'",
              [seal.quote_id],
            )
          ).rowCount === 1,
          "QUOTE_ALREADY_CONSUMED",
        );
      const next = await bump(
        client,
        scope,
        ordinal < 3 ? "buying" : "selling",
        attestation.chainRevision,
      );
      await event(
        client,
        scope,
        next.dbRevision,
        "confirmed",
        ordinal,
        attestation.evidenceHash,
      );
      return next;
    });
  }
  async readLeg(
    intentId: string,
    ordinal: number,
  ): Promise<
    Readonly<{
      state: string;
      signature: string | null;
      authorizationHash: string | null;
      recoveryAttempts: number;
      submittedAt: Date | null;
    }>
  > {
    assert(ID.test(intentId), "INVALID_ID");
    const leg = await this.pool.query<LegRow>(
      `SELECT state,submitted_signature,authorization_hash,recovery_attempts,submitted_at FROM c3_open.legs
       WHERE intent_id=$1 AND ordinal=$2`,
      [intentId, ordinal],
    );
    assert(leg.rows[0], "MISSING_LEG");
    return Object.freeze({
      state: leg.rows[0]!.state,
      signature: leg.rows[0]!.submitted_signature,
      authorizationHash: leg.rows[0]!.authorization_hash,
      recoveryAttempts: leg.rows[0]!.recovery_attempts,
      submittedAt: leg.rows[0]!.submitted_at,
    });
  }
}
