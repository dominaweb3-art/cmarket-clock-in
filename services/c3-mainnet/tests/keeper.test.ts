import assert from "node:assert/strict";
import test from "node:test";

import {
  C3_AMOUNTS,
  InMemoryIntentRepository,
  inspectSanitizedRpcFixture,
  planAggregatedRebalance,
  reconcileFinalizedSignature,
  type PersistedIntent,
} from "../src/index.ts";
import {
  authorizationFixture,
  finalizedTransactionFixture,
  wallet,
} from "./fixtures.ts";

const authorizations = new Map<
  string,
  ReturnType<typeof authorizationFixture>
>();

function pending(overrides: Record<string, unknown> = {}) {
  return {
    authorizedInflowsUsdcBaseUnits: 2_000_000n,
    authorizedWithdrawalsUsdcBaseUnits: 0n,
    pendingSwapInputsUsdcBaseUnits: 1_000_000n,
    partiallyCompletedAssetDeltasUsdMicros: {
      btc: 0n,
      eth: 0n,
      sol: 0n,
    },
    failedLegPresent: false,
    reservedFeesUsdcBaseUnits: 0n,
    reservedBountyUsdcBaseUnits: 0n,
    operationalDustUsdcBaseUnits: 0n,
    ...overrides,
  } as Parameters<typeof planAggregatedRebalance>[0]["pendingFlows"];
}

function draft(expiryOffsetSeconds = 50): PersistedIntent {
  const authorization = authorizationFixture();
  authorizations.set(authorization.intentId, authorization);
  const createdAtUnix = authorization.issuedAtUnix;
  return {
    schemaVersion: "c3-intent/v2",
    intentId: authorization.intentId,
    idempotencyKey: authorization.idempotencyKey,
    configurationHash: authorization.configurationHash,
    wallet,
    operation: "deposit_intent",
    inputAmountBaseUnits: "1000000",
    state: "draft",
    revision: 1,
    createdAtUnix,
    updatedAtUnix: createdAtUnix,
    expiresAtUnix: createdAtUnix + expiryOffsetSeconds,
    recoveryAttempts: 0,
  };
}

function reachFailed(
  repository: InMemoryIntentRepository,
  record: PersistedIntent,
) {
  const authorization = authorizations.get(record.intentId);
  if (!authorization) throw new Error("Test authorization fixture is missing.");
  const signature = finalizedTransactionFixture(authorization).signature;
  let current = repository.transition(
    record.intentId,
    1,
    "draft",
    "awaiting_wallet",
    record.createdAtUnix + 1,
  );
  current = repository.transition(
    record.intentId,
    current.revision,
    "awaiting_wallet",
    "intent_submitted",
    record.createdAtUnix + 2,
    { authorizationManifest: authorization, submittedSignature: signature },
  );
  return repository.transition(
    record.intentId,
    current.revision,
    "intent_submitted",
    "failed_recoverable",
    record.createdAtUnix + 3,
  );
}

test("keeper produces only a disabled proposed rebalance", () => {
  const plan = planAggregatedRebalance({
    settledValuesUsdMicros: {
      btc: 4_000_000n,
      eth: 3_000_000n,
      sol: 3_000_000n,
    },
    pendingFlows: pending(),
    aggregationThresholdUsdcBaseUnits: 1_000_000n,
    driftThresholdBps: 100,
    minimumExecutableTradeUsdMicros: 1n,
    intentExpired: false,
    oracleVerified: true,
    routeRegistryVerified: true,
  });
  assert.equal(plan.executionCapability, false);
  assert.equal(plan.action, "proposed_rebalance");
  assert.equal(plan.automaticRetry, false);
  assert.equal(plan.automaticReversal, false);
});

