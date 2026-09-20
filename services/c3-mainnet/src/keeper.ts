import {
  C3_ALLOCATION,
  C3_MAINNET_EXECUTION_CAPABILITY,
  assertExecutionDisabled,
} from "./constants.ts";
import { calculateAllocationAndDrift } from "./accounting.ts";
import { mulDivFloor } from "./math.ts";

export const C3_KEEPER_PERMISSIONS = Object.freeze([
  "read_authorized_intents",
  "read_vault_state",
  "read_verified_oracles",
  "request_reviewed_routes",
  "propose_bounded_rebalance",
  "simulate_unsigned_plan",
  "write_redacted_evidence",
  "request_manual_review",
]);

export type KeeperPlan = Readonly<{
  executionCapability: false;
  action: "no_trade" | "manual_review" | "proposed_rebalance";
  reason: string;
  currentBps: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
  trades: readonly Readonly<{
    asset: "btc" | "eth" | "sol";
    direction: "buy" | "sell";
    valueUsdMicros: bigint;
  }>[];
  automaticRetry: false;
  automaticReversal: false;
}>;

export function planAggregatedRebalance(
  input: Readonly<{
    currentValuesUsdMicros: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
    netFlowUsdcBaseUnits: bigint;
    aggregationThresholdUsdcBaseUnits: bigint;
    driftThresholdBps: number;
    minimumExecutableTradeUsdMicros: bigint;
    intentExpired: boolean;
    oracleVerified: boolean;
    routeRegistryVerified: boolean;
  }>,
): KeeperPlan {
  assertExecutionDisabled();
  const allocation = calculateAllocationAndDrift(input.currentValuesUsdMicros);
  const base = {
    executionCapability: C3_MAINNET_EXECUTION_CAPABILITY,
    currentBps: allocation.currentBps,
    automaticRetry: false as const,
    automaticReversal: false as const,
  };
  if (
    input.intentExpired ||
    !input.oracleVerified ||
    !input.routeRegistryVerified
  )
    return Object.freeze({
      ...base,
      action: "manual_review",
      reason: "expired or unverified evidence",
      trades: Object.freeze([]),
    });
  const outsideDrift = Object.values(allocation.driftBps).some(
    (drift) => drift > BigInt(input.driftThresholdBps),
  );
  const thresholdMet =
    input.netFlowUsdcBaseUnits >= input.aggregationThresholdUsdcBaseUnits ||
    -input.netFlowUsdcBaseUnits >= input.aggregationThresholdUsdcBaseUnits;
  if (!outsideDrift && !thresholdMet)
    return Object.freeze({
      ...base,
      action: "no_trade",
      reason: "pooled vault remains within drift and aggregation thresholds",
      trades: Object.freeze([]),
    });
  const targets = {
    btc: mulDivFloor(allocation.total, BigInt(C3_ALLOCATION.btcBps), 10_000n),
    eth: mulDivFloor(allocation.total, BigInt(C3_ALLOCATION.ethBps), 10_000n),
    sol: 0n,
  };
  targets.sol = allocation.total - targets.btc - targets.eth;
  const trades = (["btc", "eth", "sol"] as const)
    .map((asset) => {
      const difference = targets[asset] - input.currentValuesUsdMicros[asset];
      return {
        asset,
        direction: difference >= 0n ? ("buy" as const) : ("sell" as const),
        valueUsdMicros: difference >= 0n ? difference : -difference,
      };
    })
    .filter(
      (trade) => trade.valueUsdMicros >= input.minimumExecutableTradeUsdMicros,
    );
  if (trades.length === 0)
    return Object.freeze({
      ...base,
      action: "no_trade",
      reason: "all derived trades are below executable route minimums",
      trades: Object.freeze([]),
    });
  return Object.freeze({
    ...base,
    action: "proposed_rebalance",
    reason: "pooled vault requires a bounded reviewed rebalance",
    trades: Object.freeze(trades),
  });
}
