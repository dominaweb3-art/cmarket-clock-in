import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertIntentTransition,
  assertProductionRepository,
  C3_INTENT_STATES,
  C3_KEEPER_PERMISSIONS,
  createDeterministicDeploymentBundle,
  evaluateTimedRecovery,
  InMemoryIntentRepository,
  planAggregatedRebalance,
  reconcileFinalizedSignature,
  recoveryPolicy,
  ReviewedRpcRegistry,
  type C3DeploymentManifest,
  type IntentState,
  type IntentTransitionPatch,
  type KeeperPendingFlows,
  type PersistedIntent,
  type ReviewedRpcProvider,
} from "../src/index.ts";
import {
  authorizationFixture,
  finalizedTransactionFixture,
  userUsdc,
  vault,
  wallet,
} from "./fixtures.ts";

const emptyFlows: KeeperPendingFlows = Object.freeze({
  authorizedInflowsUsdcBaseUnits: 0n,
  authorizedWithdrawalsUsdcBaseUnits: 0n,
  pendingSwapInputsUsdcBaseUnits: 0n,
  partiallyCompletedAssetDeltasUsdMicros: Object.freeze({
    btc: 0n,
    eth: 0n,
    sol: 0n,
  }),
  failedLegPresent: false,
  reservedFeesUsdcBaseUnits: 0n,
  reservedBountyUsdcBaseUnits: 0n,
  operationalDustUsdcBaseUnits: 0n,
});

function plan(flows = emptyFlows, extra: Record<string, unknown> = {}) {
  return planAggregatedRebalance({
    settledValuesUsdMicros: {
      btc: 40_000_000n,
      eth: 30_000_000n,
      sol: 30_000_000n,
    },
    pendingFlows: flows,
    aggregationThresholdUsdcBaseUnits: 5_000_000n,
    driftThresholdBps: 100,
    minimumExecutableTradeUsdMicros: 1n,
    intentExpired: false,
    oracleVerified: true,
    routeRegistryVerified: true,
    ...extra,
  });
}

test("keeper uses projected post-flow NAV and never performs per-user three-leg settlement", () => {
  const inflow = plan({
    ...emptyFlows,
    authorizedInflowsUsdcBaseUnits: 5_000_000n,
    pendingSwapInputsUsdcBaseUnits: 5_000_000n,
  });
  assert.equal(inflow.action, "proposed_rebalance");
  assert.equal(inflow.projectedPostFlowNavUsdMicros, 105_000_000n);
  assert.deepEqual(
    inflow.trades.map((trade) => [
      trade.asset,
      trade.direction,
      trade.valueUsdMicros,
    ]),
    [
      ["btc", "buy", 2_000_000n],
      ["eth", "buy", 1_500_000n],
      ["sol", "buy", 1_500_000n],
    ],
  );
  assert.match(inflow.reason, /pooled vault/);
});