test("keeper rejects a partial delta above u64", () => {
  assert.throws(
    () =>
      planAggregatedRebalance({
        settledValuesUsdMicros: { btc: 1n, eth: 1n, sol: 1n },
        pendingFlows: pending({
          partiallyCompletedAssetDeltasUsdMicros: {
            btc: C3_AMOUNTS.u64Max + 1n,
            eth: 0n,
            sol: 0n,
          },
        }),
        aggregationThresholdUsdcBaseUnits: 1n,
        driftThresholdBps: 1,
        minimumExecutableTradeUsdMicros: 1n,
        intentExpired: false,
        oracleVerified: true,
        routeRegistryVerified: true,
      }),
    /unsigned 64-bit range/,
  );
});

test("three recovery attempts increment atomically and the fourth is rejected", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  let current = reachFailed(repository, initial);
  const base = initial.createdAtUnix;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    current = repository.transition(
      initial.intentId,
      current.revision,
      "failed_recoverable",
      "keeper_pending",
      base + 3 + attempt * 2 - 1,
    );
    assert.equal(current.recoveryAttempts, attempt);
    current = repository.transition(
      initial.intentId,
      current.revision,
      "keeper_pending",
      "failed_recoverable",
      base + 3 + attempt * 2,
    );
  }
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        current.revision,
        "failed_recoverable",
        "keeper_pending",
        base + 10,
      ),
    /budget is exhausted/,
  );
});

test("recovery cannot exceed the immutable 24-hour window", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft(100_000);
  repository.create(initial);
  const failed = reachFailed(repository, initial);
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        failed.revision,
        "failed_recoverable",
        "keeper_pending",
        initial.createdAtUnix + 86_400,
      ),
    /24 hours/,
  );
});

test("expiry is enforced on read and transition", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft(10);
  repository.create(initial);
  assert.throws(
    () => repository.read(initial.intentId, initial.expiresAtUnix),
    /Expired intent/,
  );
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        1,
        "draft",
        "awaiting_wallet",
        initial.expiresAtUnix,
      ),
    /Expired intent/,
  );
});

test("stale revision and concurrent update are rejected", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  repository.transition(
    initial.intentId,
    1,
    "draft",
    "awaiting_wallet",
    initial.createdAtUnix + 1,
  );
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        1,
        "draft",
        "cancelled",
        initial.createdAtUnix + 2,
      ),
    /compare-and-swap conflict/,
  );
});

test("submitted signatures survive repository restart", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  const failed = reachFailed(repository, initial);
  const restarted = InMemoryIntentRepository.hydrate([failed]);
  assert.equal(
    restarted.read(initial.intentId, initial.createdAtUnix + 4)
      ?.submittedSignature,
    failed.submittedSignature,
  );
});

test("caller-created RPC providers cannot satisfy production quorum", async () => {
  const authorization = authorizationFixture();
  await assert.rejects(
    reconcileFinalizedSignature(
      finalizedTransactionFixture(authorization).signature,
      authorization,
      "caller-created-two-provider-registry",
    ),
    /unknown sealed RPC registry identifier/,
  );
});

test("sanitized raw RPC fixture is parsed internally", () => {
  const authorization = authorizationFixture();
  const result = inspectSanitizedRpcFixture(
    finalizedTransactionFixture(authorization),
    authorization,
  );
  assert.match(result.effectsFingerprint, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      inspectSanitizedRpcFixture(
        { ...finalizedTransactionFixture(authorization), extra: true },
        authorization,
      ),
    /missing or unexpected/,
  );
});

test("fabricated settlement evidence cannot settle an intent", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  const failed = reachFailed(repository, initial);
  const pendingState = repository.transition(
    initial.intentId,
    failed.revision,
    "failed_recoverable",
    "keeper_pending",
    initial.createdAtUnix + 4,
  );
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        pendingState.revision,
        "keeper_pending",
        "settled",
        initial.createdAtUnix + 5,
        {
          verifiedSettlement: {
            signature: pendingState.submittedSignature!,
            effectsFingerprint: "f".repeat(64),
          },
        },
      ),
    /not produced by independent reconciliation/,
  );
});
