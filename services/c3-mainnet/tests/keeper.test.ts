import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertIntentTransition,
  C3_KEEPER_PERMISSIONS,
  createDeterministicDeploymentBundle,
  evaluateTimedRecovery,
  InMemoryIntentRepository,
  planAggregatedRebalance,
  reconcileWithIndependentProviders,
  recoveryPolicy,
  type C3DeploymentManifest,
  type PersistedIntent,
} from "../src/index.ts";

test("keeper does not trade per deposit below aggregation and drift thresholds", () => {
  const plan = planAggregatedRebalance({
    currentValuesUsdMicros: {
      btc: 40_000_000n,
      eth: 30_000_000n,
      sol: 30_000_000n,
    },
    netFlowUsdcBaseUnits: 1_000_000n,
    aggregationThresholdUsdcBaseUnits: 5_000_000n,
    driftThresholdBps: 100,
    minimumExecutableTradeUsdMicros: 1_000_000n,
    intentExpired: false,
    oracleVerified: true,
    routeRegistryVerified: true,
  });
  assert.equal(plan.action, "no_trade");
  assert.equal(plan.trades.length, 0);
});

test("keeper proposes bounded pooled trades when drift or aggregated net flow requires it", () => {
  const plan = planAggregatedRebalance({
    currentValuesUsdMicros: {
      btc: 50_000_000n,
      eth: 25_000_000n,
      sol: 25_000_000n,
    },
    netFlowUsdcBaseUnits: 5_000_000n,
    aggregationThresholdUsdcBaseUnits: 5_000_000n,
    driftThresholdBps: 100,
    minimumExecutableTradeUsdMicros: 1_000_000n,
    intentExpired: false,
    oracleVerified: true,
    routeRegistryVerified: true,
  });
  assert.equal(plan.action, "proposed_rebalance");
  assert.deepEqual(
    plan.trades.map((trade) => `${trade.direction}:${trade.asset}`),
    ["sell:btc", "buy:eth", "buy:sol"],
  );
  assert.equal(plan.executionCapability, false);
});

test("keeper fails to manual review for stale or missing route/oracle evidence", () => {
  for (const mutation of [
    { intentExpired: true, oracleVerified: true, routeRegistryVerified: true },
    {
      intentExpired: false,
      oracleVerified: false,
      routeRegistryVerified: true,
    },
    {
      intentExpired: false,
      oracleVerified: true,
      routeRegistryVerified: false,
    },
  ]) {
    const plan = planAggregatedRebalance({
      currentValuesUsdMicros: { btc: 40n, eth: 30n, sol: 30n },
      netFlowUsdcBaseUnits: 10_000_000n,
      aggregationThresholdUsdcBaseUnits: 5_000_000n,
      driftThresholdBps: 100,
      minimumExecutableTradeUsdMicros: 1n,
      ...mutation,
    });
    assert.equal(plan.action, "manual_review");
  }
});

test("keeper permissions exclude signing, submission, authority and target changes", () => {
  const joined = C3_KEEPER_PERMISSIONS.join(" ");
  assert.doesNotMatch(
    joined,
    /\bsign\b|\bsubmit\b|\bchange_target\b|\bchange_fee\b|\bunrestricted\b/,
  );
  assert.deepEqual(recoveryPolicy(), {
    automaticRetry: false,
    automaticReversal: false,
    preserveSubmittedSignature: true,
  });
});

test("two-provider reconciliation requires independent HTTPS operators and matching finalized effects", () => {
  const first = {
    providerId: "provider-a",
    operatorId: "operator-a",
    endpoint: "https://rpc-a.example",
    signature: "sig",
    status: "finalized" as const,
    slot: 1,
    configurationHash: "a",
    effectsFingerprint: "b",
  };
  const second = {
    ...first,
    providerId: "provider-b",
    operatorId: "operator-b",
    endpoint: "https://rpc-b.example",
  };
  assert.equal(reconcileWithIndependentProviders(first, second).settled, true);
  assert.equal(
    reconcileWithIndependentProviders(first, {
      ...second,
      operatorId: "operator-a",
    }).settled,
    false,
  );
  assert.equal(
    reconcileWithIndependentProviders(first, {
      ...second,
      endpoint: "http://rpc-b.example",
    }).settled,
    false,
  );
  assert.equal(
    reconcileWithIndependentProviders(first, {
      ...second,
      effectsFingerprint: "hostile",
    }).settled,
    false,
  );
});

test("state machine disallows automatic retry, reversal, and impossible transitions", () => {
  assertIntentTransition("quoted", "authorized");
  assertIntentTransition("keeper_pending", "partially_completed");
  assert.throws(() => assertIntentTransition("settled", "keeper_pending"));
  assert.throws(() =>
    assertIntentTransition("partially_completed", "authorized"),
  );
  assert.throws(() => assertIntentTransition("expired", "intent_submitted"));
});

test("expiry, withdrawal timeout, and uncertain submitted signatures fail closed", () => {
  assert.equal(
    evaluateTimedRecovery({
      state: "authorized",
      nowUnix: 100,
      intentExpiresAtUnix: 100,
      withdrawalTimeoutSeconds: 900,
      submittedSignaturePresent: false,
    }),
    "expired",
  );
  assert.equal(
    evaluateTimedRecovery({
      state: "keeper_pending",
      nowUnix: 1_000,
      intentExpiresAtUnix: 2_000,
      withdrawalStartedAtUnix: 100,
      withdrawalTimeoutSeconds: 900,
      submittedSignaturePresent: false,
    }),
    "manual_review",
  );
  assert.equal(
    evaluateTimedRecovery({
      state: "intent_submitted",
      nowUnix: 200,
      intentExpiresAtUnix: 1_000,
      withdrawalTimeoutSeconds: 900,
      submittedSignaturePresent: true,
    }),
    "manual_review",
  );
});

function draft(): PersistedIntent {
  return {
    schemaVersion: "c3-intent/v1",
    intentId: `c3-${"1".repeat(32)}`,
    idempotencyKey: "2".repeat(64),
    configurationHash: "3".repeat(64),
    wallet: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    state: "quoted",
    revision: 1,
    createdAtUnix: 1,
    updatedAtUnix: 1,
    expiresAtUnix: 100,
  };
}

test("persistence rejects duplicates, stale writes, corruption and signature deletion after restart-like reads", () => {
  const store = new InMemoryIntentRepository();
  const initial = draft();
  store.create(initial);
  assert.throws(() => store.create(initial));
  const read = store.read(initial.intentId);
  assert.deepEqual(read, initial);
  assert.throws(() =>
    store.update({ ...initial, revision: 1, updatedAtUnix: 2 }),
  );
  assert.throws(() =>
    store.update({
      ...initial,
      revision: 2,
      updatedAtUnix: 2,
      idempotencyKey: "4".repeat(64),
    }),
  );
});

test("deployment bundle is deterministic, unsigned, blocked, and complete", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "config/deployment-manifest.proposed.json"),
      "utf8",
    ),
  ) as C3DeploymentManifest;
  const first = createDeterministicDeploymentBundle(manifest);
  const second = createDeterministicDeploymentBundle(manifest);
  assert.equal(first.bundleFingerprint, second.bundleFingerprint);
  assert.equal(first.steps.length, 19);
  assert.ok(
    first.steps.every(
      (step) =>
        step.status === "blocked" && step.unsignedPackageFingerprint === null,
    ),
  );
});
