import { C3_ALLOCATION, C3_AMOUNTS, C3_FEES } from "./constants.ts";
import { absolute, assertU64, mulDivCeil, mulDivFloor } from "./math.ts";
import type { C3AssetId } from "./registry.ts";

export type PricedBalance = Readonly<{
  asset: C3AssetId;
  balanceBaseUnits: bigint;
  decimals: number;
  priceUsdMicros: bigint;
}>;

export type FeeMode = "inactive" | "candidate" | "skr_candidate";

export type CostInputs = Readonly<{
  symmetryBountyUsdcBaseUnits: bigint;
  networkFeeUsdcBaseUnits: bigint;
  priorityFeeUsdcBaseUnits: bigint;
  accountRentUsdcBaseUnits: bigint;
  jupiterDexFeeUsdcBaseUnits: bigint;
  slippageUsdcBaseUnits: bigint;
  priceImpactUsdcBaseUnits: bigint;
  warningThresholdBps: number;
}>;

export function calculateVaultNavUsdMicros(
  balances: readonly PricedBalance[],
): bigint {
  if (balances.length === 0)
    throw new RangeError("Vault NAV requires at least one asset.");
  let total = 0n;
  for (const balance of balances) {
    assertU64(balance.balanceBaseUnits, `${balance.asset} balance`);
    if (
      !Number.isInteger(balance.decimals) ||
      balance.decimals < 0 ||
      balance.decimals > 18
    )
      throw new RangeError("Invalid asset decimals.");
    if (balance.priceUsdMicros <= 0n)
      throw new RangeError(`${balance.asset} price must be positive.`);
    total += mulDivFloor(
      balance.balanceBaseUnits,
      balance.priceUsdMicros,
      10n ** BigInt(balance.decimals),
    );
  }
  return total;
}

export function calculateFee(amountBaseUnits: bigint, mode: FeeMode): bigint {
  assertU64(amountBaseUnits, "fee amount");
  if (mode === "inactive") return 0n;
  if (
    !C3_FEES.collectionEnabled ||
    !C3_FEES.securityApproved ||
    !C3_FEES.governanceApproved
  ) {
    throw new Error("C3 fee collection is not approved or enabled.");
  }
  const rate =
    mode === "skr_candidate"
      ? C3_FEES.skrDiscountedRateUnits
      : C3_FEES.buyRateUnits;
  return mulDivFloor(amountBaseUnits, rate, C3_FEES.denominator);
}

export function calculateCandidateFeeForDisclosure(
  amountBaseUnits: bigint,
  discounted = false,
): bigint {
  assertU64(amountBaseUnits, "fee disclosure amount");
  const rate = discounted
    ? C3_FEES.skrDiscountedRateUnits
    : C3_FEES.buyRateUnits;
  return mulDivFloor(amountBaseUnits, rate, C3_FEES.denominator);
}

