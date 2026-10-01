/** Real disposable PostgreSQL integration tests. Run only through npm run test:postgres. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import pg from "pg";

import { C3_AMOUNTS } from "../src/constants.ts";
import {
  applyC3SchemaMigration,
  applyC3ManifestOrderingMigration,
  applyC3PilotMigration,
  applyC3BuilderMigration,
  applyC3QuoteSealMigration,
  assertC3SchemaCurrent,
  assertC3PilotSchemaCurrent,
  assertC3BuilderSchemaCurrent,
  assertC3QuoteSealSchemaCurrent,
} from "../src/migrations.ts";
import { DisabledPilotRepository } from "../src/pilot-postgres.ts";
import { requestIsolatedCandidate } from "../src/pilot-builder-boundary.ts";
import { PostgresC3Repository } from "../src/postgres.ts";
import { authorizationFixture, fixtureSignature, wallet } from "./fixtures.ts";
import { seedSyntheticAuthorization } from "./support/seed-synthetic-authorization.ts";
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
  await seedSyntheticAuthorization(authorization);
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
    "owner pilot migration, durable draft, CAS and manual review remain disabled",
    async () => {
      const client = await pool.connect();
      try {
        assert.equal(await applyC3PilotMigration(client), "applied");
        assert.equal(await applyC3PilotMigration(client), "already_applied");
        await assertC3PilotSchemaCurrent(pool);
      } finally {
        client.release();
      }
      const pilot = await DisabledPilotRepository.fromVerifiedPool(pool);
      const intentId = `c3p-${randomUUID().replaceAll("-", "")}`;
      const first = await pilot.createDisabledDraft({
        intentId,
        kind: "deposit",
        linkedDepositId: null,
        wallet,
        vault: wallet,
        shareMint: wallet,
        amountBaseUnits: 1_000_000n,
        configurationHash: hash("a"),
        idempotencyKey: randomBytes(32).toString("hex"),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      assert.equal(first.state, "draft");
      assert.equal((await pilot.readIntent(intentId))?.revision, 1n);
      assert.equal((await pilot.listActivity(wallet)).length, 1);
      const restarted = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "tests/postgres-process-worker.mjs",
          "pilot-read",
          intentId,
        ],
        {
          cwd: new URL("..", import.meta.url),
          env: process.env,
          encoding: "utf8",
        },
      );
      assert.equal(
        restarted.status,
        0,
        "Pilot state did not survive a separate process.",
      );
      assert.equal(JSON.parse(restarted.stdout).durable, true);
      await assert.rejects(
        pilot.markManualReview(intentId, 0n, "interrupted"),
        /COMPARE_AND_SWAP_CONFLICT/,
      );
      await assert.rejects(
        pilot.markManualReview(intentId, 1n, "interrupted"),
        /INVALID_TRANSITION/,
      );
      const events = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM c3.c3_pilot_events WHERE intent_id=$1",
        [intentId],
      );
      assert.equal(events.rows[0]?.count, "1");
      const outbox = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM c3.c3_pilot_outbox WHERE intent_id=$1",
        [intentId],
      );
      assert.equal(outbox.rows[0]?.count, "1");
      await assert.rejects(
        pool.query(
          "UPDATE c3.c3_pilot_intents SET state='completed',revision=revision+1 WHERE intent_id=$1",
          [intentId],
        ),
        /check constraint/,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO c3.c3_pilot_intents
            (intent_id,kind,linked_deposit_id,wallet,vault,share_mint,amount_base_units,
             configuration_hash,state,expires_at)
           VALUES ($1,'redemption',$2,$3,$4,$5,1,$6,'redemption_draft',clock_timestamp()+interval '1 hour')`,
          [
            `c3p-${randomUUID().replaceAll("-", "")}`,
            intentId,
            wallet,
            wallet,
            wallet,
            hash("a"),
          ],
        ),
        /redemption source is not verified/,
      );
      await assert.rejects(
        pilot.createDisabledDraft({
          intentId: `c3p-${randomUUID().replaceAll("-", "")}`,
          kind: "deposit",
          linkedDepositId: null,
          wallet,
          vault: wallet,
          shareMint: wallet,
          amountBaseUnits: 1_000_000n,
          configurationHash: hash("a"),
          idempotencyKey: randomBytes(32).toString("hex"),
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
        /duplicate key/,
      );
    },
  );

  await t.test(
    "isolated builder migration is forward-only and seeds no authority",
    async () => {
      const client = await pool.connect();
      try {
        assert.equal(await applyC3BuilderMigration(client), "applied");
        assert.equal(await applyC3BuilderMigration(client), "already_applied");
        await assertC3BuilderSchemaCurrent(pool);
      } finally {
        client.release();
      }
      const configs = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM c3.c3_pilot_builder_configurations",
      );
      const manifests = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM c3.c3_pilot_authorization_manifests",
      );
      assert.equal(configs.rows[0]?.count, "0");
      assert.equal(manifests.rows[0]?.count, "0");
    },
  );

  await t.test(
    "quote evidence migration is immutable, CAS-bound, and audited",
    async () => {
      const client = await pool.connect();
      try {
        assert.equal(await applyC3QuoteSealMigration(client), "applied");
        assert.equal(
          await applyC3QuoteSealMigration(client),
          "already_applied",
        );
        await assertC3QuoteSealSchemaCurrent(pool);
      } finally {
        client.release();
      }
      const found = await pool.query<{ intent_id: string }>(
        "SELECT intent_id FROM c3.c3_pilot_intents WHERE kind='deposit' LIMIT 1",
      );
      const intentId = found.rows[0]?.intent_id;
      assert.ok(intentId);
      const nonce = randomBytes(32);
      const quoteId = createHash("sha256")
        .update("c3-quote-id-v1")
        .update(nonce)
        .digest();
      const payload = randomBytes(300);
      Buffer.from("C3QUOTESEAL-V1!!").copy(payload, 0);
      payload[16] = 1;
      quoteId.copy(payload, 49);
      nonce.copy(payload, 81);
      const payloadHash = createHash("sha256").update(payload).digest();
      const values = [
        quoteId,
        nonce,
        intentId,
        payload,
        payloadHash,
        randomBytes(32),
        new Date(Date.now() + 20_000),
      ];
      const insert = `INSERT INTO c3.c3_quote_authorizations
      (quote_id,nonce,intent_id,leg,policy_revision,registry_revision,registry_hash,
       payload,payload_sha256,authority_pubkey,expires_at)
      VALUES($1,$2,$3,0,1,1,decode(repeat('ab',32),'hex'),$4,$5,$6,$7)`;
      await pool.query(insert, values);
      await assert.rejects(pool.query(insert, values), /duplicate key/);
      await assert.rejects(
        pool.query(insert, [randomBytes(32), ...values.slice(1)]),
        /C3 quote evidence invalid/,
      );
      const malformedPayload = Buffer.from(payload);
      malformedPayload[49] = malformedPayload[49]! ^ 1;
      await assert.rejects(
        pool.query(insert, [
          createHash("sha256")
            .update("c3-quote-id-v1")
            .update(randomBytes(32))
            .digest(),
          randomBytes(32),
          intentId,
          malformedPayload,
          createHash("sha256").update(malformedPayload).digest(),
          randomBytes(32),
          new Date(Date.now() + 20_000),
        ]),
      );
      const concurrentNonce = randomBytes(32);
      const concurrentQuoteId = createHash("sha256")
        .update("c3-quote-id-v1")
        .update(concurrentNonce)
        .digest();
      const concurrentPayload = Buffer.from(payload);
      concurrentQuoteId.copy(concurrentPayload, 49);
      concurrentNonce.copy(concurrentPayload, 81);
      await assert.rejects(
        pool.query(insert, [
          concurrentQuoteId,
          concurrentNonce,
          intentId,
          concurrentPayload,
          createHash("sha256").update(concurrentPayload).digest(),
          randomBytes(32),
          new Date(Date.now() + 20_000),
        ]),
        /duplicate key/,
      );
      await assert.rejects(
        pool.query(
          "UPDATE c3.c3_quote_authorizations SET payload=$2,revision=2 WHERE quote_id=$1",
          [quoteId, randomBytes(300)],
        ),
        /immutable evidence/,
      );
      const signature = randomBytes(64);
      const signed = await pool.query(
        `UPDATE c3.c3_quote_authorizations SET state='signed',signature=$2,revision=revision+1
       WHERE quote_id=$1 AND revision=1 RETURNING revision`,
        [quoteId, signature],
      );
      assert.equal(signed.rows[0]?.revision, "2");
      const competingValues = () => {
        const competingNonce = randomBytes(32);
        const competingId = createHash("sha256")
          .update("c3-quote-id-v1")
          .update(competingNonce)
          .digest();
        const competingPayload = Buffer.from(payload);
        competingId.copy(competingPayload, 49);
        competingNonce.copy(competingPayload, 81);
        return [
          competingId,
          competingNonce,
          intentId,
          competingPayload,
          createHash("sha256").update(competingPayload).digest(),
          randomBytes(32),
          new Date(Date.now() + 20_000),
        ];
      };
      const competingInsert = insert.replace(
        "VALUES($1,$2,$3,0,1,1,",
        "VALUES($1,$2,$3,1,1,1,",
      );
      const contenders = await Promise.allSettled([
        pool.query(competingInsert, competingValues()),
        pool.query(competingInsert, competingValues()),
      ]);
      assert.equal(
        contenders.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        contenders.filter((result) => result.status === "rejected").length,
        1,
      );
      const activeLeg = await pool.query<{ quote_id: Buffer }>(
        "SELECT quote_id FROM c3.c3_quote_authorizations WHERE intent_id=$1 AND leg=1 AND state='prepared'",
        [intentId],
      );
      assert.equal(activeLeg.rowCount, 1);
      await assert.rejects(
        pool.query(
          "UPDATE c3.c3_quote_authorizations SET state='expired',revision=revision+1 WHERE quote_id=$1",
          [activeLeg.rows[0]!.quote_id],
        ),
        /cannot expire before database time/,
      );
      await pool.query(
        "UPDATE c3.c3_quote_authorizations SET state='manual_review',revision=revision+1 WHERE quote_id=$1",
        [activeLeg.rows[0]!.quote_id],
      );
      const expiring = competingValues();
      expiring[6] = new Date(Date.now() + 500);
      await pool.query(competingInsert, expiring);
      await new Promise((resolve) => setTimeout(resolve, 600));
      await pool.query(
        "UPDATE c3.c3_quote_authorizations SET state='expired',revision=revision+1 WHERE quote_id=$1",
        [expiring[0]],
      );
      await assert.rejects(
        pool.query(
          "UPDATE c3.c3_quote_authorizations SET state='signed',signature=$2,revision=revision+1 WHERE quote_id=$1",
          [expiring[0], randomBytes(64)],
        ),
        /terminal evidence is immutable/,
      );
      await assert.rejects(
        pool.query(
          "UPDATE c3.c3_quote_authorizations SET signature=$2,revision=revision+1 WHERE quote_id=$1",
          [quoteId, randomBytes(64)],
        ),
        /invalid final transition/,
      );
      const events = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM c3.c3_quote_events WHERE quote_id=$1",
        [quoteId],
      );
      assert.equal(events.rows[0]?.count, "2");
      await assert.rejects(
        pool.query("DELETE FROM c3.c3_quote_authorizations WHERE quote_id=$1", [
          quoteId,
        ]),
      );
    },
  );

  await t.test(
    "builder request reads PostgreSQL only and rejects absent approved configuration",
    async () => {
      const found = await pool.query<{ intent_id: string }>(
        "SELECT intent_id FROM c3.c3_pilot_intents WHERE kind='deposit' LIMIT 1",
      );
      const intentId = found.rows[0]?.intent_id;
      assert.ok(intentId);
      await assert.rejects(
        requestIsolatedCandidate({
          intentId,
          configurationVersion: "candidate/v1",
          operation: "deposit",
          expectedRevision: "1",
        }),
        /C3_BUILDER_FAILED_OR_TIMED_OUT/,
      );
      const state = await pool.query<{ state: string; revision: string }>(
        "SELECT state,revision::text AS revision FROM c3.c3_pilot_intents WHERE intent_id=$1",
        [intentId],
      );
      assert.deepEqual(state.rows[0], { state: "draft", revision: "1" });
    },
  );

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

  await t.test(
    "builder context and unresolved signature survive a full process restart without resubmission",
    async () => {
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
        assert.equal(result.status, 0, "Independent process failed.");
        return JSON.parse(result.stdout) as Record<string, unknown>;
      };
      const written = run("durable-write");
      const intentId = String(written.intentId);
      await assert.rejects(
        db.buildProductionUnsigned(intentId),
        /C3_PRODUCTION_POLICY_NOT_CONFIGURED/,
      );
      const beforeDuplicate = await db.readIntent(intentId);
      const duplicate = await db.recordSubmittedSignature(
        intentId,
        4n,
        fixtureSignature,
      );
      assert.equal(duplicate.revision, beforeDuplicate?.revision);
      await assert.rejects(
        db.requireSubmissionReconciliation(intentId, 3n),
        /compare-and-swap conflict/,
      );
      const recovered = run("durable-recover", intentId);
      assert.equal(recovered.signaturePreserved, true);
      assert.equal(recovered.idempotent, true);
      assert.equal((await db.readIntent(intentId))?.state, "manual_review");
      const events = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM c3.c3_outbox_events WHERE intent_id=$1 AND payload->>'reasonCode'='reconciliation_required'",
        [intentId],
      );
      const audit = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM c3.c3_audit_log WHERE intent_id=$1 AND safe_metadata->>'reasonCode'='reconciliation_required'",
        [intentId],
      );
      assert.equal(events.rows[0]?.count, "1");
      assert.equal(audit.rows[0]?.count, "1");
      await assert.rejects(
        db.recordSubmittedSignature(
          intentId,
          4n,
          fixtureSignature.replace(/.$/, "2"),
        ),
        /Conflicting submitted signature/,
      );
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
      await seedSyntheticAuthorization(authorization);
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
