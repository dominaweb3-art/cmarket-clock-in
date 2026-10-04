/** Durable settlement journal, shared with isolated adapters. No migrations,
 * fixtures, keys, caller economic attestations or automatic broadcast/retries. */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { quoteContextHash } from "./quote-seal.ts";
import {
  openQuoteContext,
  type StoredQuoteContext,
} from "./open-quote-context.ts";
import { reconcileVerifiedOpenLeg } from "./open-leg-reconciler.ts";
import { C3_MAINNET } from "./constants.ts";
import { encodeBase58 as encode } from "./solana.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { assertProductionEnrollment } from "./open-owner-trust.ts";
import { productionQuorumConnection } from "./open-quorum-connection.ts";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  HASH = /^[a-f0-9]{64}$/,
  SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const assert = (c: unknown, s: string): void => {
  if (!c) throw Error("C3_OPEN_" + s);
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
    "SELECT 1 FROM c3_open.all_quote_contexts WHERE intent_id=$1 AND ordinal=$2 LIMIT 1",
    [intentId, ordinal],
  );
  assert(enrolled.rowCount, "VERIFIED_CONTEXT_REQUIRED");
  const q = (
    await client.query(
      `SELECT q.*,ctx.context,ctx.context_hash,ctx.scope AS context_scope FROM c3_open.quote_authorizations q
    JOIN c3_open.all_quote_contexts ctx USING(intent_id,ordinal,intent_revision)
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
    context_scope: "MAINNET_REVIEWED" | "ISOLATED_VERIFIED";
  };
}

/** Explicit migration; production bootstrap never calls this. */
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
  if (!allowExpired) {
    const window = await client.query(
      `SELECT 1 FROM c3_open.plan_generations WHERE intent_id=$1
      AND plan=$2 AND expires_at>clock_timestamp() AND base_revision<=$3
      AND generation=(SELECT max(generation) FROM c3_open.plan_generations WHERE intent_id=$1 AND plan=$2)`,
      [
        scope.intentId,
        ["redemption_requested", "selling", "claimable", "redeemed"].includes(
          row.state,
        )
          ? row.redemption_plan
          : row.deposit_plan,
        row.chain_revision,
      ],
    );
    assert(row.expires_at.getTime() > Date.now() || window.rowCount, "EXPIRED");
  }
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
export class VerifiedSettlementJournal {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
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
      // The same intent lock serializes keeper preparation. Never advance its
      // CAS revision while an immutable keeper packet awaits reconciliation.
      const pendingKeeper = await client.query(
        `SELECT 1 FROM c3_open.keeper_packets k
         LEFT JOIN c3_open.keeper_effect_receipts e USING(request_id)
         LEFT JOIN c3_open.keeper_request_outcomes o USING(request_id)
         WHERE k.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL LIMIT 1`,
        [scope.intentId],
      );
      assert(!pendingKeeper.rowCount, "KEEPER_RECONCILE_PENDING");
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
  private async recordSignature(
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

  async recordSignedExecution(
    scope: Scope,
    ordinal: number,
    worker: string,
    packet: Uint8Array,
  ) {
    assert(packet.length <= 1232, "PACKET_SIZE");
    const tx = VersionedTransaction.deserialize(packet);
    assert(
      tx.message.version === 0 &&
        tx.message.header.numRequiredSignatures === 1 &&
        tx.signatures.length === 1,
      "SIGNERS",
    );
    const q = (
      await this.pool.query(
        "SELECT q.*,v.context FROM c3_open.quote_authorizations q JOIN c3_open.all_quote_contexts v USING(intent_id,ordinal,intent_revision) WHERE q.intent_id=$1 AND q.ordinal=$2 AND q.state='signed'",
        [scope.intentId, ordinal],
      )
    ).rows[0];
    const key = tx.message.staticAccountKeys[0]!;
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        key.toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    assert(
      q &&
        key.toBase58() === q.context.keeper &&
        createHash("sha256").update(tx.message.serialize()).digest("hex") ===
          q.evidence.executionMessageHash &&
        verify(null, tx.message.serialize(), publicKey, tx.signatures[0]!),
      "SIGNED_EXECUTION_CHANGED",
    );
    return this.recordSignature(
      scope,
      ordinal,
      worker,
      encode(tx.signatures[0]!),
      q.payload_hash.toString("hex"),
    );
  }
  async reconcile(
    scope: Scope,
    ordinal: number,
    rpc: Connection,
    expectedScope: "MAINNET_REVIEWED" | "ISOLATED_VERIFIED",
    genesis: string,
  ) {
    assert(
      (expectedScope === "MAINNET_REVIEWED") ===
        (genesis === C3_MAINNET.genesisHash),
      "CLUSTER_SCOPE",
    );
    if (expectedScope === "MAINNET_REVIEWED") {
      const approved = requireOpenProductionPolicy();
      await assertProductionEnrollment(
        this.pool,
        approved,
        scope.intentId,
        "intent",
      );
      // Production cannot substitute caller RPCs or self-certified evidence.
      rpc = productionQuorumConnection();
    }
    const proof = await reconcileVerifiedOpenLeg(
      this.pool,
      rpc,
      scope.intentId,
      ordinal,
      expectedScope,
      genesis,
    );
    assert(
      proof.dbRevision === scope.expectedDbRevision &&
        proof.chainRevision === scope.expectedChainRevision + 1n,
      "COMPARE_AND_SWAP_CONFLICT",
    );
    return atomic(this.pool, async (client) => {
      const row = await locked(client, scope, true),
        l = await legForUpdate(client, scope.intentId, ordinal);
      assert(
        proof.plan === (ordinal < 3 ? row.deposit_plan : row.redemption_plan) &&
          ["submitted", "reconciliation_required"].includes(l.state) &&
          l.submitted_signature === proof.signature,
        "RECONCILIATION_STATE",
      );
      assert(
        (ordinal < 3
          ? ["funded", "buying", "reconciliation_required"]
          : ["redemption_requested", "selling", "reconciliation_required"]
        ).includes(row.state),
        "INVALID_STATE",
      );
      if (ordinal > 0)
        assert(
          (await legForUpdate(client, scope.intentId, ordinal - 1)).state ===
            "confirmed",
          "PREVIOUS_LEG_NOT_CONFIRMED",
        );
      const seal = await signedOpenSeal(
        client,
        scope.intentId,
        ordinal,
        l.authorization_hash!,
      );
      assert(
        seal &&
          seal.context_scope === expectedScope &&
          seal.quote_id.toString("hex") === proof.quoteId &&
          seal.context.inputAmount === proof.debit &&
          BigInt(proof.credit) >= seal.canonical_payload.readBigUInt64LE(131),
        "EFFECT_OR_CONTEXT_CHANGED",
      );
      const now = (await client.query("SELECT clock_timestamp() AS now"))
        .rows[0].now as Date;
      assert(
        l.submitted_at &&
          l.recovery_attempts <= 3 &&
          now.getTime() < l.submitted_at.getTime() + 86400000 &&
          (l.state !== "reconciliation_required" || l.recovery_attempts >= 1),
        "RECOVERY_WINDOW_CLOSED",
      );
      const observed = {
        scope: "SEMANTIC_EFFECTS_VERIFIED",
        inputAmount: proof.debit,
        outputAmount: proof.credit,
        planStateHash: proof.planStateHash,
        planStateBase64: proof.planStateBase64,
        quoteId: proof.quoteId,
        authorizationHash: proof.authorizationHash,
        chainRevision: proof.chainRevision.toString(),
      };
      await client.query(
        "UPDATE c3_open.legs SET state='confirmed',chain_revision=$3,evidence_hash=$4,observed_effects=$5,updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2",
        [
          scope.intentId,
          ordinal,
          proof.chainRevision.toString(),
          proof.evidenceHash,
          observed,
        ],
      );
      assert(
        (
          await client.query(
            "UPDATE c3_open.quote_authorizations SET state='consumed',revision=revision+1 WHERE quote_id=$1 AND state='signed'",
            [seal!.quote_id],
          )
        ).rowCount === 1,
        "QUOTE_ALREADY_CONSUMED",
      );
      const next = await bump(
        client,
        scope,
        ordinal < 3 ? "buying" : "selling",
        proof.chainRevision,
      );
      await event(
        client,
        scope,
        next.dbRevision,
        "confirmed",
        ordinal,
        proof.evidenceHash,
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
