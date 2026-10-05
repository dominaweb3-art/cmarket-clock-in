import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESTRICTED_PILOT_CANDIDATE,
  APPROVED_RESTRICTED_PILOT_POLICY,
  restrictedPositionMath,
} from "../src/open-restricted-pilot.ts";
import { compileTrustedOwnerPacket } from "../src/open-owner-compiler.ts";
import { compilerFixture } from "./open-owner-compiler.test.ts";

const inventory = (claim = "0") => ({
  USDC: {
    custodyBaseUnits: (BigInt(claim) + 1n).toString(),
    accountedBaseUnits: claim,
    excludedReserveBaseUnits: "0",
  },
  cbBTC: {
    custodyBaseUnits: "2",
    accountedBaseUnits: "1",
    excludedReserveBaseUnits: "0",
  },
  PortalETH: {
    custodyBaseUnits: "2",
    accountedBaseUnits: "1",
    excludedReserveBaseUnits: "0",
  },
  WSOL: {
    custodyBaseUnits: "2",
    accountedBaseUnits: "1",
    excludedReserveBaseUnits: "0",
  },
});
test("one lifetime position: fixed units not USD shares; no production policy or fees", () => {
  assert.equal(APPROVED_RESTRICTED_PILOT_POLICY, null);
  assert.equal(Object.isFrozen(RESTRICTED_PILOT_CANDIDATE), true);
  const r = restrictedPositionMath({
    inventory: inventory(),
    supply: "1000000",
    owned: true,
    closed: false,
    realizedClaim: null,
  });
  assert.equal(r.ownershipBps, 10000);
  assert.equal(r.monetaryNav, null);
  assert.equal(r.platformFeeBaseUnits, "0");
  assert.deepEqual(r.donations, {
    USDC: "1",
    cbBTC: "1",
    PortalETH: "1",
    WSOL: "1",
  });
});
test("actual realized payout may be below or above one USDC, no par guarantee or donation extraction", () => {
  for (const amount of ["1", "990000", "1010000"]) {
    const i = inventory(amount);
    for (const a of ["cbBTC", "PortalETH", "WSOL"] as const)
      i[a] = {
        custodyBaseUnits: "1",
        accountedBaseUnits: "0",
        excludedReserveBaseUnits: "0",
      };
    const r = restrictedPositionMath({
      inventory: i,
      supply: "1000000",
      owned: true,
      closed: false,
      realizedClaim: amount,
    });
    assert.equal(r.claimableUsdcBaseUnits, amount);
    assert.throws(
      () =>
        restrictedPositionMath({
          inventory: i,
          supply: "1000000",
          owned: true,
          closed: false,
          realizedClaim: (BigInt(amount) + 1n).toString(),
        }),
      /REALIZED_CLAIM/,
    );
  }
});
test("invalid quantities, ownership, reserves, unsold assets and missing final receipt fail", () => {
  const base = {
    inventory: inventory(),
    supply: "1000000",
    owned: true,
    closed: false,
    realizedClaim: null,
  };
  for (const bad of [
    { supply: "999999" },
    { supply: "-1" },
    { supply: (1n << 64n).toString() },
    { closed: true },
    { owned: false },
    { realizedClaim: "1" },
  ])
    assert.throws(
      () => restrictedPositionMath({ ...base, ...bad }),
      /C3_RESTRICTED_/,
    );
  for (const raw of ["-1", "1.0", (1n << 64n).toString(), null]) {
    const i = inventory();
    i.USDC.custodyBaseUnits = raw as string;
    assert.throws(
      () => restrictedPositionMath({ ...base, inventory: i }),
      /INTEGER/,
    );
  }
  const i = inventory();
  i.cbBTC.excludedReserveBaseUnits = "1";
  assert.throws(
    () => restrictedPositionMath({ ...base, inventory: i }),
    /RESERVES/,
  );
});
test("backend compiler cannot renew a lifetime deposit counter by presenting empty intent/lifecycle", () => {
  const f = compilerFixture();
  f.cfg.writeBigUInt64LE(1n, 456);
  f.accounts[f.policy.vault] = f.raw(f.cfg, f.policy.program);
  assert.throws(
    () => compileTrustedOwnerPacket(f.policy, f.context, f.idl, "deposit"),
    /DEPOSIT_LIMIT/,
  );
});
