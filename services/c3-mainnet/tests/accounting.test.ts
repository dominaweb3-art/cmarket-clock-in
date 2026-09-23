import assert from "node:assert/strict";
import test from "node:test";

import {
  C3_AMOUNTS,
  allocateTargetByBps,
  calculateAllocationAndDrift,
  calculateCandidateFeeForDisclosure,
  calculateFee,
  calculateVaultNavUsdMicros,
  checkedAddU64,
  checkedMulDivFloorU64,
  checkedSubU64,
  parseDecimalToBaseUnits,
  quoteDeposit,
  validateReconciledVaultSnapshot,
} from "./support/index.ts";
import { fabricatedVaultSnapshot, snapshotPolicy } from "./fixtures.ts";

test("decimal conversion and 40/30/30 allocation stay exact", () => {
  const amount = parseDecimalToBaseUnits("1.000001", 6);
  assert.equal(amount, 1_000_001n);
  assert.deepEqual(allocateTargetByBps(10_000_003n), {
    btc: 4_000_001n,
    eth: 3_000_000n,
    sol: 3_000_002n,
  });
});

test("checked u64 arithmetic rejects overflow and underflow", () => {
  assert.throws(
    () => checkedAddU64(C3_AMOUNTS.u64Max, 1n, "total"),
    /unsigned 64-bit range/,
  );
  assert.throws(() => checkedSubU64(0n, 1n, "total"), /underflow/);
  assert.equal(
    checkedMulDivFloorU64(C3_AMOUNTS.u64Max, 2n, 2n, "ratio"),
    C3_AMOUNTS.u64Max,
  );
});

test("NAV uses deterministic checked integer arithmetic", () => {
  assert.equal(
    calculateVaultNavUsdMicros([
      {
        asset: "USDC",
        balanceBaseUnits: 2_000_000n,
        decimals: 6,
        priceUsdMicros: 1_000_000n,
      },
      {
        asset: "cbBTC",
        balanceBaseUnits: 100_000_000n,
        decimals: 8,
        priceUsdMicros: 100_000_000_000n,
      },
    ]),
    100_002_000_000n,
  );
});

test("NAV rejects a priced-value or aggregate overflow", () => {
  assert.throws(
    () =>
      calculateVaultNavUsdMicros([
        {
          asset: "cbBTC",
          balanceBaseUnits: C3_AMOUNTS.u64Max,
          decimals: 0,
          priceUsdMicros: C3_AMOUNTS.u64Max,
        },
      ]),
    /unsigned 64-bit range/,
  );
});

test("fee collection remains disabled while candidate disclosure is exact", () => {
  assert.equal(calculateFee(1_000_000n, "inactive"), 0n);
  assert.equal(calculateCandidateFeeForDisclosure(1_000_000n), 1_500n);
  assert.equal(calculateCandidateFeeForDisclosure(1_000_000n, true), 750n);
  assert.throws(
    () => calculateFee(1_000_000n, "candidate"),
    /not approved or enabled/,
  );
});

test("allocation totals reject overflow and expose exact drift", () => {
  const result = calculateAllocationAndDrift({
    btc: 4_000_000n,
    eth: 3_000_000n,
    sol: 3_000_000n,
  });
  assert.deepEqual(result.currentBps, {
    btc: 4_000n,
    eth: 3_000n,
    sol: 3_000n,
  });
  assert.deepEqual(result.driftBps, { btc: 0n, eth: 0n, sol: 0n });
  assert.throws(
    () =>
      calculateAllocationAndDrift({
        btc: C3_AMOUNTS.u64Max,
        eth: 1n,
        sol: 0n,
      }),
    /unsigned 64-bit range/,
  );
});

test("a self-fingerprinted caller snapshot cannot establish provenance", () => {
  const snapshot = fabricatedVaultSnapshot();
  assert.throws(
    () => validateReconciledVaultSnapshot(snapshot, snapshotPolicy, 1_000, 110),
    /sealed reconciliation provenance/,
  );
});

test("snapshot provenance cannot be recreated by serialization", () => {
  const recreated = structuredClone(fabricatedVaultSnapshot());
  assert.throws(
    () =>
      validateReconciledVaultSnapshot(recreated, snapshotPolicy, 1_000, 110),
    /sealed reconciliation provenance/,
  );
});

test("deposit quote resolves only a sealed repository snapshot ID", () => {
  assert.throws(
    () =>
      quoteDeposit({
        depositUsdcBaseUnits: 1_000_000n,
        snapshotId: fabricatedVaultSnapshot().snapshotId,
        nowUnix: 1_000,
        currentSlot: 110,
        slippageBps: 50,
        costInputs: {
          symmetryBountyUsdcBaseUnits: 0n,
          networkFeeUsdcBaseUnits: 0n,
          priorityFeeUsdcBaseUnits: 0n,
          accountRentUsdcBaseUnits: 0n,
          jupiterDexFeeUsdcBaseUnits: 0n,
          slippageUsdcBaseUnits: 0n,
          priceImpactUsdcBaseUnits: 0n,
          warningThresholdBps: 100,
        },
      }),
    /Trusted reconciled vault snapshot is unavailable/,
  );
});
