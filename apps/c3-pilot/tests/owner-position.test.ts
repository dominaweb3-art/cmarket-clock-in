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
