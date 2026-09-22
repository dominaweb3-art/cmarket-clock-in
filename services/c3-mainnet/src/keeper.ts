import {
  C3_ALLOCATION,
  C3_AMOUNTS,
  C3_MAINNET,
  C3_MAINNET_EXECUTION_CAPABILITY,
  assertExecutionDisabled,
} from "./constants.ts";
import { calculateAllocationAndDrift } from "./accounting.ts";
import {
  assertU64,
  checkedAddU64,
  checkedSubU64,
  checkedMulDivFloorU64,
} from "./math.ts";

type KeeperEvidence = Readonly<{
  evidenceId: string;
  vault: string;
  cluster: "mainnet-beta";
  policyVersion: string;
  configurationVersion: string;
  mint: string;
  inputMint: string;
  outputMint: string;
  inputAmountBaseUnits: string;
  minimumOutputBaseUnits: string;
  slippageBps: number;
  routePrograms: readonly string[];
  observedSlot: number;
  observedAtUnix: number;
  expiresAtUnix: number;
  sourceHash: string;
  planning: Readonly<{
    settledValuesUsdMicros: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
    pendingFlows: KeeperPendingFlows;
    intentExpired: boolean;
  }>;
}>;

// These registries deliberately have no caller-facing registration API.
const ORACLE_EVIDENCE: ReadonlyMap<string, KeeperEvidence> = new Map();
const ROUTE_EVIDENCE: ReadonlyMap<string, KeeperEvidence> = new Map();

function requireSealedEvidence(
  oracleEvidenceId: string,
  routeEvidenceId: string,
): KeeperEvidence {
  const oracle = ORACLE_EVIDENCE.get(oracleEvidenceId);
  const route = ROUTE_EVIDENCE.get(routeEvidenceId);
  if (!oracle || !route)
    throw new Error(
      "EXTERNAL_CONFIGURATION_MISSING: sealed keeper evidence is unavailable.",
    );
  const nowUnix = Math.floor(Date.now() / 1_000);
  for (const evidence of [oracle, route]) {
    if (
      evidence.vault !== C3_MAINNET.symmetryGlobalConfig ||
      evidence.cluster !== C3_MAINNET.cluster ||
      evidence.policyVersion !== "1" ||
      evidence.configurationVersion !== "c3-mainnet-disabled/v1" ||
      !/^[a-f0-9]{64}$/.test(evidence.sourceHash) ||
      !Number.isSafeInteger(evidence.observedSlot) ||
      evidence.observedSlot <= 0 ||
      !Number.isSafeInteger(evidence.observedAtUnix) ||
      !Number.isSafeInteger(evidence.expiresAtUnix) ||
      evidence.observedAtUnix > nowUnix ||
      nowUnix >= evidence.expiresAtUnix ||
      evidence.inputMint !== C3_MAINNET.usdcMint ||
      !Number.isSafeInteger(evidence.slippageBps) ||
      evidence.slippageBps < 0 ||
      evidence.slippageBps > 100 ||
      !new Set<string>([
        C3_MAINNET.cbBtcMint,
        C3_MAINNET.portalEthMint,
        C3_MAINNET.wrappedSolMint,
      ]).has(evidence.outputMint) ||
      evidence.mint !== evidence.outputMint
    )
      throw new Error(
        "Sealed keeper evidence is stale or bound to another policy, vault, mint, or network.",
      );
    assertU64(BigInt(evidence.inputAmountBaseUnits), "keeper evidence amount");
    assertU64(
      BigInt(evidence.minimumOutputBaseUnits),
      "keeper evidence minimum",
    );
  }
  if (
    oracle.evidenceId !== oracleEvidenceId ||
    route.evidenceId !== routeEvidenceId ||
    oracle.mint !== route.mint ||
    oracle.inputAmountBaseUnits !== route.inputAmountBaseUnits ||
    oracle.observedSlot !== route.observedSlot ||
    route.routePrograms.length === 0 ||
    route.routePrograms.some(
      (program) => program !== C3_MAINNET.jupiterProgram,
    ) ||
    BigInt(route.inputAmountBaseUnits) >
      C3_AMOUNTS.maximumPilotPurchaseUsdcBaseUnits ||
    route.planning.pendingFlows.pendingSwapInputsUsdcBaseUnits.toString() !==
      route.inputAmountBaseUnits
  )
    throw new Error("Sealed keeper route and oracle evidence disagree.");
  return route;
}

