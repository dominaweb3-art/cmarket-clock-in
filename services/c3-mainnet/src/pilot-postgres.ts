/** Durable owner-pilot metadata. This module cannot authorize or report an on-chain success. */
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { C3_PILOT } from "./pilot-config.ts";
import { assertC3PilotSchemaCurrent } from "./migrations.ts";
import {
  assertPilotTransition,
  type PilotKind,
  type PilotState,
} from "./pilot-state.ts";

const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^c3p-[a-f0-9]{32}$/;
type Row = {
  intent_id: string;
  kind: PilotKind;
  linked_deposit_id: string | null;
  wallet: string;
  cluster: string;
  vault: string;
  share_mint: string;
  amount_base_units: string;
  configuration_hash: string;
  state: PilotState;
  revision: string;
  manual_review_reason: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
};
const COLUMNS = `intent_id,kind,linked_deposit_id,wallet,cluster,vault,share_mint,
  amount_base_units,configuration_hash,state,revision,manual_review_reason,
  created_at,updated_at,expires_at`;
export type PilotIntent = Readonly<{
  intentId: string;
  kind: PilotKind;
  linkedDepositId: string | null;
  wallet: string;
  cluster: "mainnet-beta";
  vault: string;
  shareMint: string;
  amountBaseUnits: bigint;
  configurationHash: string;
  state: PilotState;
  revision: bigint;
  manualReviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}>;
export type PilotDraft = Readonly<{
  intentId: string;
  kind: PilotKind;
  linkedDepositId: string | null;
  wallet: string;
  vault: string;
  shareMint: string;
  amountBaseUnits: bigint;
  configurationHash: string;
  idempotencyKey: string;
  expiresAt: Date;
}>;

function decode(row: Row): PilotIntent {
  if (
    !ID.test(row.intent_id) ||
    !KEY.test(row.wallet) ||
    !KEY.test(row.vault) ||
    !KEY.test(row.share_mint) ||
    !HASH.test(row.configuration_hash) ||
    row.cluster !== "mainnet-beta" ||
    BigInt(row.revision) < 1n ||
    BigInt(row.amount_base_units) < 1n ||
    !Number.isFinite(row.expires_at.getTime())
  )
    throw new Error("C3_PILOT_CORRUPT_STATE_MANUAL_REVIEW");
  return Object.freeze({
    intentId: row.intent_id,
    kind: row.kind,
    linkedDepositId: row.linked_deposit_id,
    wallet: row.wallet,
    cluster: "mainnet-beta",
    vault: row.vault,
    shareMint: row.share_mint,
    amountBaseUnits: BigInt(row.amount_base_units),
    configurationHash: row.configuration_hash,
    state: row.state,
    revision: BigInt(row.revision),
    manualReviewReason: row.manual_review_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  });
}

async function atomic<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Use only with an explicitly migrated server-side PostgreSQL pool. Not exported from the package entrypoint. */
export class DisabledPilotRepository {
  private readonly pool: Pool;
  private constructor(pool: Pool) {
    this.pool = pool;
  }

  static async fromVerifiedPool(pool: Pool): Promise<DisabledPilotRepository> {
    await assertC3PilotSchemaCurrent(pool);
    return new DisabledPilotRepository(pool);
  }

