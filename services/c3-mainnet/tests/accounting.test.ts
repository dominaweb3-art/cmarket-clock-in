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
  validateReconciledVaultSnapshot,
} from "../src/index.ts";
import { snapshotPolicy, vaultSnapshot } from "./fixtures.ts";

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

test("immutable allocation totals exactly 10,000 bps for pilot sizes", () => {
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

test("decimal parser and fee policy reject coercion while fees remain disabled", () => {
  assert.equal(parseDecimalToBaseUnits("1.000001", 6), 1_000_001n);
  for (const value of ["1e3", "-1", "01", "1.", ".5", "1.0000001"])
    assert.throws(() => parseDecimalToBaseUnits(value, 6));
  assert.equal(calculateFee(1_000_000n, "inactive"), 0n);
  assert.equal(calculateCandidateFeeForDisclosure(1_000_000n), 1_500n);
  assert.equal(calculateCandidateFeeForDisclosure(1_000_000n, true), 750n);
  assert.throws(() => calculateFee(1_000_000n, "candidate"));
});

test("deposit and redemption derive NAV and supply only from a reconciled snapshot", () => {
  const snapshot = vaultSnapshot();
  const deposit = quoteDeposit({
    depositUsdcBaseUnits: 5_000_000n,
    snapshot,
    snapshotPolicy,
    nowUnix: 1_000,
    currentSlot: 110,
    slippageBps: 50,
    costInputs: { ...costs, symmetryBountyUsdcBaseUnits: 0n },
  });
  assert.equal(deposit.expectedSharesBaseUnits, 2_500_000n);
  assert.equal(deposit.minimumSharesBaseUnits, 2_487_500n);
  const redemption = quoteRedemption({
    sharesBaseUnits: 2_500_000n,
    snapshot,
    snapshotPolicy,
    nowUnix: 1_000,
    currentSlot: 110,
    slippageBps: 50,
  });
  assert.equal(redemption.expectedUsdcBaseUnits, 5_000_000n);
  assert.equal(redemption.minimumUsdcBaseUnits, 4_975_000n);
});

test("bootstrap is fail-closed and issues deterministic shares only with reviewed seed evidence", () => {
  const empty = vaultSnapshot("0", "0");
  const quote = quoteDeposit({
    depositUsdcBaseUnits: 1_000_000n,
    snapshot: empty,
    snapshotPolicy,
    nowUnix: 1_000,
    currentSlot: 110,
    slippageBps: 100,
    costInputs: costs,
  });
  assert.equal(quote.expectedSharesBaseUnits, 1_000_000n);
  assert.equal(quote.minimumSharesBaseUnits, 990_000n);
  const { bootstrapEvidenceHash: _omitted, ...noBootstrapPolicy } =
    snapshotPolicy;
  void _omitted;
  assert.throws(() =>
    quoteDeposit({
      depositUsdcBaseUnits: 1_000_000n,
      snapshot: empty,
      snapshotPolicy: noBootstrapPolicy,
      nowUnix: 1_000,
      currentSlot: 110,
      slippageBps: 100,
      costInputs: costs,
    }),
  );
});

test("snapshot validation rejects donation, stale data, wrong configuration, duplicate account, wrong decimals and insolvent liabilities", () => {
  const cases = [
    vaultSnapshot(undefined, undefined, { unsolicitedDonations: ["1"] }),
    vaultSnapshot(undefined, undefined, { blockTimeUnix: 900 }),
    vaultSnapshot(undefined, undefined, { configurationHash: "f".repeat(64) }),
    vaultSnapshot(undefined, undefined, {
      balances: [
        vaultSnapshot().balances[0]!,
        vaultSnapshot().balances[0]!,
        ...vaultSnapshot().balances.slice(2),
      ],
    }),
    vaultSnapshot(undefined, undefined, {
      balances: vaultSnapshot().balances.map((balance) =>
        balance.asset === "USDC" ? { ...balance, decimals: 9 } : balance,
      ),
    }),
    vaultSnapshot("1", "1", { pendingAuthorizedOutflowsUsdcBaseUnits: "2" }),
    vaultSnapshot("20000000", "0"),
  ];
  for (const snapshot of cases)
    assert.throws(() =>
      validateReconciledVaultSnapshot(snapshot, snapshotPolicy, 1_000, 110),
    );
});

test("snapshot-based accounting rejects zero-share dilution, excessive redemption and stale oracle", () => {
  assert.throws(() =>
    quoteDeposit({
      depositUsdcBaseUnits: 1_000_000n,
      snapshot: vaultSnapshot("18446744073709551615", "1"),
      snapshotPolicy,
      nowUnix: 1_000,
      currentSlot: 110,
      slippageBps: 100,
      costInputs: costs,
    }),
  );
  assert.throws(() =>
    quoteRedemption({
      sharesBaseUnits: 10_000_001n,
      snapshot: vaultSnapshot(),
      snapshotPolicy,
      nowUnix: 1_000,
      currentSlot: 110,
      slippageBps: 50,
    }),
  );
  const stale = vaultSnapshot(undefined, undefined, {
    balances: vaultSnapshot().balances.map((balance) => ({
      ...balance,
      oraclePublishTimeUnix: 900,
    })),
  });
  assert.throws(() =>
    validateReconciledVaultSnapshot(stale, snapshotPolicy, 1_000, 110),
  );
});

test("NAV and target drift remain exact deterministic bigint calculations", () => {
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
