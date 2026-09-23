/** Thirty independently named scenarios against the disposable PostgreSQL cluster. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { TestContext } from "node:test";
import type { Pool } from "pg";

import { C3_AMOUNTS } from "../src/constants.ts";
import { assertC3SchemaCurrent } from "../src/migrations.ts";
import {
  PostgresC3Repository,
  type NewDurableIntent,
} from "../src/postgres.ts";
import { authorizationFixture, fixtureSignature, wallet } from "./fixtures.ts";

const h = (digit: string) => digit.repeat(64);
function input(overrides: Partial<NewDurableIntent> = {}): NewDurableIntent {
  return {
    intentId: `c3-${randomUUID().replaceAll("-", "")}`,
    idempotencyKey: randomBytes(32).toString("hex"),
    configurationVersion: "candidate/v1",
    configurationHash: h("b"),
    wallet,
    operation: "deposit_intent",
    inputAmountBaseUnits: 1_000_000n,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  };
}

async function authorized(db: PostgresC3Repository, expiresAt?: Date) {
  const record = authorizationFixture();
  const draft = await db.createIntent(
    input({
      intentId: record.intentId,
      idempotencyKey: record.idempotencyKey,
      configurationVersion: record.configurationVersion,
      configurationHash: record.configurationHash,
      wallet: record.wallet,
      operation: record.operation,
      inputAmountBaseUnits: BigInt(record.inputAmountBaseUnits),
      expiresAt: expiresAt ?? new Date(record.expiresAtUnix * 1000),
    }),
  );
  await db.transition(draft.intentId, 1n, "awaiting_wallet");
  await db.createAuthorization(draft.intentId, 2n);
  return { intentId: draft.intentId, record };
}

async function submitted(db: PostgresC3Repository, expiresAt?: Date) {
  const { intentId } = await authorized(db, expiresAt);
  await db.transition(intentId, 3n, "intent_submitted", {
    submittedSignature: fixtureSignature,
  });
  return intentId;
}

async function recoverable(db: PostgresC3Repository, priorAttempts = 0) {
  const intentId = await submitted(db);
  let state = await db.transition(intentId, 4n, "failed_recoverable");
  for (let attempt = 0; attempt < priorAttempts; attempt += 1) {
    state = await db.recordRecoveryAttempt(intentId, state.revision, h("c"));
    state = await db.transition(intentId, state.revision, "failed_recoverable");
  }
  return { intentId, state };
}

function processWorker(
  mode: string,
  argument?: string,
): Record<string, unknown> {
  const run = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "tests/postgres-process-worker.mjs",
      mode,
      ...(argument ? [argument] : []),
    ],
    { cwd: new URL("..", import.meta.url), env: process.env, encoding: "utf8" },
  );
  assert.equal(
    run.status,
    0,
    "Independent disposable PostgreSQL process failed.",
  );
  return JSON.parse(run.stdout) as Record<string, unknown>;
}

export async function runPostgresMatrix(
  t: TestContext,
  pool: Pool,
  db: PostgresC3Repository,
): Promise<void> {
  await t.test("M02 repository health after both migrations", async () => {
    assert.equal((await pool.query("SELECT 1 AS healthy")).rows[0]?.healthy, 1);
    await assertC3SchemaCurrent(pool);
  });

  await t.test("M03 state reload after a separate Node process restart", () => {
    const written = processWorker("write");
    const read = processWorker("read", String(written.intentId));
    assert.equal(read.state, "intent_submitted");
  });

  await t.test("M04 authorization creation and reload", async () => {
    const { intentId, record } = await authorized(db);
    const second = await PostgresC3Repository.fromServerEnvironment();
    try {
      assert.equal(
        (await second.readAuthorization(intentId)).authorizationHash,
        record.authorizationHash,
      );
    } finally {
      await second.close();
    }
  });

  await t.test("M05 authorization UPDATE rejected", async () => {
    const { intentId } = await authorized(db);
    await assert.rejects(
      pool.query(
        "UPDATE c3.c3_authorizations SET canonical_json='{}' WHERE intent_id=$1",
        [intentId],
      ),
    );
  });

  await t.test("M06 authorization DELETE rejected", async () => {
    const { intentId } = await authorized(db);
    await assert.rejects(
      pool.query("DELETE FROM c3.c3_authorizations WHERE intent_id=$1", [
        intentId,
      ]),
    );
  });

  await t.test("M07 corrupted authorization hash rejected", async () => {
    const { intentId } = await authorized(db);
    await pool.query(
      "ALTER TABLE c3.c3_authorizations DISABLE TRIGGER c3_authorizations_immutable",
    );
    try {
      await pool.query(
        "UPDATE c3.c3_authorizations SET canonical_json=$1 WHERE intent_id=$2",
        [JSON.stringify({ authorizationHash: h("0") }), intentId],
      );
    } finally {
      await pool.query(
        "ALTER TABLE c3.c3_authorizations ENABLE TRIGGER c3_authorizations_immutable",
      );
    }
    await assert.rejects(db.readAuthorization(intentId), /fingerprint|corrupt/);
  });

  await t.test("M08 correct CAS revision succeeds", async () => {
    const draft = await db.createIntent(input());
    const next = await db.transition(draft.intentId, 1n, "awaiting_wallet");
    assert.equal(next.revision, 2n);
  });

  await t.test("M09 stale CAS revision fails", async () => {
    const draft = await db.createIntent(input());
    await db.transition(draft.intentId, 1n, "awaiting_wallet");
    await assert.rejects(
      db.transition(draft.intentId, 1n, "cancelled"),
      /compare-and-swap/i,
    );
  });

  await t.test(
    "M10 two independent concurrent CAS clients produce one winner",
    async () => {
      const draft = await db.createIntent(input());
      const other = await PostgresC3Repository.fromServerEnvironment();
      try {
        const results = await Promise.allSettled([
          db.transition(draft.intentId, 1n, "awaiting_wallet"),
          other.transition(draft.intentId, 1n, "awaiting_wallet"),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        assert.equal((await db.readIntent(draft.intentId))?.revision, 2n);
      } finally {
        await other.close();
      }
    },
  );

  await t.test(
    "M11 concurrent duplicate idempotency produces one operation",
    async () => {
      const first = input();
      const secondInput = input({ idempotencyKey: first.idempotencyKey });
      const other = await PostgresC3Repository.fromServerEnvironment();
      try {
        const results = await Promise.allSettled([
          db.createIntent(first),
          other.createIntent(secondInput),
        ]);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const rows = await pool.query(
          "SELECT count(*)::int AS n FROM c3.c3_intents WHERE idempotency_key=$1",
          [first.idempotencyKey],
        );
        assert.equal(rows.rows[0]?.n, 1);
      } finally {
        await other.close();
      }
    },
  );

  for (const number of [1, 2, 3] as const) {
    await t.test(
      `M${String(11 + number).padStart(2, "0")} recovery attempt ${number} persists`,
      async () => {
        const { intentId, state } = await recoverable(db, number - 1);
        const next = await db.recordRecoveryAttempt(
          intentId,
          state.revision,
          h("d"),
        );
        assert.equal(next.recoveryAttempts, number);
        assert.equal(next.state, "keeper_pending");
        assert.equal(next.submittedSignature, fixtureSignature);
        const attempts = await pool.query(
          "SELECT count(*)::int AS n FROM c3.c3_recovery_attempts WHERE intent_id=$1",
          [intentId],
        );
        assert.equal(attempts.rows[0]?.n, number);
      },
    );
  }

  await t.test(
    "M15 fourth recovery attempt is rejected into manual review",
    async () => {
      const { intentId, state } = await recoverable(db, 3);
      const reviewed = await db.recordRecoveryAttempt(
        intentId,
        state.revision,
        h("e"),
      );
      assert.equal(reviewed.state, "manual_review");
      assert.equal(reviewed.recoveryAttempts, 3);
      assert.equal(reviewed.submittedSignature, fixtureSignature);
    },
  );

  await t.test(
    "M16 recovery after 24 hours is rejected using database time",
    async () => {
      const intentId = await submitted(
        db,
        new Date(Date.now() + 48 * 3_600_000),
      );
      const state = await db.transition(intentId, 4n, "failed_recoverable");
      await pool.query(
        "ALTER TABLE c3.c3_intents DISABLE TRIGGER c3_intent_guard",
      );
      try {
        await pool.query(
          "UPDATE c3.c3_intents SET created_at=clock_timestamp()-interval '25 hours' WHERE intent_id=$1",
          [intentId],
        );
      } finally {
        await pool.query(
          "ALTER TABLE c3.c3_intents ENABLE TRIGGER c3_intent_guard",
        );
      }
      const reviewed = await db.recordRecoveryAttempt(
        intentId,
        state.revision,
        h("f"),
      );
      assert.equal(reviewed.state, "manual_review");
      assert.equal(reviewed.recoveryAttempts, 0);
      assert.equal(reviewed.submittedSignature, fixtureSignature);
    },
  );

  await t.test(
    "M17 submitted signature survives a separate process restart",
    () => {
      const written = processWorker("write");
      const read = processWorker("read", String(written.intentId));
      assert.equal(read.signaturePreserved, true);
    },
  );

  await t.test(
    "M18 transaction rollback leaves no partial related records",
    async () => {
      const attempt = input();
      await pool.query(
        "CREATE FUNCTION c3.c3_matrix_reject_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3,pg_temp AS $$ BEGIN RAISE EXCEPTION 'test-only rollback'; END; $$",
      );
      await pool.query(
        "CREATE TRIGGER c3_matrix_reject_outbox BEFORE INSERT ON c3.c3_outbox_events FOR EACH ROW EXECUTE FUNCTION c3.c3_matrix_reject_outbox()",
      );
      try {
        await assert.rejects(db.createIntent(attempt));
      } finally {
        await pool.query(
          "DROP TRIGGER c3_matrix_reject_outbox ON c3.c3_outbox_events",
        );
        await pool.query("DROP FUNCTION c3.c3_matrix_reject_outbox()");
      }
      for (const [table, column, value] of [
        ["c3_intents", "intent_id", attempt.intentId],
        ["c3_idempotency_keys", "key_hash", attempt.idempotencyKey],
        ["c3_outbox_events", "intent_id", attempt.intentId],
        ["c3_audit_log", "intent_id", attempt.intentId],
      ]) {
        const count = await pool.query(
          `SELECT count(*)::int AS n FROM c3.${table} WHERE ${column}=$1`,
          [value],
        );
        assert.equal(count.rows[0]?.n, 0);
      }
    },
  );

  await t.test(
    "M19 state transition, audit and outbox commit atomically",
    async () => {
      const draft = await db.createIntent(input());
      const next = await db.transition(draft.intentId, 1n, "awaiting_wallet");
      assert.equal(next.revision, 2n);
      for (const table of ["c3_outbox_events", "c3_audit_log"]) {
        const count = await pool.query(
          `SELECT count(*)::int AS n FROM c3.${table} WHERE intent_id=$1`,
          [draft.intentId],
        );
        assert.equal(count.rows[0]?.n, 2);
      }
    },
  );

  await t.test(
    "M20 failed transition leaves no orphan outbox event",
    async () => {
      const draft = await db.createIntent(input());
      await assert.rejects(db.transition(draft.intentId, 1n, "settled"));
      const count = await pool.query(
        "SELECT count(*)::int AS n FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      assert.equal(count.rows[0]?.n, 1);
      assert.equal((await db.readIntent(draft.intentId))?.state, "draft");
    },
  );

  await t.test(
    "M21 concurrent outbox workers produce one lease owner",
    async () => {
      const draft = await db.createIntent(input());
      const event = await pool.query(
        "SELECT event_id FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      const eventId = event.rows[0]?.event_id as string;
      const other = await PostgresC3Repository.fromServerEnvironment();
      try {
        const claims = await Promise.allSettled([
          db.claimOutboxEvent(eventId, 1n),
          other.claimOutboxEvent(eventId, 1n),
        ]);
        assert.equal(
          claims.filter((claim) => claim.status === "fulfilled" && claim.value)
            .length,
          1,
        );
      } finally {
        await other.close();
      }
    },
  );

  await t.test("M22 expired outbox lease is reclaimed", async () => {
    const draft = await db.createIntent(input());
    const event = await pool.query(
      "SELECT event_id FROM c3.c3_outbox_events WHERE intent_id=$1",
      [draft.intentId],
    );
    const eventId = event.rows[0]?.event_id as string;
    assert.equal((await db.claimOutboxEvent(eventId, 1n))?.attempt, 1);
    await pool.query(
      "UPDATE c3.c3_outbox_events SET lease_until=clock_timestamp()-interval '1 second' WHERE event_id=$1",
      [eventId],
    );
    assert.equal((await db.claimOutboxEvent(eventId, 2n))?.attempt, 2);
  });

  await t.test(
    "M23 bounded outbox attempts reach dead-letter state",
    async () => {
      const draft = await db.createIntent(input());
      const event = await pool.query(
        "SELECT event_id FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      const eventId = event.rows[0]?.event_id as string;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        assert.equal(
          (await db.claimOutboxEvent(eventId, BigInt(attempt * 2 - 1)))
            ?.attempt,
          attempt,
        );
        await db.finishOutboxEvent(eventId, BigInt(attempt * 2), false);
      }
      const state = await pool.query(
        "SELECT status,revision FROM c3.c3_outbox_events WHERE event_id=$1",
        [eventId],
      );
      assert.equal(state.rows[0]?.status, "dead_letter");
      assert.equal(
        await db.claimOutboxEvent(eventId, BigInt(state.rows[0].revision)),
        undefined,
      );
    },
  );

  await t.test(
    "M24 duplicate event delivery does not duplicate business state",
    async () => {
      const draft = await db.createIntent(input());
      const event = await pool.query(
        "SELECT event_id FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      const eventId = event.rows[0]?.event_id as string;
      assert.ok(await db.claimOutboxEvent(eventId, 1n));
      await db.finishOutboxEvent(eventId, 2n, true);
      await assert.rejects(
        db.finishOutboxEvent(eventId, 2n, true),
        /compare-and-swap/i,
      );
      assert.equal(await db.claimOutboxEvent(eventId, 3n), undefined);
      assert.equal((await db.readIntent(draft.intentId))?.revision, 1n);
    },
  );

  await t.test("M25 audit-log UPDATE is rejected", async () => {
    const draft = await db.createIntent(input());
    await assert.rejects(
      pool.query(
        "UPDATE c3.c3_audit_log SET actor_kind='wallet' WHERE intent_id=$1",
        [draft.intentId],
      ),
    );
  });

  await t.test("M26 audit-log DELETE is rejected", async () => {
    const draft = await db.createIntent(input());
    await assert.rejects(
      pool.query("DELETE FROM c3.c3_audit_log WHERE intent_id=$1", [
        draft.intentId,
      ]),
    );
  });

  await t.test(
    "M27 snapshot provenance reference survives separate process restart",
    () => {
      const written = processWorker("snapshot-write");
      const read = processWorker("snapshot-read", String(written.snapshotId));
      assert.equal(read.linkedEvidenceVerified, true);
      assert.equal(read.numericValuesPreserved, true);
    },
  );

  await t.test(
    "M28 manifest predecessor order and revision constraints are enforced",
    async () => {
      const proposedHash = randomBytes(32).toString("hex");
      const verifiedHash = randomBytes(32).toString("hex");
      await pool.query(
        "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision) VALUES ($1,$2,'candidate/v1','proposed',1)",
        [randomUUID(), proposedHash],
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision,previous_hash) VALUES ($1,$2,'candidate/v1','governance_approved',2,$3)",
          [randomUUID(), randomBytes(32).toString("hex"), proposedHash],
        ),
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision,previous_hash) VALUES ($1,$2,'candidate/v1','verified',3,$3)",
          [randomUUID(), randomBytes(32).toString("hex"), proposedHash],
        ),
      );
      await pool.query(
        "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision,previous_hash) VALUES ($1,$2,'candidate/v1','verified',2,$3)",
        [randomUUID(), verifiedHash, proposedHash],
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision,previous_hash) VALUES ($1,$2,'candidate/v1','verified',2,$3)",
          [randomUUID(), randomBytes(32).toString("hex"), proposedHash],
        ),
      );
    },
  );

  await t.test(
    "M29 corrupted database authorization row fails closed",
    async () => {
      const { intentId } = await authorized(db);
      await pool.query(
        "ALTER TABLE c3.c3_authorizations DISABLE TRIGGER c3_authorizations_immutable",
      );
      try {
        await pool.query(
          "UPDATE c3.c3_authorizations SET canonical_json='not-json' WHERE intent_id=$1",
          [intentId],
        );
      } finally {
        await pool.query(
          "ALTER TABLE c3.c3_authorizations ENABLE TRIGGER c3_authorizations_immutable",
        );
      }
      await assert.rejects(db.readIntent(intentId), /corrupt/);
    },
  );

  await t.test(
    "M30 u64/u128 values round-trip exactly and reject overflow",
    async () => {
      const draft = await db.createIntent(
        input({ inputAmountBaseUnits: C3_AMOUNTS.u64Max }),
      );
      assert.equal(
        (await db.readIntent(draft.intentId))?.inputAmountBaseUnits,
        C3_AMOUNTS.u64Max,
      );
      await assert.rejects(
        db.createIntent(
          input({ inputAmountBaseUnits: C3_AMOUNTS.u64Max + 1n }),
        ),
      );
      const evidenceId = randomUUID();
      await pool.query(
        "INSERT INTO c3.c3_evidence (evidence_id,intent_id,evidence_kind,fingerprint) VALUES ($1,$2,'vault_snapshot',$3)",
        [evidenceId, draft.intentId, h("e")],
      );
      const maxU128 = "340282366920938463463374607431768211455";
      const snapshotId = randomUUID();
      await pool.query(
        "INSERT INTO c3.c3_reconciled_snapshots (snapshot_id,intent_id,snapshot_hash,evidence_id,nav_base_units,share_supply_base_units) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          snapshotId,
          draft.intentId,
          h("f"),
          evidenceId,
          maxU128,
          C3_AMOUNTS.u64Max.toString(),
        ],
      );
      const saved = await pool.query(
        "SELECT nav_base_units,share_supply_base_units FROM c3.c3_reconciled_snapshots WHERE snapshot_id=$1",
        [snapshotId],
      );
      assert.equal(saved.rows[0]?.nav_base_units, maxU128);
      assert.equal(
        saved.rows[0]?.share_supply_base_units,
        C3_AMOUNTS.u64Max.toString(),
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_reconciled_snapshots (snapshot_id,intent_id,snapshot_hash,evidence_id,nav_base_units,share_supply_base_units) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            draft.intentId,
            h("a"),
            evidenceId,
            (BigInt(maxU128) + 1n).toString(),
            "1",
          ],
        ),
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_reconciled_snapshots (snapshot_id,intent_id,snapshot_hash,evidence_id,nav_base_units,share_supply_base_units) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            draft.intentId,
            h("b"),
            evidenceId,
            "1",
            (C3_AMOUNTS.u64Max + 1n).toString(),
          ],
        ),
      );
    },
  );
}
