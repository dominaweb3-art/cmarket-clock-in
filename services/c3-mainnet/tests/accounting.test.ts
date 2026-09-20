import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateTargetByBps,
  calculateAllocationAndDrift,
  calculateCandidateFeeForDisclosure,
  calculateFee,
  calculateVaultNavUsdMicros,
  parseDecimalToBaseUnits,
  quoteDeposit,
  quoteRedemption,
} from "../src/index.ts";

const costs = Object.freeze({
  symmetryBountyUsdcBaseUnits: 245_000n,
  networkFeeUsdcBaseUnits: 5_000n,
  priorityFeeUsdcBaseUnits: 1_000n,
  accountRentUsdcBaseUnits: 0n,
  jupiterDexFeeUsdcBaseUnits: 0n,
  slippageUsdcBaseUnits: 5_000n,
  priceImpactUsdcBaseUnits: 1_000n,
  warningThresholdBps: 1_000,
});

test("immutable allocation totals exactly 10,000 bps for 1, 5, 10, and 50 USDC", () => {
  for (const amount of [1_000_000n, 5_000_000n, 10_000_000n, 50_000_000n]) {
    const allocation = allocateTargetByBps(amount);
    assert.deepEqual(allocation, {
      btc: (amount * 4n) / 10n,
      eth: (amount * 3n) / 10n,
      sol: (amount * 3n) / 10n,
    });
    assert.equal(allocation.btc + allocation.eth + allocation.sol, amount);
  }
});

test("decimal parser rejects floating-point and malformed input", () => {
  assert.equal(parseDecimalToBaseUnits("1.000001", 6), 1_000_001n);
  assert.throws(
    () => parseDecimalToBaseUnits(1 as unknown as string, 6),
    TypeError,
  );
  for (const value of ["1e3", "-1", "01", "1.", ".5", "1.0000001"])
    assert.throws(() => parseDecimalToBaseUnits(value, 6));
  assert.throws(() => parseDecimalToBaseUnits("18446744073710", 6), RangeError);
});

test("first 1 USDC deposit issues deterministic six-decimal shares and warns about high cost", () => {
  const quote = quoteDeposit({
    depositUsdcBaseUnits: 1_000_000n,
    vaultNavUsdMicros: 0n,
    shareSupplyBaseUnits: 0n,
    slippageBps: 100,
    costInputs: costs,
  });
  assert.equal(quote.expectedSharesBaseUnits, 1_000_000n);
  assert.equal(quote.minimumSharesBaseUnits, 990_000n);
  assert.equal(quote.activeFeeBaseUnits, 0n);
  assert.equal(quote.candidateFeeBaseUnits, 1_500n);
  assert.equal(quote.effectiveCostBps, 2_570n);
  assert.equal(quote.economicallyInefficient, true);
});

test("first-time share token account discloses rent while an existing account does not change share math", () => {
  const firstTime = quoteDeposit({
    depositUsdcBaseUnits: 1_000_000n,
    vaultNavUsdMicros: 0n,
    shareSupplyBaseUnits: 0n,
    slippageBps: 100,
    costInputs: { ...costs, accountRentUsdcBaseUnits: 20_000n },
  });
  const existing = quoteDeposit({
    depositUsdcBaseUnits: 1_000_000n,
    vaultNavUsdMicros: 0n,
    shareSupplyBaseUnits: 0n,
    slippageBps: 100,
    costInputs: { ...costs, accountRentUsdcBaseUnits: 0n },
  });
  assert.equal(
    firstTime.expectedSharesBaseUnits,
    existing.expectedSharesBaseUnits,
  );
  assert.equal(
    firstTime.totalEstimatedEffectiveCostBaseUnits -
      existing.totalEstimatedEffectiveCostBaseUnits,
    20_000n,
  );
});

test("subsequent deposit and proportional redemption use NAV/share supply", () => {
  const deposit = quoteDeposit({
    depositUsdcBaseUnits: 5_000_000n,
    vaultNavUsdMicros: 20_000_000n,
    shareSupplyBaseUnits: 10_000_000n,
    slippageBps: 50,
    costInputs: { ...costs, symmetryBountyUsdcBaseUnits: 0n },
  });
  assert.equal(deposit.expectedSharesBaseUnits, 2_500_000n);
  assert.equal(deposit.minimumSharesBaseUnits, 2_487_500n);
  const redemption = quoteRedemption({
    sharesBaseUnits: 2_500_000n,
    vaultNavUsdMicros: 20_000_000n,
    shareSupplyBaseUnits: 10_000_000n,
    slippageBps: 50,
  });
  assert.equal(redemption.expectedUsdcBaseUnits, 5_000_000n);
  assert.equal(redemption.minimumUsdcBaseUnits, 4_975_000n);
});

test("candidate fee math is exact while collection remains inactive", () => {
  assert.equal(calculateFee(1_000_000n, "inactive"), 0n);
  assert.equal(calculateCandidateFeeForDisclosure(1_000_000n), 1_500n);
  assert.equal(calculateCandidateFeeForDisclosure(1_000_000n, true), 750n);
  assert.throws(() => calculateFee(1_000_000n, "candidate"));
  assert.throws(() => calculateFee(1_000_000n, "skr_candidate"));
});

test("NAV and target-versus-current drift remain distinct", () => {
  const nav = calculateVaultNavUsdMicros([
    {
      asset: "cbBTC",
      balanceBaseUnits: 100_000_000n,
      decimals: 8,
      priceUsdMicros: 100_000_000_000n,
    },
    {
      asset: "PortalETH",
      balanceBaseUnits: 100_000_000n,
      decimals: 8,
      priceUsdMicros: 3_000_000_000n,
    },
    {
      asset: "WSOL",
      balanceBaseUnits: 1_000_000_000n,
      decimals: 9,
      priceUsdMicros: 100_000_000n,
    },
  ]);
  assert.equal(nav, 103_100_000_000n);
  const allocation = calculateAllocationAndDrift({
    btc: 40_000_000n,
    eth: 30_000_000n,
    sol: 30_000_000n,
  });
  assert.deepEqual(allocation.currentBps, {
    btc: 4_000n,
    eth: 3_000n,
    sol: 3_000n,
  });
  assert.deepEqual(allocation.driftBps, { btc: 0n, eth: 0n, sol: 0n });
});

test("accounting rejects below-minimum, inconsistent first deposit, zero shares, and invalid redemption", () => {
  assert.throws(() =>
    quoteDeposit({
      depositUsdcBaseUnits: 999_999n,
      vaultNavUsdMicros: 0n,
      shareSupplyBaseUnits: 0n,
      slippageBps: 100,
      costInputs: costs,
    }),
  );
  assert.throws(() =>
    quoteDeposit({
      depositUsdcBaseUnits: 1_000_000n,
      vaultNavUsdMicros: 1n,
      shareSupplyBaseUnits: 0n,
      slippageBps: 100,
      costInputs: costs,
    }),
  );
  assert.throws(() =>
    quoteDeposit({
      depositUsdcBaseUnits: 1_000_000n,
      vaultNavUsdMicros: 18_000_000_000_000_000_000n,
      shareSupplyBaseUnits: 1n,
      slippageBps: 100,
      costInputs: costs,
    }),
  );
  assert.throws(() =>
    quoteRedemption({
      sharesBaseUnits: 2n,
      vaultNavUsdMicros: 1n,
      shareSupplyBaseUnits: 1n,
      slippageBps: 10,
    }),
  );
});
