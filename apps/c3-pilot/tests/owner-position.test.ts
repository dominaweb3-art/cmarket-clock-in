import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnerPosition } from "../src/owner-position.ts";
const position = {
  wallet: "owner",
  shareMint: "mint",
  shareUnits: "1000000",
  shareDecimals: 6,
  slot: 200,
  scope: "MAINNET_INDEPENDENT_RPC",
  nav: null,
};
test("restricted position never invents par payout; finalized claim/returned states are bounded and exclusive", () => {
  const restricted = {
    status: "RECONCILED_SINGLE_POSITION",
    policyVersion: "c3-single-position-realized/v1",
    contextSlot: 210,
    shareUnits: "1000000",
    ownershipBps: 10000,
    claimableUsdcBaseUnits: "985432",
    returnedUsdcBaseUnits: null,
    monetaryNav: null,
    valuation: "INFORMATIONAL_ONLY",
  };
  const r = {
    ...position,
    shareUnits: "1000000",
    restrictedPosition: restricted,
  };
  assert.equal(
    parseOwnerPosition(r, "owner", "mint").restrictedPosition
      ?.claimableUsdcBaseUnits,
    "985432",
  );
  for (const bad of [
    { status: "signed" },
    { monetaryNav: "1000000" },
    { valuation: "VERIFIED_NAV" },
    { ownershipBps: 5000 },
    { shareUnits: "999999" },
    { contextSlot: 199 },
    { claimableUsdcBaseUnits: "-1" },
    { returnedUsdcBaseUnits: "985432" },
    { policyVersion: "unknown" },
    { claimableUsdcBaseUnits: (1n << 64n).toString() },
    { price: "1" },
  ])
    assert.throws(() =>
      parseOwnerPosition(
        { ...r, restrictedPosition: { ...restricted, ...bad } },
        "owner",
        "mint",
      ),
    );
  assert.equal(
    parseOwnerPosition(
      {
        ...position,
        shareUnits: "0",
        restrictedPosition: {
          ...restricted,
          shareUnits: "0",
          ownershipBps: 0,
          claimableUsdcBaseUnits: null,
          returnedUsdcBaseUnits: "985432",
        },
      },
      "owner",
      "mint",
    ).restrictedPosition?.returnedUsdcBaseUnits,
    "985432",
  );
});
test("position keeps missing NAV unavailable and accepts only bounded server valuation", () => {
  assert.equal(parseOwnerPosition(position, "owner", "mint").nav, null);
  const nav = {
    status: "VERIFIED",
    contextSlot: 210,
    priceContextSlot: 205,
    netUsdE12: "987654321000",
    sharePriceUsdE12: "987654321000",
  };
  assert.equal(
    parseOwnerPosition({ ...position, nav }, "owner", "mint").nav?.netUsdE12,
    nav.netUsdE12,
  );
  for (const bad of [
    { ...nav, status: "ARITHMETIC_ONLY_NOT_VERIFIED" },
    { ...nav, contextSlot: 199 },
    { ...nav, priceContextSlot: 211 },
    { ...nav, netUsdE12: "1.00" },
    { ...nav, netUsdE12: (1n << 128n).toString() },
    { ...nav, sharePriceUsdE12: "-1" },
    { ...nav, approved: true },
  ])
    assert.throws(() =>
      parseOwnerPosition({ ...position, nav: bad }, "owner", "mint"),
    );
  assert.throws(() =>
    parseOwnerPosition(
      { ...position, scope: "LOCAL_CLONE", nav },
      "owner",
      "mint",
      "LOCAL_CLONE",
    ),
  );
  assert.throws(() =>
    parseOwnerPosition({ ...position, nav: undefined }, "owner", "mint"),
  );
});
