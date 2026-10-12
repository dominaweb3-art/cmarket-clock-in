import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkedLivePrices,
  liveReferencePosition,
  priceChange24h,
} from "../src/evaluation-live-prices.ts";
const now = Date.now();
const live = {
  source: "Coinbase Exchange",
  informationalOnly: true,
  authorizesMoney: false,
  pricingScale: "100000000",
  observedAt: new Date(now).toISOString(),
  dayBasis: "exchange_reported_24h_open",
  assets: ["BTC-USD", "ETH-USD", "SOL-USD"].map((product) => ({
    product,
    priceUnits: "11000000000",
    open24hUnits: "10000000000",
    publishedAt: new Date(now).toISOString(),
  })),
};
test("real-market display rejects stale, substituted and malformed prices", () => {
  assert.equal(checkedLivePrices(live, now).assets.length, 3);
  for (const bad of [
    { ...live, authorizesMoney: true },
    { ...live, observedAt: new Date(now - 120001).toISOString() },
    { ...live, assets: [...live.assets].reverse() },
    { ...live, assets: live.assets.map((a) => ({ ...a, priceUnits: "-1" })) },
  ])
    assert.throws(() => checkedLivePrices(bad, now));
  assert.deepEqual(priceChange24h("110", "100"), {
    direction: "up",
    percent: "+10.00%",
  });
  assert.deepEqual(priceChange24h("90", "100"), {
    direction: "down",
    percent: "−10.00%",
  });
});
test("live prices update only informational active basket, never pending/closed/sale proceeds", () => {
  const p = {
    lifecycle: 2,
    deposited: "100000000",
    shares: "100000000",
    marketReference: {
      status: "available",
      assets: live.assets.map((a) => ({
        ...a,
        basisPriceUnits: "10000000000",
      })),
    },
  };
  const result = liveReferencePosition(p, checkedLivePrices(live, now))!;
  assert.equal(
    (result.marketReference as Record<string, unknown>).valueUnits,
    "110000000",
  );
  assert.equal(result.shares, p.shares);
  for (const lifecycle of [1, 3, 4]) {
    const frozen = { ...p, lifecycle };
    assert.equal(
      liveReferencePosition(frozen, checkedLivePrices(live, now)),
      frozen,
    );
  }
});
