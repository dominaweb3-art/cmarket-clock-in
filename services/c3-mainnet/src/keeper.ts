import {
  C3_ALLOCATION,
  C3_MAINNET_EXECUTION_CAPABILITY,
  assertExecutionDisabled,
} from "./constants.ts";
import { calculateAllocationAndDrift } from "./accounting.ts";
import {
  assertU64,
  checkedAddU64,
  checkedSubU64,
  mulDivFloor,
} from "./math.ts";

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
    settledValuesUsdMicros: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
    pendingFlows: KeeperPendingFlows;
    aggregationThresholdUsdcBaseUnits: bigint;
    driftThresholdBps: number;
    minimumExecutableTradeUsdMicros: bigint;
    intentExpired: boolean;
    oracleVerified: boolean;
    routeRegistryVerified: boolean;
  }>,
): KeeperPlan {
  assertExecutionDisabled();
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
  if (
    input.intentExpired ||
    !input.oracleVerified ||
    !input.routeRegistryVerified ||
    input.pendingFlows.failedLegPresent
  )
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
    btc: mulDivFloor(projectedTotal, BigInt(C3_ALLOCATION.btcBps), 10_000n),
    eth: mulDivFloor(projectedTotal, BigInt(C3_ALLOCATION.ethBps), 10_000n),
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