  async readIntent(intentId: string): Promise<PilotIntent | null> {
    if (!ID.test(intentId)) throw new Error("C3_PILOT_INVALID_ID");
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM c3.c3_pilot_intents WHERE intent_id=$1`,
      [intentId],
    );
    return result.rows[0] ? decode(result.rows[0]) : null;
  }

  async listActivity(wallet: string): Promise<readonly PilotIntent[]> {
    if (!KEY.test(wallet)) throw new Error("C3_PILOT_INVALID_WALLET");
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM c3.c3_pilot_intents WHERE wallet=$1 ORDER BY created_at DESC LIMIT 50`,
      [wallet],
    );
    return Object.freeze(result.rows.map(decode));
  }

  /** Records only a disabled draft. It never builds, authorizes, signs or submits. */
  async createDisabledDraft(input: PilotDraft): Promise<PilotIntent> {
    if (
      !ID.test(input.intentId) ||
      !KEY.test(input.wallet) ||
      !KEY.test(input.vault) ||
      !KEY.test(input.shareMint) ||
      !HASH.test(input.configurationHash) ||
      !HASH.test(input.idempotencyKey) ||
      (input.kind === "deposit" &&
        (input.linkedDepositId !== null ||
          input.amountBaseUnits !== C3_PILOT.amountUsdcBaseUnits)) ||
      (input.kind === "redemption" && !ID.test(input.linkedDepositId ?? "")) ||
      !(input.expiresAt instanceof Date) ||
      !Number.isFinite(input.expiresAt.getTime())
    )
      throw new Error("C3_PILOT_INVALID_DRAFT");
    return atomic(this.pool, async (client) => {
      const state = input.kind === "deposit" ? "draft" : "redemption_draft";
      if (input.kind === "redemption") {
        const linked = await client.query<Row>(
          `SELECT ${COLUMNS} FROM c3.c3_pilot_intents WHERE intent_id=$1 FOR UPDATE`,
          [input.linkedDepositId],
        );
        const original = linked.rows[0] ? decode(linked.rows[0]) : null;
        if (
          !original ||
          original.kind !== "deposit" ||
          original.state !== "active" ||
          original.wallet !== input.wallet ||
          original.vault !== input.vault ||
          original.shareMint !== input.shareMint
        )
          throw new Error("C3_PILOT_REDEMPTION_SOURCE_NOT_VERIFIED");
      }
      const result = await client.query<Row>(
        `INSERT INTO c3.c3_pilot_intents
          (intent_id,kind,linked_deposit_id,wallet,vault,share_mint,amount_base_units,
           configuration_hash,state,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLUMNS}`,
        [
          input.intentId,
          input.kind,
          input.linkedDepositId,
          input.wallet,
          input.vault,
          input.shareMint,
          input.amountBaseUnits.toString(),
          input.configurationHash,
          state,
          input.expiresAt,
        ],
      );
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO c3.c3_pilot_events
          (event_id,intent_id,idempotency_key,revision,from_state,to_state,actor_kind)
         VALUES ($1,$2,$3,1,NULL,$4,'system')`,
        [eventId, input.intentId, input.idempotencyKey, state],
      );
      await client.query(
        "INSERT INTO c3.c3_pilot_outbox (event_id,intent_id) VALUES ($1,$2)",
        [eventId, input.intentId],
      );
      if (!result.rows[0]) throw new Error("C3_PILOT_DRAFT_NOT_CREATED");
      return decode(result.rows[0]);
    });
  }

  /** Fail-closed interruption: preserve all signatures and force manual investigation. */
  async markManualReview(
    intentId: string,
    expectedRevision: bigint,
    reasonCode: string,
  ): Promise<PilotIntent> {
    if (!ID.test(intentId) || !/^[a-z][a-z0-9_]{2,63}$/.test(reasonCode))
      throw new Error("C3_PILOT_INVALID_REVIEW_REQUEST");
    return atomic(this.pool, async (client) => {
      const selected = await client.query<Row>(
        `SELECT ${COLUMNS} FROM c3.c3_pilot_intents WHERE intent_id=$1 FOR UPDATE`,
        [intentId],
      );
      if (
        !selected.rows[0] ||
        BigInt(selected.rows[0].revision) !== expectedRevision
      )
        throw new Error("C3_PILOT_COMPARE_AND_SWAP_CONFLICT");
      const prior = decode(selected.rows[0]);
      const key = createHash("sha256")
        .update(`${intentId}:manual_review:${expectedRevision}`)
        .digest("hex");
      assertPilotTransition({
        kind: prior.kind,
        from: prior.state,
        to: "manual_review",
        idempotencyKey: key,
        manualReviewReason: reasonCode,
      });
      const next = await client.query<Row>(
        `UPDATE c3.c3_pilot_intents SET state='manual_review',revision=revision+1,
           manual_review_reason=$3,updated_at=clock_timestamp()
         WHERE intent_id=$1 AND revision=$2 RETURNING ${COLUMNS}`,
        [intentId, expectedRevision.toString(), reasonCode],
      );
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO c3.c3_pilot_events
          (event_id,intent_id,idempotency_key,revision,from_state,to_state,actor_kind,safe_reason_code)
         VALUES ($1,$2,$3,$4,$5,'manual_review','reviewer',$6)`,
        [
          eventId,
          intentId,
          key,
          (expectedRevision + 1n).toString(),
          prior.state,
          reasonCode,
        ],
      );
      await client.query(
        "INSERT INTO c3.c3_pilot_outbox (event_id,intent_id) VALUES ($1,$2)",
        [eventId, intentId],
      );
      if (!next.rows[0]) throw new Error("C3_PILOT_COMPARE_AND_SWAP_CONFLICT");
      return decode(next.rows[0]);
    });
  }
}
