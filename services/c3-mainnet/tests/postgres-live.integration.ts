/** Real disposable PostgreSQL integration tests. Run only through npm run test:postgres. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import pg from "pg";

import { C3_AMOUNTS } from "../src/constants.ts";
import {
  applyC3SchemaMigration,
  applyC3ManifestOrderingMigration,
  assertC3SchemaCurrent,
} from "../src/migrations.ts";
import { PostgresC3Repository } from "../src/postgres.ts";
import { authorizationFixture, fixtureSignature, wallet } from "./fixtures.ts";
import { runPostgresMatrix } from "./postgres-matrix.ts";

const testUrl = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : null;
if (
  !testUrl ||
  testUrl.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(testUrl.pathname.slice(1)) ||
  testUrl.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE ||
  testUrl.username !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw new Error("Disposable test database is required.");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
const hash = (character: string) => character.repeat(64);
function newIntent(overrides: Record<string, unknown> = {}) {
  return {
    intentId: `c3-${randomUUID().replaceAll("-", "")}`,
    idempotencyKey: randomBytes(32).toString("hex"),
    configurationVersion: "candidate/v1",
    configurationHash: hash("b"),
    wallet,
    operation: "deposit_intent",
    inputAmountBaseUnits: 1_000_000n,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  };
}

async function createSubmitted(db: PostgresC3Repository, hours = 1) {
  const authorization = authorizationFixture();
  const draft = await db.createIntent(
    newIntent({
      intentId: authorization.intentId,
      idempotencyKey: authorization.idempotencyKey,
      configurationVersion: authorization.configurationVersion,
      configurationHash: authorization.configurationHash,
      wallet: authorization.wallet,
      operation: authorization.operation,
      inputAmountBaseUnits: BigInt(authorization.inputAmountBaseUnits),
      expiresAt: new Date(Date.now() + hours * 3_600_000),
    }),
  );
  await db.transition(draft.intentId, 1n, "awaiting_wallet");
  await db.createAuthorization(draft.intentId, 2n);
  await db.transition(draft.intentId, 3n, "intent_submitted", {
    submittedSignature: fixtureSignature,
  });
  return { intentId: draft.intentId, authorization };
}

test("disposable PostgreSQL: migration, durability, CAS, outbox and constraints", async (t) => {
  t.after(async () => {
    await pool.end();
  });
  await t.test(
    "M01 clean migration applies both versioned schemas",
    async () => {
      const client = await pool.connect();
      try {
        assert.equal(await applyC3SchemaMigration(client), "applied");
        assert.equal(await applyC3SchemaMigration(client), "already_applied");
        assert.equal(await applyC3ManifestOrderingMigration(client), "applied");
        assert.equal(
          await applyC3ManifestOrderingMigration(client),
          "already_applied",
        );
        await assertC3SchemaCurrent(pool);
      } finally {
        client.release();
      }
      const tables = await pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='c3' AND tablename LIKE 'c3_%'",
      );
      assert.equal(tables.rows.length, 10);
    },
  );
  const db = await PostgresC3Repository.fromServerEnvironment();
  t.after(async () => {
    await db.close();
  });

  await t.test(
    "actual writer-process exit and reader-process restart preserve authorization and signature",
    () => {
      const run = (mode: string, intentId?: string) => {
        const result = spawnSync(
          process.execPath,
          [
            "--experimental-strip-types",
            "tests/postgres-process-worker.mjs",
            mode,
            ...(intentId ? [intentId] : []),
          ],
          {
            cwd: new URL("..", import.meta.url),
            env: process.env,
            encoding: "utf8",
          },
        );
        assert.equal(result.status, 0, "Disposable process worker failed.");
        return JSON.parse(result.stdout) as Record<string, unknown>;
      };
      const written = run("write");
      assert.match(String(written.intentId), /^c3-[a-f0-9]{32,64}$/);
      const recovered = run("read", String(written.intentId));
      assert.equal(recovered.signaturePreserved, true);
      assert.equal(recovered.authorizationVerified, true);
    },
  );

  await t.test("independent-writer CAS and transactional outbox", async () => {
    const intent = await db.createIntent(newIntent());
    assert.equal(intent.revision, 1n);
    const second = await PostgresC3Repository.fromServerEnvironment();
    try {
      const result = await Promise.allSettled([
        db.transition(intent.intentId, 1n, "awaiting_wallet"),
        second.transition(intent.intentId, 1n, "awaiting_wallet"),
      ]);
      assert.equal(
        result.filter((item) => item.status === "fulfilled").length,
        1,
      );
      assert.equal(
        result.filter((item) => item.status === "rejected").length,
        1,
      );
      assert.equal((await db.readIntent(intent.intentId))?.revision, 2n);
      const events = await pool.query(
        "SELECT event_type FROM c3.c3_outbox_events WHERE intent_id=$1",
        [intent.intentId],
      );
      assert.equal(events.rows.length, 2);
    } finally {
      await second.close();
    }
  });

  await t.test(
    "concurrent duplicate idempotency key rolls back loser",
    async () => {
      const one = newIntent();
      const two = newIntent({ idempotencyKey: one.idempotencyKey });
      const second = await PostgresC3Repository.fromServerEnvironment();
      try {
        const result = await Promise.allSettled([
          db.createIntent(one),
          second.createIntent(two),
        ]);
        assert.equal(
          result.filter((item) => item.status === "fulfilled").length,
          1,
        );
        const rows = await pool.query(
          "SELECT count(*)::int AS n FROM c3.c3_intents WHERE idempotency_key=$1",
          [one.idempotencyKey],
        );
        assert.equal(rows.rows[0].n, 1);
        const outbox = await pool.query(
          "SELECT count(*)::int AS n FROM c3.c3_outbox_events WHERE intent_id IN ($1,$2)",
          [one.intentId, two.intentId],
        );
        assert.equal(outbox.rows[0].n, 1);
      } finally {
        await second.close();
      }
    },
  );

  await t.test(
    "sealed authorization reloads after repository restart and is immutable",
    async () => {
      const authorization = authorizationFixture();
      const draft = await db.createIntent(
        newIntent({
          intentId: authorization.intentId,
          idempotencyKey: authorization.idempotencyKey,
          configurationVersion: authorization.configurationVersion,
          configurationHash: authorization.configurationHash,
          wallet: authorization.wallet,
          operation: authorization.operation,
          inputAmountBaseUnits: BigInt(authorization.inputAmountBaseUnits),
          expiresAt: new Date(authorization.expiresAtUnix * 1000),
        }),
      );
      await db.transition(draft.intentId, 1n, "awaiting_wallet");
      await db.createAuthorization(draft.intentId, 2n);
      const restarted = await PostgresC3Repository.fromServerEnvironment();
      try {
        const stored = await restarted.readAuthorization(draft.intentId);
        assert.equal(stored.authorizationHash, authorization.authorizationHash);
        const loaded = await restarted.readIntent(draft.intentId);
        assert.equal(
          loaded?.authorizationHash,
          authorization.authorizationHash,
        );
        await assert.rejects(
          pool.query(
            "UPDATE c3.c3_authorizations SET canonical_json='{}' WHERE intent_id=$1",
            [draft.intentId],
          ),
        );
        await assert.rejects(
          pool.query("DELETE FROM c3.c3_authorizations WHERE intent_id=$1", [
            draft.intentId,
          ]),
        );
        const submitted = await restarted.transition(
          draft.intentId,
          3n,
          "intent_submitted",
          { submittedSignature: fixtureSignature },
        );
        assert.equal(submitted.submittedSignature, fixtureSignature);
        const afterRestart = await db.readIntent(draft.intentId);
        assert.equal(afterRestart?.submittedSignature, fixtureSignature);
      } finally {
        await restarted.close();
      }
    },
  );

  await t.test(
    "outbox lease is single-writer and audit entries reject changes",
    async () => {
      const event = await pool.query<{ event_id: string; revision: string }>(
        "SELECT event_id,revision FROM c3.c3_outbox_events WHERE status='pending' LIMIT 1",
      );
      const row = event.rows[0];
      assert.ok(row);
      const second = await PostgresC3Repository.fromServerEnvironment();
      try {
        const claims = await Promise.allSettled([
          db.claimOutboxEvent(row.event_id, BigInt(row.revision)),
          second.claimOutboxEvent(row.event_id, BigInt(row.revision)),
        ]);
        assert.equal(
          claims.filter((item) => item.status === "fulfilled" && item.value)
            .length,
          1,
        );
      } finally {
        await second.close();
      }
      await assert.rejects(pool.query("DELETE FROM c3.c3_audit_log"));
      await assert.rejects(
        pool.query("UPDATE c3.c3_audit_log SET actor_kind='wallet'"),
      );
    },
  );

  await t.test("u64 boundary is exact and over-bound is rejected", async () => {
    const large = await db.createIntent(
      newIntent({ inputAmountBaseUnits: C3_AMOUNTS.u64Max }),
    );
    assert.equal(
      (await db.readIntent(large.intentId))?.inputAmountBaseUnits,
      C3_AMOUNTS.u64Max,
    );
    await assert.rejects(
      db.createIntent(
        newIntent({ inputAmountBaseUnits: C3_AMOUNTS.u64Max + 1n }),
      ),
    );
    await assert.rejects(
      pool.query(
        "UPDATE c3.c3_intents SET input_amount=$1 WHERE intent_id=$2",
        ["18446744073709551616", large.intentId],
      ),
    );
  });

  await t.test(
    "recovery attempts one through three persist; fourth enters manual review",
    async () => {
      const { intentId } = await createSubmitted(db);
      let state = await db.transition(intentId, 4n, "failed_recoverable");
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        state = await db.recordRecoveryAttempt(
          intentId,
          state.revision,
          hash("c"),
        );
        assert.equal(state.recoveryAttempts, attempt);
        assert.equal(state.state, "keeper_pending");
        state = await db.transition(
          intentId,
          state.revision,
          "failed_recoverable",
        );
        assert.equal(state.submittedSignature, fixtureSignature);
      }
      state = await db.recordRecoveryAttempt(
        intentId,
        state.revision,
        hash("d"),
      );
      assert.equal(state.state, "manual_review");
      assert.equal(state.recoveryAttempts, 3);
      assert.equal(state.submittedSignature, fixtureSignature);
      const restarted = await PostgresC3Repository.fromServerEnvironment();
      try {
        assert.equal(
          (await restarted.readIntent(intentId))?.state,
          "manual_review",
        );
        const attempts = await pool.query(
          "SELECT count(*)::int AS n FROM c3.c3_recovery_attempts WHERE intent_id=$1",
          [intentId],
        );
        assert.equal(attempts.rows[0].n, 3);
      } finally {
        await restarted.close();
      }
    },
  );

  await t.test(
    "24-hour recovery limit uses database clock and preserves signature",
    async () => {
      const { intentId } = await createSubmitted(db, 48);
      let state = await db.transition(intentId, 4n, "failed_recoverable");
      // Only the isolated test database owner can disable this trigger; never a production path.
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
      state = await db.recordRecoveryAttempt(
        intentId,
        state.revision,
        hash("e"),
      );
      assert.equal(state.state, "manual_review");
      assert.equal(state.recoveryAttempts, 0);
      assert.equal(state.submittedSignature, fixtureSignature);
    },
  );

  await t.test(
    "corrupt canonical authorization fails closed on restart",
    async () => {
      const { intentId } = await createSubmitted(db);
      await pool.query(
        "ALTER TABLE c3.c3_authorizations DISABLE TRIGGER c3_authorizations_immutable",
      );
      try {
        await pool.query(
          "UPDATE c3.c3_authorizations SET canonical_json='{}' WHERE intent_id=$1",
          [intentId],
        );
      } finally {
        await pool.query(
          "ALTER TABLE c3.c3_authorizations ENABLE TRIGGER c3_authorizations_immutable",
        );
      }
      const restarted = await PostgresC3Repository.fromServerEnvironment();
      try {
        await assert.rejects(
          restarted.readIntent(intentId),
          /fingerprint|corrupt/,
        );
        await assert.rejects(
          restarted.transition(intentId, 4n, "keeper_pending"),
          /fingerprint|corrupt/,
        );
      } finally {
        await restarted.close();
      }
    },
  );

  await t.test(
    "SQL injection is data and invalid state is constrained",
    async () => {
      const payload = "candidate/v1'); DROP SCHEMA c3 CASCADE; --";
      const intent = await db.createIntent(
        newIntent({ configurationVersion: payload }),
      );
      assert.equal(
        (await db.readIntent(intent.intentId))?.configurationVersion,
        payload,
      );
      await assert.rejects(
        pool.query(
          "UPDATE c3.c3_intents SET state='not_a_state',revision=revision+1 WHERE intent_id=$1",
          [intent.intentId],
        ),
      );
      await assertC3SchemaCurrent(pool);
    },
  );

  await t.test(
    "failed state transition leaves no orphan outbox event",
    async () => {
      const draft = await db.createIntent(newIntent());
      const before = await pool.query(
        "SELECT count(*)::int AS n FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      await assert.rejects(db.transition(draft.intentId, 1n, "settled"));
      const after = await pool.query(
        "SELECT count(*)::int AS n FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      assert.equal(after.rows[0].n, before.rows[0].n);
      assert.equal((await db.readIntent(draft.intentId))?.state, "draft");
    },
  );

  await t.test(
    "failed outbox insert rolls back intent and idempotency together",
    async () => {
      const input = newIntent();
      await pool.query(
        "CREATE FUNCTION c3.c3_test_reject_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3,pg_temp AS $$ BEGIN RAISE EXCEPTION 'test-only outbox rejection'; END; $$",
      );
      await pool.query(
        "CREATE TRIGGER c3_test_reject_outbox BEFORE INSERT ON c3.c3_outbox_events FOR EACH ROW EXECUTE FUNCTION c3.c3_test_reject_outbox()",
      );
      try {
        await assert.rejects(db.createIntent(input));
      } finally {
        await pool.query(
          "DROP TRIGGER c3_test_reject_outbox ON c3.c3_outbox_events",
        );
        await pool.query("DROP FUNCTION c3.c3_test_reject_outbox()");
      }
      const intents = await pool.query(
        "SELECT count(*)::int AS n FROM c3.c3_intents WHERE intent_id=$1",
        [input.intentId],
      );
      const keys = await pool.query(
        "SELECT count(*)::int AS n FROM c3.c3_idempotency_keys WHERE key_hash=$1",
        [input.idempotencyKey],
      );
      assert.equal(intents.rows[0].n, 0);
      assert.equal(keys.rows[0].n, 0);
    },
  );

  await t.test(
    "expired outbox lease is reclaimed once by a new revision",
    async () => {
      const draft = await db.createIntent(newIntent());
      const event = await pool.query<{ event_id: string }>(
        "SELECT event_id FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      const eventId = event.rows[0]?.event_id;
      assert.ok(eventId);
      assert.equal((await db.claimOutboxEvent(eventId, 1n))?.attempt, 1);
      await pool.query(
        "UPDATE c3.c3_outbox_events SET lease_until=clock_timestamp()-interval '1 second' WHERE event_id=$1",
        [eventId],
      );
      const second = await PostgresC3Repository.fromServerEnvironment();
      try {
        const claims = await Promise.allSettled([
          db.claimOutboxEvent(eventId, 2n),
          second.claimOutboxEvent(eventId, 2n),
        ]);
        assert.equal(
          claims.filter(
            (item) => item.status === "fulfilled" && item.value?.attempt === 2,
          ).length,
          1,
        );
      } finally {
        await second.close();
      }
    },
  );

  await t.test(
    "bounded outbox attempts reach dead letter and cannot be redelivered",
    async () => {
      const draft = await db.createIntent(newIntent());
      const event = await pool.query<{ event_id: string }>(
        "SELECT event_id FROM c3.c3_outbox_events WHERE intent_id=$1",
        [draft.intentId],
      );
      const eventId = event.rows[0]?.event_id;
      assert.ok(eventId);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const revision = BigInt(attempt * 2 - 1);
        assert.equal(
          (await db.claimOutboxEvent(eventId, revision))?.attempt,
          attempt,
        );
        await db.finishOutboxEvent(eventId, revision + 1n, false);
      }
      const result = await pool.query<{ status: string; revision: string }>(
        "SELECT status,revision FROM c3.c3_outbox_events WHERE event_id=$1",
        [eventId],
      );
      assert.equal(result.rows[0]?.status, "dead_letter");
      assert.equal(
        await db.claimOutboxEvent(eventId, BigInt(result.rows[0].revision)),
        undefined,
      );
    },
  );

  await t.test(
    "u128 NAV and u64 share supply round-trip exactly; overflow is rejected",
    async () => {
      const draft = await db.createIntent(newIntent());
      const evidenceId = randomUUID();
      await pool.query(
        "INSERT INTO c3.c3_evidence (evidence_id,intent_id,evidence_kind,fingerprint) VALUES ($1,$2,'vault_snapshot',$3)",
        [evidenceId, draft.intentId, hash("a")],
      );
      const u128Max = "340282366920938463463374607431768211455";
      const u64Max = C3_AMOUNTS.u64Max.toString();
      const snapshotId = randomUUID();
      await pool.query(
        "INSERT INTO c3.c3_reconciled_snapshots (snapshot_id,intent_id,snapshot_hash,evidence_id,nav_base_units,share_supply_base_units) VALUES ($1,$2,$3,$4,$5,$6)",
        [snapshotId, draft.intentId, hash("c"), evidenceId, u128Max, u64Max],
      );
      const row = await pool.query<{
        nav_base_units: string;
        share_supply_base_units: string;
      }>(
        "SELECT nav_base_units,share_supply_base_units FROM c3.c3_reconciled_snapshots WHERE snapshot_id=$1",
        [snapshotId],
      );
      assert.equal(row.rows[0]?.nav_base_units, u128Max);
      assert.equal(row.rows[0]?.share_supply_base_units, u64Max);
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_reconciled_snapshots (snapshot_id,intent_id,snapshot_hash,evidence_id,nav_base_units,share_supply_base_units) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            draft.intentId,
            hash("d"),
            evidenceId,
            (BigInt(u128Max) + 1n).toString(),
            u64Max,
          ],
        ),
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_reconciled_snapshots (snapshot_id,intent_id,snapshot_hash,evidence_id,nav_base_units,share_supply_base_units) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            draft.intentId,
            hash("e"),
            evidenceId,
            "1",
            (C3_AMOUNTS.u64Max + 1n).toString(),
          ],
        ),
      );
    },
  );

  await t.test(
    "schema checksum mismatch prevents repository bootstrap",
    async () => {
      const result = await pool.query<{ checksum_sha256: string }>(
        "SELECT checksum_sha256 FROM c3.schema_migrations WHERE migration_id=$1",
        ["0001_c3_state"],
      );
      const original = result.rows[0]?.checksum_sha256;
      assert.ok(original);
      assert.match(original, /^[a-f0-9]{64}$/);
      await pool.query(
        "UPDATE c3.schema_migrations SET checksum_sha256=$1 WHERE migration_id=$2",
        [hash("0"), "0001_c3_state"],
      );
      try {
        await assert.rejects(
          PostgresC3Repository.fromServerEnvironment(),
          /bootstrap failed/,
        );
      } finally {
        await pool.query(
          "UPDATE c3.schema_migrations SET checksum_sha256=$1 WHERE migration_id=$2",
          [original, "0001_c3_state"],
        );
      }
      await assertC3SchemaCurrent(pool);
    },
  );

  await t.test(
    "timestamps use timestamptz and frequent intent lookups have indexes",
    async () => {
      const timestamps = await pool.query<{ data_type: string }>(
        "SELECT data_type FROM information_schema.columns WHERE table_schema='c3' AND column_name IN ('created_at','updated_at','expires_at','observed_at','applied_at')",
      );
      assert.ok(timestamps.rows.length >= 10);
      assert.ok(
        timestamps.rows.every(
          (row) => row.data_type === "timestamp with time zone",
        ),
      );
      const indexes = await pool.query<{
        tablename: string;
        indexname: string;
      }>("SELECT tablename,indexname FROM pg_indexes WHERE schemaname='c3'");
      for (const table of [
        "c3_evidence",
        "c3_rpc_observations",
        "c3_reconciled_snapshots",
        "c3_manifest_events",
        "c3_recovery_attempts",
        "c3_outbox_events",
        "c3_audit_log",
      ])
        assert.ok(
          indexes.rows.some(
            (row) =>
              row.tablename === table && row.indexname.includes("intent"),
          ),
          `Missing intent index for ${table}`,
        );
    },
  );

  await t.test(
    "manifest events are append-only and reject duplicate revisions",
    async () => {
      const event = randomUUID();
      await pool.query(
        "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision) VALUES ($1,$2,$3,'proposed',1)",
        [event, hash("f"), "candidate/v1"],
      );
      await assert.rejects(
        pool.query(
          "UPDATE c3.c3_manifest_events SET status='deployed' WHERE event_id=$1",
          [event],
        ),
      );
      await assert.rejects(
        pool.query("DELETE FROM c3.c3_manifest_events WHERE event_id=$1", [
          event,
        ]),
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision) VALUES ($1,$2,$3,'proposed',1)",
          [randomUUID(), hash("f"), "candidate/v1"],
        ),
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO c3.c3_manifest_events (event_id,manifest_hash,configuration_version,status,revision) VALUES ($1,$2,$3,'deployed',0)",
          [randomUUID(), hash("f"), "candidate/v1"],
        ),
      );
    },
  );
  await runPostgresMatrix(t, pool, db);
});