export function quoteDeposit(
  input: Readonly<{
    depositUsdcBaseUnits: bigint;
    vaultNavUsdMicros: bigint;
    shareSupplyBaseUnits: bigint;
    slippageBps: number;
    costInputs: CostInputs;
  }>,
): Readonly<{
  expectedSharesBaseUnits: bigint;
  minimumSharesBaseUnits: bigint;
  activeFeeBaseUnits: bigint;
  candidateFeeBaseUnits: bigint;
  totalEstimatedEffectiveCostBaseUnits: bigint;
  effectiveCostBps: bigint;
  economicallyInefficient: boolean;
}> {
  const deposit = assertU64(input.depositUsdcBaseUnits, "deposit");
  if (deposit < C3_AMOUNTS.minimumPurchaseUsdcBaseUnits)
    throw new RangeError("Controlled pilot minimum is 1 USDC.");
  if (deposit > C3_AMOUNTS.maximumPilotPurchaseUsdcBaseUnits)
    throw new RangeError("Controlled pilot maximum is 10 USDC.");
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 100
  )
    throw new RangeError("Slippage must be 0-100 bps.");
  assertU64(input.vaultNavUsdMicros, "vault NAV");
  assertU64(input.shareSupplyBaseUnits, "share supply");
  if ((input.vaultNavUsdMicros === 0n) !== (input.shareSupplyBaseUnits === 0n))
    throw new Error("NAV and share supply cannot disagree for first deposit.");

  const activeFeeBaseUnits = calculateFee(deposit, "inactive");
  const netDeposit = deposit - activeFeeBaseUnits;
  const expectedSharesBaseUnits =
    input.shareSupplyBaseUnits === 0n
      ? netDeposit
      : mulDivFloor(
          netDeposit,
          input.shareSupplyBaseUnits,
          input.vaultNavUsdMicros,
        );
  if (expectedSharesBaseUnits <= 0n)
    throw new RangeError("Deposit would issue zero C3 shares.");
  const minimumSharesBaseUnits = mulDivFloor(
    expectedSharesBaseUnits,
    BigInt(10_000 - input.slippageBps),
    10_000n,
  );
  const candidateFeeBaseUnits = calculateCandidateFeeForDisclosure(deposit);
  const variableCosts = [
    input.costInputs.symmetryBountyUsdcBaseUnits,
    input.costInputs.networkFeeUsdcBaseUnits,
    input.costInputs.priorityFeeUsdcBaseUnits,
    input.costInputs.accountRentUsdcBaseUnits,
    input.costInputs.jupiterDexFeeUsdcBaseUnits,
    input.costInputs.slippageUsdcBaseUnits,
    input.costInputs.priceImpactUsdcBaseUnits,
  ];
  for (const value of variableCosts) assertU64(value, "cost component");
  const totalEstimatedEffectiveCostBaseUnits = variableCosts.reduce(
    (sum, value) => sum + value,
    activeFeeBaseUnits,
  );
  const effectiveCostBps = mulDivCeil(
    totalEstimatedEffectiveCostBaseUnits,
    10_000n,
    deposit,
  );
  return Object.freeze({
    expectedSharesBaseUnits,
    minimumSharesBaseUnits,
    activeFeeBaseUnits,
    candidateFeeBaseUnits,
    totalEstimatedEffectiveCostBaseUnits,
    effectiveCostBps,
    economicallyInefficient:
      effectiveCostBps >= BigInt(input.costInputs.warningThresholdBps),
  });
}

export function quoteRedemption(
  input: Readonly<{
    sharesBaseUnits: bigint;
    vaultNavUsdMicros: bigint;
    shareSupplyBaseUnits: bigint;
    slippageBps: number;
  }>,
): Readonly<{
  expectedUsdcBaseUnits: bigint;
  minimumUsdcBaseUnits: bigint;
  activeFeeBaseUnits: bigint;
}> {
  const shares = assertU64(input.sharesBaseUnits, "redemption shares");
  const nav = assertU64(input.vaultNavUsdMicros, "vault NAV");
  const supply = assertU64(input.shareSupplyBaseUnits, "share supply");
  if (shares === 0n || supply === 0n || shares > supply)
    throw new RangeError("Invalid proportional redemption.");
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 100
  )
    throw new RangeError("Invalid redemption slippage.");
  const gross = mulDivFloor(shares, nav, supply);
  const activeFeeBaseUnits = calculateFee(gross, "inactive");
  const expectedUsdcBaseUnits = gross - activeFeeBaseUnits;
  return Object.freeze({
    expectedUsdcBaseUnits,
    minimumUsdcBaseUnits: mulDivFloor(
      expectedUsdcBaseUnits,
      BigInt(10_000 - input.slippageBps),
      10_000n,
    ),
    activeFeeBaseUnits,
  });
}

export function calculateAllocationAndDrift(
  values: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>,
): Readonly<{
  total: bigint;
  currentBps: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
  driftBps: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
}> {
  const total = values.btc + values.eth + values.sol;
  if (total <= 0n)
    throw new RangeError("Allocation requires positive vault value.");
  const btc = mulDivFloor(values.btc, 10_000n, total);
  const eth = mulDivFloor(values.eth, 10_000n, total);
  const sol = 10_000n - btc - eth;
  return Object.freeze({
    total,
    currentBps: Object.freeze({ btc, eth, sol }),
    driftBps: Object.freeze({
      btc: absolute(btc - BigInt(C3_ALLOCATION.btcBps)),
      eth: absolute(eth - BigInt(C3_ALLOCATION.ethBps)),
      sol: absolute(sol - BigInt(C3_ALLOCATION.solBps)),
    }),
  });
}