test("keeper handles outflow, equal flow, thresholds, dust, partial completion, failed leg and missing evidence", () => {
  assert.equal(
    plan({ ...emptyFlows, authorizedWithdrawalsUsdcBaseUnits: 5_000_000n })
      .action,
    "proposed_rebalance",
  );
  assert.equal(
    plan({
      ...emptyFlows,
      authorizedInflowsUsdcBaseUnits: 5_000_000n,
      authorizedWithdrawalsUsdcBaseUnits: 5_000_000n,
    }).action,
    "no_trade",
  );
  assert.equal(
    plan({ ...emptyFlows, authorizedInflowsUsdcBaseUnits: 4_999_999n }).action,
    "no_trade",
  );
  assert.equal(
    plan(
      { ...emptyFlows, operationalDustUsdcBaseUnits: 1n },
      { minimumExecutableTradeUsdMicros: 10n },
    ).action,
    "no_trade",
  );
  assert.equal(
    plan({
      ...emptyFlows,
      partiallyCompletedAssetDeltasUsdMicros: {
        btc: 10_000_000n,
        eth: 0n,
        sol: 0n,
      },
    }).action,
    "proposed_rebalance",
  );
  assert.equal(
    plan({ ...emptyFlows, failedLegPresent: true }).action,
    "manual_review",
  );
  assert.equal(
    plan(emptyFlows, { oracleVerified: false }).action,
    "manual_review",
  );
  assert.equal(
    plan(emptyFlows, { routeRegistryVerified: false }).action,
    "manual_review",
  );
  assert.throws(() =>
    plan({
      ...emptyFlows,
      authorizedInflowsUsdcBaseUnits: 1n,
      pendingSwapInputsUsdcBaseUnits: 2n,
    }),
  );
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

const allowed: Readonly<Record<IntentState, readonly IntentState[]>> = {
  draft: ["awaiting_wallet", "cancelled", "expired"],
  awaiting_wallet: [
    "intent_submitted",
    "cancelled",
    "expired",
    "manual_review",
  ],
  intent_submitted: [
    "keeper_pending",
    "partially_completed",
    "failed_recoverable",
    "manual_review",
  ],
  keeper_pending: [
    "partially_completed",
    "settled",
    "failed_recoverable",
    "manual_review",
    "expired",
  ],
  partially_completed: ["keeper_pending", "settled", "manual_review"],
  settled: [],
  failed_recoverable: ["keeper_pending", "manual_review"],
  manual_review: [],
  cancelled: [],
  expired: [],
};

test("state transition matrix is exhaustive and blocks impossible lifecycle jumps", () => {
  for (const from of C3_INTENT_STATES)
    for (const to of C3_INTENT_STATES) {
      if (allowed[from].includes(to))
        assert.doesNotThrow(() => assertIntentTransition(from, to));
      else assert.throws(() => assertIntentTransition(from, to));
    }
  assert.throws(() => assertIntentTransition("draft", "settled"));
  assert.throws(() => assertIntentTransition("settled", "keeper_pending"));
  assert.throws(() => assertIntentTransition("cancelled", "settled"));
});

function draft(): PersistedIntent {
  return {
    schemaVersion: "c3-intent/v2",
    intentId: `c3-${"1".repeat(32)}`,
    idempotencyKey: "2".repeat(64),
    configurationHash: "3".repeat(64),
    wallet,
    operation: "deposit_intent",
    inputAmountBaseUnits: "1000000",
    state: "draft",
    revision: 1,
    createdAtUnix: 1,
    updatedAtUnix: 1,
    expiresAtUnix: 100,
    recoveryAttempts: 0,
  };
}

test("repository enforces CAS, immutable intent/signature/effects, duplicate prevention and restart hydration", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  assert.throws(() => repository.create(initial));
  const awaiting = repository.transition(
    initial.intentId,
    1,
    "draft",
    "awaiting_wallet",
    2,
  );
  const submitted = repository.transition(
    initial.intentId,
    2,
    "awaiting_wallet",
    "intent_submitted",
    3,
    {
      authorizationManifest: authorizationFixture(),
      submittedSignature: finalizedTransactionFixture().signature,
    },
  );
  assert.throws(() =>
    repository.transition(
      initial.intentId,
      2,
      "awaiting_wallet",
      "intent_submitted",
      3,
    ),
  );
  assert.throws(() =>
    repository.transition(
      initial.intentId,
      submitted.revision,
      "intent_submitted",
      "keeper_pending",
      4,
      { submittedSignature: undefined } as unknown as IntentTransitionPatch,
    ),
  );
  const pending = repository.transition(
    initial.intentId,
    submitted.revision,
    "intent_submitted",
    "keeper_pending",
    4,
  );
  assert.throws(() =>
    repository.transition(
      initial.intentId,
      pending.revision,
      "keeper_pending",
      "settled",
      5,
      {
        verifiedSettlement: {
          signature: submitted.submittedSignature!,
          effectsFingerprint: "9".repeat(64),
          productionEvidence: true,
        },
      },
    ),
  );
  const restarted = InMemoryIntentRepository.hydrate([
    repository.read(initial.intentId)!,
  ]);
  assert.equal(
    restarted.read(initial.intentId)?.submittedSignature,
    submitted.submittedSignature,
  );
  assert.equal(awaiting.revision, 2);
  assert.throws(() => assertProductionRepository(repository), /durable/);
});

test("repository quarantines corrupt/partial records and preserves partial completion evidence", () => {
  const corrupt = { ...draft(), revision: 0 } as PersistedIntent;
  assert.throws(
    () => InMemoryIntentRepository.hydrate([corrupt]),
    /quarantined/,
  );
  const repository = new InMemoryIntentRepository();
  repository.create(draft());
  repository.transition(draft().intentId, 1, "draft", "awaiting_wallet", 2);
  repository.transition(
    draft().intentId,
    2,
    "awaiting_wallet",
    "intent_submitted",
    3,
    {
      authorizationManifest: authorizationFixture(),
      submittedSignature: finalizedTransactionFixture().signature,
    },
  );
  const partial = repository.transition(
    draft().intentId,
    3,
    "intent_submitted",
    "partially_completed",
    4,
    { partialCompletionHash: "4".repeat(64) },
  );
  assert.equal(partial.partialCompletionHash, "4".repeat(64));
  assert.throws(() =>
    repository.transition(
      draft().intentId,
      4,
      "partially_completed",
      "keeper_pending",
      5,
      { partialCompletionHash: undefined } as unknown as IntentTransitionPatch,
    ),
  );
});

test("two matching caller-fabricated RPC fixtures never satisfy production reconciliation", async () => {
  const transaction = finalizedTransactionFixture();
  const provider = (
    id: string,
    operator: string,
    endpoint: string,
  ): ReviewedRpcProvider => ({
    providerId: id,
    operatorId: operator,
    endpoint,
    reviewEvidenceHash: id === "a" ? "a".repeat(64) : "b".repeat(64),
    transportKind: "synthetic-test",
    async fetchFinalizedTransaction() {
      return structuredClone(transaction);
    },
  });
  const registry = new ReviewedRpcRegistry([
    provider("a", "operator-a", "https://rpc-a.example"),
    provider("b", "operator-b", "https://rpc-b.example"),
  ]);
  const result = await reconcileFinalizedSignature(
    transaction.signature,
    authorizationFixture(),
    registry,
  );
  assert.equal(result.settled, false);
  assert.equal(result.productionEvidence, false);
  assert.match(result.reason, /synthetic/);
  assert.throws(
    () =>
      new ReviewedRpcRegistry([
        provider("a", "operator-a", "https://rpc-a.example"),
        provider("b", "operator-a", "https://rpc-b.example"),
      ]),
  );
  assert.throws(
    () =>
      new ReviewedRpcRegistry([
        provider("a", "operator-a", "https://rpc-a.example"),
        provider("b", "operator-b", "http://rpc-b.example"),
      ]),
  );
});

test("reconciliation rejects hostile inner CPI, altered balances, wrong signer/network/message and missing evidence", async () => {
  const base = finalizedTransactionFixture();
  const mutations = [
    {
      innerInstructions: [{ ...base.innerInstructions[0]!, programId: vault }],
    },
    {
      postTokenBalances: base.postTokenBalances.map((balance) =>
        balance.tokenAccount === userUsdc
          ? { ...balance, amountBaseUnits: "999999" }
          : balance,
      ),
    },
    { signers: [vault] },
    { feePayer: vault },
    { cluster: "devnet" },
    { canonicalV0MessageHash: "f".repeat(64) },
    { innerInstructions: [] },
  ];
  for (const mutation of mutations) {
    const transaction = finalizedTransactionFixture(mutation);
    const providers = (["a", "b"] as const).map((id, index) => ({
      providerId: id,
      operatorId: `operator-${id}`,
      endpoint: `https://rpc-${id}.example`,
      reviewEvidenceHash: (index ? "b" : "a").repeat(64),
      transportKind: "synthetic-test" as const,
      async fetchFinalizedTransaction() {
        return transaction;
      },
    })) as unknown as readonly [ReviewedRpcProvider, ReviewedRpcProvider];
    const result = await reconcileFinalizedSignature(
      transaction.signature,
      authorizationFixture(),
      new ReviewedRpcRegistry(providers),
    );
    assert.equal(result.settled, false);
  }
});

test("timed recovery fails closed and never deletes submitted signatures", () => {
  assert.equal(
    evaluateTimedRecovery({
      state: "awaiting_wallet",
      nowUnix: 100,
      intentExpiresAtUnix: 100,
      withdrawalTimeoutSeconds: 900,
      submittedSignaturePresent: false,
    }),
    "expired",
  );
  assert.equal(
    evaluateTimedRecovery({
      state: "intent_submitted",
      nowUnix: 200,
      intentExpiresAtUnix: 1000,
      withdrawalTimeoutSeconds: 900,
      submittedSignaturePresent: true,
    }),
    "manual_review",
  );
});

test("deployment bundle remains deterministic, unsigned and blocked", async () => {
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
  assert.ok(
    first.steps.every(
      (step) =>
        step.status === "blocked" && step.unsignedPackageFingerprint === null,
    ),
  );
});
