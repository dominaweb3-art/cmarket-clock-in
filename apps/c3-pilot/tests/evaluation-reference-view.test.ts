import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  referenceDollars,
  referencePerformance,
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
test("performance is exact, signed and relative to the verified deposit", () => {
  assert.deepEqual(referencePerformance("24200", "10000000"), {
    direction: "up",
    percent: "+0.24%",
  });
  assert.deepEqual(referencePerformance("-15000000", "100000000"), {
    direction: "down",
    percent: "−15.00%",
  });
  assert.deepEqual(referencePerformance("0", "1000000"), {
    direction: "flat",
    percent: "0.00%",
  });
  assert.equal(referencePerformance("-1000000", "1000000").percent, "−100.00%");
  assert.equal(
    referencePerformance("250000000000", "1000000000000").percent,
    "+25.00%",
  );
  assert.equal(referencePerformance("1", "1000000000000").percent, "+<0.01%");
  assert.equal(referencePerformance("-1", "1000000000000").percent, "−<0.01%");
  for (const [change, deposited] of [
    ["1.2", "1000000"],
    ["1", "0"],
    ["1", "999999"],
    ["1", "1000000000001"],
    ["-1000001", "1000000"],
    ["1e6", "1000000"],
    ["9999999999999999999999999999999", "1000000"],
  ])
    assert.throws(() => referencePerformance(change!, deposited!));
});
test("read-only performance exposes purchase time and does not unfreeze a sale", () => {
  const now = Date.parse("2026-10-12T01:00:00Z");
  const p = {
    cluster: "solana:devnet",
    simulatedAssets: true,
    monetaryValue: false,
    deposited: "10000000",
    shares: "10000000",
    lifecycle: 3,
    marketReference: {
      status: "available",
      informationalOnly: true,
      authorizesMoney: false,
      simulatedExposure: true,
      source: "Coinbase Exchange",
      basisMethod: "last_closed_60_second_candle_before_verified_deposit",
      pricingScale: "100000000",
      valueUnits: "9800000",
      currentPositionValueUnits: "9800000",
      changeUnits: "-200000",
      frozen: true,
      observedAt: new Date(now).toISOString(),
      basisTime: "2026-10-11T22:00:00Z",
      assets: ["BTC-USD", "ETH-USD", "SOL-USD"].map((product, i) => ({
        product,
        weightBps: [4000, 3000, 3000][i],
        priceUnits: "100000000",
        basisPriceUnits: "100000000",
      })),
    },
  };
  const result = referenceView(p, now);
  assert.equal(result?.basisTime, p.marketReference.basisTime);
  assert.equal(result?.frozen, true);
  assert.equal(result?.performance.percent, "−2.00%");
  assert.equal(referenceView(p, now + 120001), null);
  assert.equal(
    referenceView(
      { ...p, marketReference: { ...p.marketReference, basisTime: "invalid" } },
      now,
    ),
    null,
  );
});
test("performance display is localized and does not introduce wallet actions", () => {
  const source = readFileSync(
    new URL("../src/EvaluationMarketReference.tsx", import.meta.url),
    "utf8",
  );
  for (const key of ["up", "down", "flat", "entry", "refresh"])
    assert.equal(
      (
        source
          .split("} satisfies")[0]!
          .match(new RegExp("\\b" + key + ":", "g")) ?? []
      ).length,
      4,
    );
  for (const forbidden of [
    "signEvaluation",
    "evaluationRequest",
    "transact(",
    "fetch(",
  ])
    assert.ok(!source.includes(forbidden));
  assert.match(source, /r\.performance\.direction === "down" && s\.loss/);
  assert.match(source, /r\.performance\.direction === "flat" && s\.flat/);
  assert.match(source, /t\[r\.performance\.direction\]/);
  assert.ok(
    source.indexOf("t.entry") <
      source.indexOf("USD {localizedUnits(r.value, language)}"),
  );
});
