import assert from "node:assert/strict";
import { test } from "node:test";
import {
  referenceDollars,
  referenceView,
} from "../src/evaluation-reference-view.ts";
test("display-only reference rejects stale, wrong-cluster and contradictory values", () => {
  const now = Date.now();
  const r = {
    status: "available",
    informationalOnly: true,
    authorizesMoney: false,
    simulatedExposure: true,
    source: "Coinbase Exchange",
    basisMethod: "last_closed_60_second_candle_before_verified_deposit",
    pricingScale: "100000000",
    valueUnits: "104000000",
    currentPositionValueUnits: "104000000",
    changeUnits: "4000000",
    frozen: false,
    observedAt: new Date(now).toISOString(),
    basisTime: new Date(now - 600000).toISOString(),
    assets: ["BTC-USD", "ETH-USD", "SOL-USD"].map((product, i) => ({
      product,
      weightBps: [4000, 3000, 3000][i],
      priceUnits: "100000000",
      basisPriceUnits: "100000000",
    })),
  };
  const p = {
    cluster: "solana:devnet",
    simulatedAssets: true,
    monetaryValue: false,
    shares: "100000000",
    deposited: "100000000",
    lifecycle: 2,
    marketReference: r,
  };
  assert.ok(referenceView(p, now));
  for (const change of [
    { changeUnits: "0" },
    { currentPositionValueUnits: "0" },
    { authorizesMoney: true },
    { frozen: true },
    { observedAt: new Date(now - 120001).toISOString() },
  ])
    assert.equal(
      referenceView({ ...p, marketReference: { ...r, ...change } }, now),
      null,
    );
  assert.equal(referenceView({ ...p, cluster: "solana:mainnet" }, now), null);
  assert.equal(referenceView({ ...p, shares: "0" }, now), null);
  assert.equal(referenceDollars("104000000"), "104.0000");
  assert.equal(referenceDollars("-4000000"), "−4.0000");
});
