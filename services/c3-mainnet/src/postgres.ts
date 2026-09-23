/** Server-only, disabled Mainnet persistence foundation. Not an execution API. */
import { createHash, randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";

import { loadAuthorizationRecord } from "./builder.ts";
import {
  C3_AMOUNTS,
  C3_MAINNET,
  assertExecutionDisabled,
} from "./constants.ts";
import { canonicalize } from "./manifest.ts";
import { assertC3SchemaCurrent } from "./migrations.ts";
import {
  assertIntentTransition,
  assertVerifiedSettlementEvidence,
  type IntentState,
  type VerifiedSettlementEvidence,
} from "./reconciliation.ts";

const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const INTENT_ID = /^c3-[a-f0-9]{32,64}$/;
const U64_MAX = C3_AMOUNTS.u64Max;
const allowedOperations = new Set([
  "seed_deposit",
  "deposit_intent",
  "rebalance_intent",
  "redemption_intent",
  "usdc_withdrawal",
  "emergency_pause",
]);

type IntentRow = {
  intent_id: string;
  idempotency_key: string;
  configuration_version: string;
  configuration_hash: string;
  cluster: string;
  wallet: string;
  operation: string;
  input_amount: string;
  state: IntentState;
  revision: string;
  authorization_id: string | null;
  authorization_hash: string | null;
  submitted_signature: string | null;
  settled_effects_hash: string | null;
  partial_completion_hash: string | null;
  manual_review_reason: string | null;
  recovery_attempts: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
};

const INTENT_COLUMNS = `intent_id,idempotency_key,configuration_version,configuration_hash,
  cluster,wallet,operation,input_amount,state,revision,authorization_id,authorization_hash,
  submitted_signature,settled_effects_hash,partial_completion_hash,manual_review_reason,
  recovery_attempts,created_at,updated_at,expires_at`;

export type DurableIntent = Readonly<{
  intentId: string;
  idempotencyKey: string;
  configurationVersion: string;
  configurationHash: string;
  cluster: "mainnet-beta";
  wallet: string;
  operation: string;
  inputAmountBaseUnits: bigint;
  state: IntentState;
  revision: bigint;
  authorizationId: string | null;
  authorizationHash: string | null;
  submittedSignature: string | null;
  settledEffectsHash: string | null;
  partialCompletionHash: string | null;
  manualReviewReason: string | null;
  recoveryAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}>;

export type NewDurableIntent = Readonly<{
  intentId: string;
  idempotencyKey: string;
  configurationVersion: string;
  configurationHash: string;
  wallet: string;
  operation: string;
  inputAmountBaseUnits: bigint;
  expiresAt: Date;
}>;

export function validateNewDurableIntent(input: NewDurableIntent): void {
  if (
    !INTENT_ID.test(input.intentId) ||
    !HASH.test(input.idempotencyKey) ||
    !HASH.test(input.configurationHash) ||
    !KEY.test(input.wallet) ||
    !allowedOperations.has(input.operation) ||
    input.inputAmountBaseUnits <= 0n ||
    input.inputAmountBaseUnits > U64_MAX ||
    !input.configurationVersion ||
    !(input.expiresAt instanceof Date) ||
    !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt.getTime() <= Date.now()
  )
    throw new Error("New C3 intent is malformed.");
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function assertHash(value: string): void {
  if (!HASH.test(value)) throw new Error("Malformed C3 fingerprint.");
}

function assertSafeMetadata(value: Readonly<Record<string, string>>): void {
  const allowed = new Set([
    "intentId",
    "revision",
    "state",
    "fingerprint",
    "signature",
    "reasonCode",
  ]);
  if (
    Object.entries(value).some(
      ([key, item]) =>
        !allowed.has(key) || typeof item !== "string" || item.length > 128,
    )
  )
    throw new Error("Outbox or audit metadata is not allowlisted.");
}

function decodeIntent(row: IntentRow): DurableIntent {
  const amount = BigInt(row.input_amount);
  const revision = BigInt(row.revision);
  if (
    !INTENT_ID.test(row.intent_id) ||
    !HASH.test(row.idempotency_key) ||
    !HASH.test(row.configuration_hash) ||
    row.cluster !== C3_MAINNET.cluster ||
    !KEY.test(row.wallet) ||
    !allowedOperations.has(row.operation) ||
    amount <= 0n ||
    amount > U64_MAX ||
    revision < 1n ||
    row.recovery_attempts < 0 ||
    row.recovery_attempts > 3 ||
    (row.authorization_hash !== null && !HASH.test(row.authorization_hash)) ||
    (row.submitted_signature !== null &&
      !SIGNATURE.test(row.submitted_signature)) ||
    (row.settled_effects_hash !== null &&
      !HASH.test(row.settled_effects_hash)) ||
    (row.partial_completion_hash !== null &&
      !HASH.test(row.partial_completion_hash)) ||
    (row.state === "settled" && !row.settled_effects_hash) ||
    (row.state === "partially_completed" && !row.partial_completion_hash) ||
    (row.state === "failed_recoverable" &&
      (!row.authorization_id || !row.submitted_signature)) ||
    (row.state === "manual_review" && !row.manual_review_reason) ||
    ([
      "intent_submitted",
      "keeper_pending",
      "partially_completed",
      "settled",
    ].includes(row.state) &&
      (!row.authorization_id ||
        !row.authorization_hash ||
        !row.submitted_signature))
  )
    throw new Error(
      "Durable C3 intent failed validation; manual review required.",
    );
  return Object.freeze({
    intentId: row.intent_id,
    idempotencyKey: row.idempotency_key,
    configurationVersion: row.configuration_version,
    configurationHash: row.configuration_hash,
    cluster: "mainnet-beta",
    wallet: row.wallet,
    operation: row.operation,
    inputAmountBaseUnits: amount,
    state: row.state,
    revision,
    authorizationId: row.authorization_id,
    authorizationHash: row.authorization_hash,
    submittedSignature: row.submitted_signature,
    settledEffectsHash: row.settled_effects_hash,
    partialCompletionHash: row.partial_completion_hash,
    manualReviewReason: row.manual_review_reason,
    recoveryAttempts: row.recovery_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  });
}

export class PostgresC3Repository {
  readonly durable = true;
  readonly #pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  static async fromServerEnvironment(): Promise<PostgresC3Repository> {
    assertExecutionDisabled();
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("Server-side DATABASE_URL is missing.");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("Server-side DATABASE_URL is malformed.");
    }
    if (
      !new Set(["postgres:", "postgresql:"]).has(url.protocol) ||
      !url.hostname ||
      !url.pathname ||
      url.pathname === "/"
    )
      throw new Error("Server-side DATABASE_URL is malformed.");
    if (
      !new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname) &&
      url.searchParams.get("sslmode") !== "verify-full"
    )
      throw new Error(
        "Remote database requires independently verified TLS configuration.",
      );
    const pool = new pg.Pool({
      connectionString: raw,
      max: 5,
      options:
        "-c search_path=c3,pg_catalog,pg_temp -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000",
    });
    try {
      await assertC3SchemaCurrent(pool);
      return new PostgresC3Repository(pool);
    } catch {
      await pool.end();
      throw new Error(
        "C3 database bootstrap failed; schema or connection unavailable.",
      );
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #event(
    client: PoolClient,
    intentId: string,
    eventType: string,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void> {
    assertSafeMetadata(metadata);
    const fingerprint = hash({ intentId, eventType, metadata });
    const safeJson = JSON.stringify(metadata);
    await client.query(
      "INSERT INTO c3_outbox_events (event_id,intent_id,idempotency_key,event_type,payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [randomUUID(), intentId, fingerprint, eventType, safeJson],
    );
    await client.query(
      "INSERT INTO c3_audit_log (audit_id,intent_id,event_type,event_hash,actor_kind,safe_metadata) VALUES ($1,$2,$3,$4,'system',$5::jsonb)",
      [randomUUID(), intentId, eventType, fingerprint, safeJson],
    );
  }

  async createIntent(input: NewDurableIntent): Promise<DurableIntent> {
    assertExecutionDisabled();
    validateNewDurableIntent(input);
    const requestHash = hash({
      ...input,
      inputAmountBaseUnits: input.inputAmountBaseUnits.toString(),
      expiresAt: input.expiresAt.toISOString(),
    });
    return this.#transaction(async (client) => {
      const inserted = await client.query<IntentRow>(
        `INSERT INTO c3_intents (intent_id,idempotency_key,configuration_version,configuration_hash,cluster,wallet,operation,input_amount,state,expires_at)
         VALUES ($1,$2,$3,$4,'mainnet-beta',$5,$6,$7,'draft',$8) RETURNING ${INTENT_COLUMNS}`,
        [
          input.intentId,
          input.idempotencyKey,
          input.configurationVersion,
          input.configurationHash,
          input.wallet,
          input.operation,
          input.inputAmountBaseUnits.toString(),
          input.expiresAt,
        ],
      );
      await client.query(
        "INSERT INTO c3_idempotency_keys (key_hash,intent_id,request_hash) VALUES ($1,$2,$3)",
        [input.idempotencyKey, input.intentId, requestHash],
      );
      await this.#event(client, input.intentId, "state_transition", {
        intentId: input.intentId,
        revision: "1",
        state: "draft",
      });
      const row = inserted.rows[0];
      if (!row) throw new Error("Intent insertion yielded no row.");
      return decodeIntent(row);
    });
  }

  async readIntent(intentId: string): Promise<DurableIntent | undefined> {
    if (!INTENT_ID.test(intentId))
      throw new Error("Malformed intent identifier.");
    const result = await this.#pool.query<IntentRow>(
      `SELECT ${INTENT_COLUMNS} FROM c3_intents WHERE intent_id=$1`,
      [intentId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const intent = decodeIntent(row);
    if (intent.authorizationHash) await this.readAuthorization(intentId);
    return intent;
  }

  async readAuthorization(
    intentId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.#pool.query<{
      canonical_json: string;
      authorization_hash: string;
      idempotency_key: string;
      configuration_hash: string;
      wallet: string;
      operation: string;
      input_amount: string;
    }>(
      `SELECT a.canonical_json,a.authorization_hash,i.idempotency_key,i.configuration_hash,i.wallet,i.operation,i.input_amount
       FROM c3_authorizations a JOIN c3_intents i ON i.authorization_id=a.authorization_id AND i.intent_id=a.intent_id
       WHERE i.intent_id=$1`,
      [intentId],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error(
        "Durable authorization is absent; manual review required.",
      );
    let value: unknown;
    try {
      value = JSON.parse(row.canonical_json);
    } catch {
      throw new Error("Durable authorization JSON is corrupt.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Durable authorization is corrupt.");
    const record = value as Record<string, unknown>;
    const { authorizationHash, ...payload } = record;
    if (
      canonicalize(record) !== row.canonical_json ||
      authorizationHash !== row.authorization_hash ||
      hash(payload) !== row.authorization_hash ||
      record.intentId !== intentId ||
      record.idempotencyKey !== row.idempotency_key ||
      record.configurationHash !== row.configuration_hash ||
      record.wallet !== row.wallet ||
      record.operation !== row.operation ||
      record.inputAmountBaseUnits !== row.input_amount
    )
      throw new Error(
        "Durable authorization fingerprint or intent binding differs; manual review required.",
      );
    return Object.freeze(record);
  }

  async createAuthorization(
    intentId: string,
    expectedRevision: bigint,
  ): Promise<string> {
    assertExecutionDisabled();
    // Only the sealed builder can supply a trusted authorization. The repository
    // never accepts an arbitrary policy or manifest from its caller.
    const record: Record<string, unknown> = loadAuthorizationRecord(
      intentId,
    ) as unknown as Record<string, unknown>;
    const canonicalJson = canonicalize(record);
    const { authorizationHash, ...payload } = record;
    if (
      typeof authorizationHash !== "string" ||
      !HASH.test(authorizationHash) ||
      hash(payload) !== authorizationHash ||
      canonicalize(record) !== canonicalJson
    )
      throw new Error("Authorization canonical hash is invalid.");
    return this.#transaction(async (client) => {
      const result = await client.query<IntentRow>(
        `SELECT ${INTENT_COLUMNS} FROM c3_intents WHERE intent_id=$1 FOR UPDATE`,
        [intentId],
      );
      const current = result.rows[0] && decodeIntent(result.rows[0]);
      if (
        !current ||
        current.revision !== expectedRevision ||
        current.state !== "awaiting_wallet" ||
        current.authorizationHash
      )
        throw new Error("Authorization compare-and-swap conflict.");
      if (
        record.intentId !== intentId ||
        record.idempotencyKey !== current.idempotencyKey ||
        record.configurationHash !== current.configurationHash ||
        record.wallet !== current.wallet ||
        record.operation !== current.operation ||
        record.inputAmountBaseUnits !== current.inputAmountBaseUnits.toString()
      )
        throw new Error("Authorization does not bind the durable intent.");
      const authorizationId = randomUUID();
      await client.query(
        "INSERT INTO c3_authorizations (authorization_id,intent_id,intent_revision,authorization_hash,canonical_json) VALUES ($1,$2,$3,$4,$5)",
        [
          authorizationId,
          intentId,
          expectedRevision.toString(),
          authorizationHash,
          canonicalJson,
        ],
      );
      const updated = await client.query(
        "UPDATE c3_intents SET authorization_id=$1,authorization_hash=$2,revision=revision+1,updated_at=clock_timestamp() WHERE intent_id=$3 AND revision=$4 AND state='awaiting_wallet' AND authorization_id IS NULL",
        [
          authorizationId,
          authorizationHash,
          intentId,
          expectedRevision.toString(),
        ],
      );
      if (updated.rowCount !== 1)
        throw new Error("Authorization compare-and-swap conflict.");
      await this.#event(client, intentId, "authorization_created", {
        intentId,
        revision: (expectedRevision + 1n).toString(),
        fingerprint: authorizationHash,
      });
      return authorizationId;
    });
  }

  async transition(
    intentId: string,
    expectedRevision: bigint,
    nextState: IntentState,
    patch: Readonly<{
      submittedSignature?: string;
      settledEffectsHash?: string;
      partialCompletionHash?: string;
      manualReviewReason?: string;
    }> = {},
  ): Promise<DurableIntent> {
    assertExecutionDisabled();
    const keys = Object.keys(patch);
    if (
      keys.some(
        (key) =>
          ![
            "submittedSignature",
            "settledEffectsHash",
            "partialCompletionHash",
            "manualReviewReason",
          ].includes(key),
      )
    )
      throw new Error("Transition patch contains an unknown field.");
    return this.#transaction(async (client) => {
      const result = await client.query<IntentRow>(
        `SELECT ${INTENT_COLUMNS} FROM c3_intents WHERE intent_id=$1 FOR UPDATE`,
        [intentId],
      );
      const current = result.rows[0] && decodeIntent(result.rows[0]);
      if (!current || current.revision !== expectedRevision)
        throw new Error("Atomic compare-and-swap conflict.");
      assertIntentTransition(current.state, nextState);
      if (current.authorizationHash) await this.readAuthorization(intentId);
      if (
        patch.submittedSignature &&
        (nextState !== "intent_submitted" ||
          current.state !== "awaiting_wallet" ||
          !SIGNATURE.test(patch.submittedSignature) ||
          !current.authorizationHash)
      )
        throw new Error("Unsafe signature transition.");
      if (nextState === "intent_submitted" && !patch.submittedSignature)
        throw new Error("Submission signature is required.");
      if (patch.settledEffectsHash || nextState === "settled")
        throw new Error(
          "Settlement requires independent verified evidence; generic transition forbidden.",
        );
      if (patch.partialCompletionHash || nextState === "partially_completed")
        throw new Error(
          "Partial completion requires independent verified evidence; generic transition forbidden.",
        );
      if (
        patch.manualReviewReason &&
        (nextState !== "manual_review" || patch.manualReviewReason.length > 128)
      )
        throw new Error("Invalid manual review reason.");
      if (nextState === "manual_review" && !patch.manualReviewReason)
        throw new Error("Manual review requires a reason.");
      if (
        nextState === "keeper_pending" &&
        current.state === "failed_recoverable"
      )
        throw new Error("Use the durable bounded recovery operation.");
      const clock = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const serverNow = clock.rows[0]?.now;
      if (!serverNow) throw new Error("Database clock unavailable.");
      if (
        serverNow.getTime() >= current.expiresAt.getTime() &&
        !["manual_review", "expired"].includes(nextState)
      )
        throw new Error("Intent expired; manual review required.");
      const updated = await client.query<IntentRow>(
        `UPDATE c3_intents SET state=$1,revision=revision+1,updated_at=clock_timestamp(),
         submitted_signature=COALESCE($2,submitted_signature),manual_review_reason=COALESCE($3,manual_review_reason)
         WHERE intent_id=$4 AND revision=$5 AND state=$6 RETURNING ${INTENT_COLUMNS}`,
        [
          nextState,
          patch.submittedSignature ?? null,
          patch.manualReviewReason ?? null,
          intentId,
          expectedRevision.toString(),
          current.state,
        ],
      );
      if (updated.rowCount !== 1 || !updated.rows[0])
        throw new Error("Atomic compare-and-swap conflict.");
      await this.#event(client, intentId, "state_transition", {
        intentId,
        revision: (expectedRevision + 1n).toString(),
        state: nextState,
      });
      return decodeIntent(updated.rows[0]);
    });
  }

  async recordRecoveryAttempt(
    intentId: string,
    expectedRevision: bigint,
    evidenceHash: string,
  ): Promise<DurableIntent> {
    assertHash(evidenceHash);
    return this.#transaction(async (client) => {
      const result = await client.query<IntentRow>(
        `SELECT ${INTENT_COLUMNS} FROM c3_intents WHERE intent_id=$1 FOR UPDATE`,
        [intentId],
      );
      const current = result.rows[0] && decodeIntent(result.rows[0]);
      if (
        !current ||
        current.revision !== expectedRevision ||
        current.state !== "failed_recoverable" ||
        !current.submittedSignature
      )
        throw new Error("Recovery compare-and-swap conflict.");
      const now = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const serverNow = now.rows[0]?.now;
      if (!serverNow) throw new Error("Database clock unavailable.");
      if (
        current.recoveryAttempts >= 3 ||
        serverNow.getTime() >=
          Math.min(
            current.expiresAt.getTime(),
            current.createdAt.getTime() + 86_400_000,
          )
      ) {
        const reasonCode =
          current.recoveryAttempts >= 3
            ? "recovery_attempts_exhausted"
            : "recovery_window_expired";
        const reviewed = await client.query<IntentRow>(
          `UPDATE c3_intents SET state='manual_review',revision=revision+1,updated_at=$1,manual_review_reason=$2 WHERE intent_id=$3 AND revision=$4 AND state='failed_recoverable' RETURNING ${INTENT_COLUMNS}`,
          [serverNow, reasonCode, intentId, expectedRevision.toString()],
        );
        if (reviewed.rowCount !== 1 || !reviewed.rows[0])
          throw new Error("Recovery compare-and-swap conflict.");
        await this.#event(client, intentId, "recovery_attempt", {
          intentId,
          revision: (expectedRevision + 1n).toString(),
          reasonCode,
          signature: current.submittedSignature,
        });
        return decodeIntent(reviewed.rows[0]);
      }
      const attempt = current.recoveryAttempts + 1;
      const updated = await client.query<IntentRow>(
        `UPDATE c3_intents SET state='keeper_pending',revision=revision+1,recovery_attempts=recovery_attempts+1,updated_at=$1 WHERE intent_id=$2 AND revision=$3 AND state='failed_recoverable' AND recovery_attempts=$4 RETURNING ${INTENT_COLUMNS}`,
        [
          serverNow,
          intentId,
          expectedRevision.toString(),
          current.recoveryAttempts,
        ],
      );
      if (updated.rowCount !== 1 || !updated.rows[0])
        throw new Error("Recovery compare-and-swap conflict.");
      await client.query(
        "INSERT INTO c3_recovery_attempts (attempt_id,intent_id,attempt_number,submitted_signature,evidence_hash) VALUES ($1,$2,$3,$4,$5)",
        [
          randomUUID(),
          intentId,
          attempt,
          current.submittedSignature,
          evidenceHash,
        ],
      );
      await this.#event(client, intentId, "recovery_attempt", {
        intentId,
        revision: (expectedRevision + 1n).toString(),
        fingerprint: evidenceHash,
        signature: current.submittedSignature,
      });
      return decodeIntent(updated.rows[0]);
    });
  }

  async settleWithVerifiedEvidence(
    intentId: string,
    expectedRevision: bigint,
    evidence: VerifiedSettlementEvidence,
  ): Promise<DurableIntent> {
    return this.#transaction(async (client) => {
      const result = await client.query<IntentRow>(
        `SELECT ${INTENT_COLUMNS} FROM c3_intents WHERE intent_id=$1 FOR UPDATE`,
        [intentId],
      );
      const current = result.rows[0] && decodeIntent(result.rows[0]);
      if (
        !current ||
        current.revision !== expectedRevision ||
        !current.submittedSignature
      )
        throw new Error("Settlement compare-and-swap conflict.");
      assertIntentTransition(current.state, "settled");
      assertVerifiedSettlementEvidence(evidence, current.submittedSignature);
      const clock = await client.query<{ now: Date }>(
        "SELECT clock_timestamp() AS now",
      );
      const serverNow = clock.rows[0]?.now;
      if (!serverNow) throw new Error("Database clock unavailable.");
      if (serverNow.getTime() >= current.expiresAt.getTime())
        throw new Error("Expired settlement requires manual review.");
      await client.query(
        "INSERT INTO c3_evidence (evidence_id,intent_id,evidence_kind,fingerprint,signature) VALUES ($1,$2,'settlement',$3,$4)",
        [
          randomUUID(),
          intentId,
          evidence.effectsFingerprint,
          evidence.signature,
        ],
      );
      const updated = await client.query<IntentRow>(
        `UPDATE c3_intents SET state='settled',revision=revision+1,updated_at=clock_timestamp(),settled_effects_hash=$1 WHERE intent_id=$2 AND revision=$3 AND state=$4 RETURNING ${INTENT_COLUMNS}`,
        [
          evidence.effectsFingerprint,
          intentId,
          expectedRevision.toString(),
          current.state,
        ],
      );
      if (updated.rowCount !== 1 || !updated.rows[0])
        throw new Error("Settlement compare-and-swap conflict.");
      await this.#event(client, intentId, "reconciliation_decision", {
        intentId,
        revision: (expectedRevision + 1n).toString(),
        fingerprint: evidence.effectsFingerprint,
        signature: evidence.signature,
        state: "settled",
      });
      return decodeIntent(updated.rows[0]);
    });
  }

  /** Outbox delivery is not a blockchain retry. Delivery claim is CAS-bounded. */
  async claimOutboxEvent(
    eventId: string,
    expectedRevision: bigint,
  ): Promise<Readonly<{ eventId: string; attempt: number }> | undefined> {
    return this.#transaction(async (client) => {
      await client.query(
        `UPDATE c3_outbox_events SET status='dead_letter',lease_until=NULL,
         revision=revision+1,updated_at=clock_timestamp()
         WHERE event_id=$1 AND revision=$2 AND status='processing'
           AND delivery_attempts>=5 AND lease_until<clock_timestamp()`,
        [eventId, expectedRevision.toString()],
      );
      const result = await client.query<{
        event_id: string;
        delivery_attempts: number;
      }>(
        `UPDATE c3_outbox_events SET status='processing',delivery_attempts=delivery_attempts+1,
         revision=revision+1,updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes'
         WHERE event_id=$1 AND revision=$2 AND
           (status='pending' OR (status='processing' AND lease_until < clock_timestamp()))
           AND delivery_attempts<5
         RETURNING event_id,delivery_attempts`,
        [eventId, expectedRevision.toString()],
      );
      const row = result.rows[0];
      return row
        ? Object.freeze({
            eventId: row.event_id,
            attempt: row.delivery_attempts,
          })
        : undefined;
    });
  }

  async finishOutboxEvent(
    eventId: string,
    expectedRevision: bigint,
    delivered: boolean,
  ): Promise<void> {
    await this.#transaction(async (client) => {
      const result = await client.query(
        `UPDATE c3_outbox_events
         SET status=CASE WHEN $3::boolean THEN 'delivered'
           WHEN delivery_attempts>=5 THEN 'dead_letter' ELSE 'pending' END,
           lease_until=NULL,revision=revision+1,updated_at=clock_timestamp()
         WHERE event_id=$1 AND revision=$2 AND status='processing' AND lease_until>=clock_timestamp()`,
        [eventId, expectedRevision.toString(), delivered],
      );
      if (result.rowCount !== 1)
        throw new Error("Outbox delivery compare-and-swap conflict.");
    });
  }
}