export const C3_KEEPER_PERMISSIONS = Object.freeze([
  "read_authorized_intents",
  "read_vault_state",
  "read_verified_oracles",
  "request_reviewed_routes",
  "propose_bounded_vault_rebalance",
  "simulate_unsigned_plan",
  "write_redacted_evidence",
  "request_manual_review",
]);

export type KeeperPlan = Readonly<{
  executionCapability: false;
  action: "no_trade" | "manual_review" | "proposed_rebalance";
  reason: string;
  currentBps: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
  projectedPostFlowNavUsdMicros: bigint;
  trades: readonly Readonly<{
    asset: "btc" | "eth" | "sol";
    direction: "buy" | "sell";
    valueUsdMicros: bigint;
  }>[];
  automaticRetry: false;
  automaticReversal: false;
}>;

export type KeeperPendingFlows = Readonly<{
  authorizedInflowsUsdcBaseUnits: bigint;
  authorizedWithdrawalsUsdcBaseUnits: bigint;
  pendingSwapInputsUsdcBaseUnits: bigint;
  partiallyCompletedAssetDeltasUsdMicros: Readonly<{
    btc: bigint;
    eth: bigint;
    sol: bigint;
  }>;
  failedLegPresent: boolean;
  reservedFeesUsdcBaseUnits: bigint;
  reservedBountyUsdcBaseUnits: bigint;
  operationalDustUsdcBaseUnits: bigint;
}>;

export function planAggregatedRebalance(
  input: Readonly<{
    oracleEvidenceId: string;
    routeEvidenceId: string;
  }>,
): KeeperPlan {
  assertExecutionDisabled();
  if (
    Object.keys(input).sort().join(",") !== "oracleEvidenceId,routeEvidenceId"
  )
    throw new Error("Keeper request accepts sealed evidence identifiers only.");
  const sealed = requireSealedEvidence(
    input.oracleEvidenceId,
    input.routeEvidenceId,
  );
  return planFromSealedEvidence({
    ...sealed.planning,
    aggregationThresholdUsdcBaseUnits: C3_AMOUNTS.minimumPurchaseUsdcBaseUnits,
    driftThresholdBps: 100,
    minimumExecutableTradeUsdMicros: 10_000n,
  });
}

