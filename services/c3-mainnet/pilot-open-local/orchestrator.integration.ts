/** Disposable PostgreSQL only; synthetic account data never authorizes production. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import pg from "pg";
import {
  applyOpenLocalMigration,
  OpenLocalSettlementRepository,
  type OpenSnapshot,
  type Scope,
} from "./orchestrator.ts";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (
  !url ||
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE ||
  url.username !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw new Error("C3_OPEN_DISPOSABLE_DATABASE_REQUIRED");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
});
const addr = (digit: number) => String(digit).repeat(32);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const intentId = randomUUID();
const wallet = addr(2),
  vault = addr(3),
  shareMint = addr(4);
const depositPlan = addr(5),
  redemptionPlan = addr(6),
  workerA = randomUUID(),
  workerB = randomUUID();
function scope(s: OpenSnapshot, id = intentId): Scope {
  return {
    intentId: id,
    wallet,
    vault,
    expectedDbRevision: s.dbRevision,
    expectedChainRevision: s.chainRevision,
    idempotencyHash: hash(randomUUID()),
  };
}
function attestation(plan: string, revision: bigint, suffix: string) {
  return {
    source: "MOCK_LOCAL_ONLY" as const,
    plan,
    wallet,
    vault,
    amount: 1_000_000n,
    chainRevision: revision,
    evidenceHash: hash(suffix),
  };
}
function restartRead(id = intentId): {
  state: string;
  signature: string | null;
} {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import pg from 'pg';
      const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
      try { const i=await p.query('SELECT state FROM c3_open.intents WHERE intent_id=$1',[process.argv[1]]);
      const l=await p.query('SELECT submitted_signature FROM c3_open.legs WHERE intent_id=$1 AND ordinal=$2',[process.argv[1],process.argv[2]]);
      process.stdout.write(JSON.stringify({state:i.rows[0]?.state,signature:l.rows[0]?.submitted_signature})); }
      finally { await p.end(); }`,
      id,
      "0",
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: process.env,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(
    child.status,
    0,
    "separate process could not recover PostgreSQL state",
  );
  return JSON.parse(child.stdout) as {
    state: string;
    signature: string | null;
  };
}

test(
  "MOCK_LOCAL_ONLY durable six-leg lifecycle, worker exclusion and restart",
  { timeout: 120_000 },
  async (t) => {
    t.after(() => pool.end());
    const client = await pool.connect();
    try {
      assert.equal(await applyOpenLocalMigration(client), "applied");
      assert.equal(await applyOpenLocalMigration(client), "already_applied");
    } finally {
      client.release();
    }
    const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool);
    let state = await db.createDraft({
      intentId,
      wallet,
      vault,
      shareMint,
      depositPlan,
      configurationHash: hash("local-pilot/v1"),
      expiresAt: new Date(Date.now() + 60 * 60_000),
      idempotencyHash: hash("create"),
    });
    assert.equal(state.state, "draft");
    assert.equal(restartRead().state, "draft");
    await assert.rejects(
      db.transition(scope(state), "draft", "funded", hash("fake")),
      /RECONCILIATION_GATE_CLOSED/,
    );
    state = await db.recordLocalChainCheckpoint(
      scope(state),
      "draft",
      "funded",
      attestation(depositPlan, 0n, "funded"),
    );
    assert.equal(state.state, "funded");
    const stale = scope(state);
    const twoWorkers = await Promise.allSettled([
      db.lease(stale, 0, workerA),
      db.lease(stale, 0, workerB),
    ]);
    assert.equal(
      twoWorkers.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      twoWorkers.filter((result) => result.status === "rejected").length,
      1,
    );
    state = (
      twoWorkers.find(
        (result) => result.status === "fulfilled",
      ) as PromiseFulfilledResult<OpenSnapshot>
    ).value;
    const firstWorker = (
      await pool.query<{ lease_owner: string }>(
        "SELECT lease_owner FROM c3_open.legs WHERE intent_id=$1 AND ordinal=0",
        [intentId],
      )
    ).rows[0]!.lease_owner;
    await pool.query(
      "UPDATE c3_open.legs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE intent_id=$1 AND ordinal=0",
      [intentId],
    );
    state = await db.lease(
      scope(state),
      0,
      firstWorker === workerA ? workerB : workerA,
    );
    const activeWorker = firstWorker === workerA ? workerB : workerA;
    await assert.rejects(
      db.prepare(scope(state), 0, firstWorker, {
        routeHash: hash("bad"),
        instructionHash: hash("bad-instruction"),
        authorizationHash: hash("bad-authorization"),
        inputMint: addr(7),
        outputMint: addr(8),
        source: addr(9),
        destination: addr(2),
        inputAmount: 400_000n,
        minimumOutput: 1n,
        quoteExpiresAt: new Date(Date.now() + 20_000),
        expectedEffects: { ok: true },
      }),
      /LEASE_REQUIRED/,
    );

    for (let ordinal = 0; ordinal < 6; ordinal++) {
      const currentWorker = ordinal === 0 ? activeWorker : workerA;
      if (ordinal !== 0)
        state = await db.lease(scope(state), ordinal, currentWorker);
      const effects = {
        source: addr(9),
        destination: vault,
        ordinal,
        simulated: true,
      };
      state = await db.prepare(scope(state), ordinal, currentWorker, {
        routeHash: hash(`route-${ordinal}`),
        instructionHash: hash(`instruction-${ordinal}`),
        authorizationHash: hash(`authorization-${ordinal}`),
        inputMint: addr(7),
        outputMint: addr(8),
        source: addr(9),
        destination: vault,
        inputAmount: ordinal === 0 ? 400_000n : 300_000n,
        minimumOutput: 1n,
        quoteExpiresAt: new Date(Date.now() + 60_000),
        expectedEffects: effects,
      });
      const signature = String(ordinal + 1).repeat(88);
      state = await db.recordSignature(
        scope(state),
        ordinal,
        currentWorker,
        signature,
        hash(`authorization-${ordinal}`),
      );
      if (ordinal === 0) {
        assert.equal(restartRead().signature, signature);
        await assert.rejects(
          db.recordSignature(
            scope(state),
            ordinal,
            currentWorker,
            addr(7).repeat(3),
            hash(`authorization-${ordinal}`),
          ),
          /INVALID_SIGNATURE|PREPARED_AUTHORIZATION_REQUIRED/,
        );
      }
      state = await db.markSubmitted(
        scope(state),
        ordinal,
        currentWorker,
        signature,
      );
      await assert.rejects(
        db.markSubmitted(scope(state), ordinal, currentWorker, signature),
        /SUBMISSION_ALREADY_ATTEMPTED_OR_MISMATCH/,
      );
      state = await db.recordLocalConfirmedLeg(scope(state), ordinal, {
        source: "MOCK_LOCAL_ONLY",
        plan: ordinal < 3 ? depositPlan : redemptionPlan,
        signature,
        evidenceHash: hash(`evidence-${ordinal}`),
        chainRevision: BigInt(ordinal < 3 ? ordinal + 1 : ordinal - 2),
        observedEffects: effects,
      });
      await assert.rejects(
        db.recordLocalConfirmedLeg(scope(state), ordinal, {
          source: "MOCK_LOCAL_ONLY",
          plan: ordinal < 3 ? depositPlan : redemptionPlan,
          signature,
          evidenceHash: hash(`evidence-${ordinal}`),
          chainRevision: state.chainRevision + 1n,
          observedEffects: effects,
        }),
        /INVALID_STATE|SUBMISSION_OR_SIGNATURE_MISMATCH/,
      );
      if (ordinal === 2) {
        state = await db.recordLocalChainCheckpoint(
          scope(state),
          "buying",
          "active",
          attestation(depositPlan, 3n, "shares-issued"),
        );
        state = await db.recordLocalChainCheckpoint(
          scope(state),
          "active",
          "redemption_requested",
          {
            ...attestation(redemptionPlan, 0n, "redemption-plan"),
            redemptionPlan,
          },
        );
      }
    }
    state = await db.recordLocalChainCheckpoint(
      scope(state),
      "selling",
      "claimable",
      attestation(redemptionPlan, 3n, "claimable"),
    );
    state = await db.recordLocalChainCheckpoint(
      scope(state),
      "claimable",
      "redeemed",
      attestation(redemptionPlan, 3n, "claimed"),
    );
    assert.equal(state.state, "redeemed");
    assert.equal((await db.activity(wallet))[0]?.state, "redeemed");
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM c3_open.events WHERE intent_id=$1",
      [intentId],
    );
    assert.equal(Number(count.rows[0]?.count), Number(state.dbRevision));
    assert.equal(restartRead().state, "redeemed");
    const outbox = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM c3_open.outbox",
    );
    assert.equal(outbox.rows[0]?.count, count.rows[0]?.count);
    const interruptedId = randomUUID();
    const interruptedPlan = addr(7);
    let interrupted = await db.createDraft({
      intentId: interruptedId,
      wallet,
      vault,
      shareMint,
      depositPlan: interruptedPlan,
      configurationHash: hash("local-pilot/v1"),
      expiresAt: new Date(Date.now() + 60 * 60_000),
      idempotencyHash: hash("interrupted-create"),
    });
    interrupted = await db.recordLocalChainCheckpoint(
      scope(interrupted, interruptedId),
      "draft",
      "funded",
      attestation(interruptedPlan, 0n, "interrupted-funded"),
    );
    interrupted = await db.lease(scope(interrupted, interruptedId), 0, workerA);
    interrupted = await db.prepare(
      scope(interrupted, interruptedId),
      0,
      workerA,
      {
        routeHash: hash("interrupted-route"),
        instructionHash: hash("interrupted-instruction"),
        authorizationHash: hash("interrupted-authorization"),
        inputMint: addr(8),
        outputMint: addr(9),
        source: addr(2),
        destination: vault,
        inputAmount: 400_000n,
        minimumOutput: 1n,
        quoteExpiresAt: new Date(Date.now() + 60_000),
        expectedEffects: { simulated: true },
      },
    );
    const interruptedSignature = "8".repeat(88);
    interrupted = await db.recordSignature(
      scope(interrupted, interruptedId),
      0,
      workerA,
      interruptedSignature,
      hash("interrupted-authorization"),
    );
    interrupted = await db.markSubmitted(
      scope(interrupted, interruptedId),
      0,
      workerA,
      interruptedSignature,
    );
    assert.equal(restartRead(interruptedId).signature, interruptedSignature);
    interrupted = await db.uncertain(
      scope(interrupted, interruptedId),
      0,
      "NO_RPC_RESPONSE",
    );
    assert.equal(interrupted.state, "reconciliation_required");
    assert.equal(
      (await db.readLeg(interruptedId, 0)).signature,
      interruptedSignature,
    );
    await assert.rejects(
      pool.query(
        "UPDATE c3_open.legs SET submitted_signature=$3 WHERE intent_id=$1 AND ordinal=$2",
        [interruptedId, 0, "9".repeat(88)],
      ),
      /C3_OPEN_IMMUTABLE_LEG/,
    );
    await assert.rejects(
      pool.query(
        "UPDATE c3_open.legs SET minimum_output=1+minimum_output WHERE intent_id=$1 AND ordinal=$2",
        [interruptedId, 0],
      ),
      /C3_OPEN_IMMUTABLE_LEG/,
    );
    await assert.rejects(
      db.uncertain(scope(interrupted, interruptedId), 0, "NO_RPC_RESPONSE"),
      /NO_SIGNATURE_TO_RECONCILE/,
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      interrupted = await db.beginReconciliation(
        scope(interrupted, interruptedId),
        0,
      );
      assert.equal(interrupted.state, "reconciliation_required");
      assert.equal(
        (await db.readLeg(interruptedId, 0)).recoveryAttempts,
        attempt,
      );
      assert.equal(restartRead(interruptedId).signature, interruptedSignature);
    }
    interrupted = await db.beginReconciliation(
      scope(interrupted, interruptedId),
      0,
    );
    assert.equal(interrupted.state, "manual_review");
    assert.equal((await db.readLeg(interruptedId, 0)).recoveryAttempts, 3);
    await assert.rejects(
      db.lease(scope(interrupted, interruptedId), 0, workerB),
      /INVALID_STATE/,
    );
    assert.equal(restartRead(interruptedId).state, "manual_review");
  },
);