function planFromSealedEvidence(
  input: Readonly<{
    settledValuesUsdMicros: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
    pendingFlows: KeeperPendingFlows;
    aggregationThresholdUsdcBaseUnits: bigint;
    driftThresholdBps: number;
    minimumExecutableTradeUsdMicros: bigint;
    intentExpired: boolean;
  }>,
): KeeperPlan {
  assertU64(input.aggregationThresholdUsdcBaseUnits, "aggregation threshold");
  assertU64(input.minimumExecutableTradeUsdMicros, "minimum trade");
  if (
    !Number.isInteger(input.driftThresholdBps) ||
    input.driftThresholdBps < 0 ||
    input.driftThresholdBps > 10_000
  )
    throw new RangeError("Keeper drift threshold is invalid.");
  for (const [label, value] of Object.entries({
    ...input.settledValuesUsdMicros,
    partialBtc: input.pendingFlows.partiallyCompletedAssetDeltasUsdMicros.btc,
    partialEth: input.pendingFlows.partiallyCompletedAssetDeltasUsdMicros.eth,
    partialSol: input.pendingFlows.partiallyCompletedAssetDeltasUsdMicros.sol,
    authorizedInflows: input.pendingFlows.authorizedInflowsUsdcBaseUnits,
    authorizedWithdrawals:
      input.pendingFlows.authorizedWithdrawalsUsdcBaseUnits,
    pendingSwapInputs: input.pendingFlows.pendingSwapInputsUsdcBaseUnits,
    reservedFees: input.pendingFlows.reservedFeesUsdcBaseUnits,
    reservedBounty: input.pendingFlows.reservedBountyUsdcBaseUnits,
    operationalDust: input.pendingFlows.operationalDustUsdcBaseUnits,
  }))
    assertU64(value, label);
  if (
    input.pendingFlows.pendingSwapInputsUsdcBaseUnits >
    input.pendingFlows.authorizedInflowsUsdcBaseUnits
  )
    throw new Error(
      "Pending swap inputs cannot exceed authorized pooled inflows.",
    );
  const effectiveValues = {
    btc: checkedAddU64(
      input.settledValuesUsdMicros.btc,
      input.pendingFlows.partiallyCompletedAssetDeltasUsdMicros.btc,
      "effective BTC value",
    ),
    eth: checkedAddU64(
      input.settledValuesUsdMicros.eth,
      input.pendingFlows.partiallyCompletedAssetDeltasUsdMicros.eth,
      "effective ETH value",
    ),
    sol: checkedAddU64(
      input.settledValuesUsdMicros.sol,
      input.pendingFlows.partiallyCompletedAssetDeltasUsdMicros.sol,
      "effective SOL value",
    ),
  };
  const allocation = calculateAllocationAndDrift(effectiveValues);
  const liabilities = [
    input.pendingFlows.authorizedWithdrawalsUsdcBaseUnits,
    input.pendingFlows.reservedFeesUsdcBaseUnits,
    input.pendingFlows.reservedBountyUsdcBaseUnits,
    input.pendingFlows.operationalDustUsdcBaseUnits,
  ].reduce(
    (sum, value) => checkedAddU64(sum, value, "projected liabilities"),
    0n,
  );
  const grossProjected = checkedAddU64(
    allocation.total,
    input.pendingFlows.authorizedInflowsUsdcBaseUnits,
    "gross projected NAV",
  );
  if (liabilities > grossProjected)
    throw new Error("Projected pooled liabilities exceed vault assets.");
  const projectedTotal = checkedSubU64(
    grossProjected,
    liabilities,
    "projected post-flow NAV",
  );
  const base = {
    executionCapability: C3_MAINNET_EXECUTION_CAPABILITY,
    currentBps: allocation.currentBps,
    projectedPostFlowNavUsdMicros: projectedTotal,
    automaticRetry: false as const,
    automaticReversal: false as const,
  };
  if (input.intentExpired || input.pendingFlows.failedLegPresent)
    return Object.freeze({
      ...base,
      action: "manual_review",
      reason: "expired, failed, or unverified pooled evidence",
      trades: Object.freeze([]),
    });
  const netFlow =
    input.pendingFlows.authorizedInflowsUsdcBaseUnits -
    input.pendingFlows.authorizedWithdrawalsUsdcBaseUnits;
  const outsideDrift = Object.values(allocation.driftBps).some(
    (drift) => drift > BigInt(input.driftThresholdBps),
  );
  const thresholdMet =
    netFlow >= input.aggregationThresholdUsdcBaseUnits ||
    -netFlow >= input.aggregationThresholdUsdcBaseUnits;
  if (!outsideDrift && !thresholdMet)
    return Object.freeze({
      ...base,
      action: "no_trade",
      reason: "pooled net flow and drift remain below policy thresholds",
      trades: Object.freeze([]),
    });
  const targets = {
    btc: checkedMulDivFloorU64(
      projectedTotal,
      BigInt(C3_ALLOCATION.btcBps),
      10_000n,
      "BTC target",
    ),
    eth: checkedMulDivFloorU64(
      projectedTotal,
      BigInt(C3_ALLOCATION.ethBps),
      10_000n,
      "ETH target",
    ),
    sol: 0n,
  };
  targets.sol = projectedTotal - targets.btc - targets.eth;
  const trades = (["btc", "eth", "sol"] as const)
    .map((asset) => {
      const difference = targets[asset] - effectiveValues[asset];
      return Object.freeze({
        asset,
        direction: difference >= 0n ? ("buy" as const) : ("sell" as const),
        valueUsdMicros: difference >= 0n ? difference : -difference,
      });
    })
    .filter(
      (trade) => trade.valueUsdMicros >= input.minimumExecutableTradeUsdMicros,
    );
  if (trades.length === 0)
    return Object.freeze({
      ...base,
      action: "no_trade",
      reason: "all pooled deviations are dust below executable route minimums",
      trades: Object.freeze([]),
    });
  return Object.freeze({
    ...base,
    action: "proposed_rebalance",
    reason: "projected pooled vault requires a bounded reviewed rebalance",
    trades: Object.freeze(trades),
  });
}
