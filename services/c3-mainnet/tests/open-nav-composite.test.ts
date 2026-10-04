import { test } from "node:test";
import assert from "node:assert/strict";
import { compositeFixture } from "./support/composite-nav.ts";
import { evaluateIsolatedCompositePoint } from "../src/open-nav-composite.ts";
import {
  evaluateVerifiedOpenNav,
  type VerifiedOpenNavPoint,
} from "../src/open-nav-collector.ts";
test("market-specific bounds without fabricated oracle confidence; branded isolated only", async () => {
  const f = compositeFixture(),
    p = await f.make().collect(),
    r = evaluateIsolatedCompositePoint(p);
  assert.equal(r.status, "COMPOSITE_CANDIDATE_NOT_PRODUCTION");
  assert.equal(r.pricesUsdE12.USDC, "980000000000");
  assert.equal(r.economicOracleOperators, 0);
  assert.equal(
    evaluateIsolatedCompositePoint(JSON.parse(JSON.stringify(p))).status,
    "UNAVAILABLE",
  );
  assert.equal(
    evaluateVerifiedOpenNav(p as unknown as VerifiedOpenNavPoint).status,
    "UNAVAILABLE",
  );
  f.sources[0]!.USDC = { ...f.sources[0]!.USDC, priceUsdE12: "1000000000000" };
  assert.deepEqual(
    evaluateIsolatedCompositePoint(p),
    r,
    "collection copies before later caller changes",
  );
  f.times.wall += 61;
  f.times.mono += 61000;
  assert.equal(evaluateIsolatedCompositePoint(p).status, "UNAVAILABLE");
});
test("shared dependencies across markets/anchors are not economic independence", async () => {
  for (const field of ["upstreamIds", "poolIds"] as const) {
    const f = compositeFixture();
    f.sources[1]!.PortalETH = {
      ...f.sources[1]!.PortalETH,
      [field]: f.sources[0]!.USDC[field],
    };
    assert.throws(() => f.make(), /SHARED_UPSTREAM_OR_POOL/);
  }
});
test("malformed, absent, stale and contradictory evidence fails admission", async () => {
  for (const defect of [
    "mint",
    "future",
    "old-trade",
    "short-window",
    "gap",
    "twap",
    "depth",
    "cost",
    "liquidity",
    "divergence",
    "extra",
    "hash",
    "slot",
    "missing",
  ]) {
    const f = compositeFixture(),
      o = f.sources[0]!.PortalETH;
    assert.equal(o.kind, "market");
    if (o.kind !== "market") continue;
    const bad: Record<string, unknown> = { ...o };
    if (defect === "mint") bad.mint = f.sources[0]!.WSOL.mint;
    if (defect === "future") bad.observedAtUnix = f.times.wall + 1;
    if (defect === "old-trade") bad.lastTradeAtUnix = f.times.wall - 61;
    if (defect === "short-window") bad.windowStartUnix = f.times.wall - 299;
    if (defect === "gap")
      bad.samples = [...o.samples].filter((_, j) => j !== 1);
    if (defect === "twap") bad.priceUsdE12 = "2000000000001";
    if (defect === "depth") bad.depthWithin100BpsUsdE12 = "99999999999999";
    if (defect === "cost") bad.manipulationCostUsdE12 = "1";
    if (defect === "liquidity") bad.liquidityUsdE12 = "1";
    if (defect === "divergence") {
      bad.priceUsdE12 = "2030000000000";
      bad.samples = o.samples.map((s) => ({
        ...s,
        priceUsdE12: bad.priceUsdE12,
      }));
    }
    if (defect === "extra") bad.confidenceUsdE12 = "0";
    if (defect === "hash") bad.evidenceHash = "0".repeat(64);
    if (defect === "slot") bad.contextSlot = 300;
    if (defect === "missing") delete bad.poolIds;
    f.sources[0]!.PortalETH = bad as unknown as typeof o;
    await assert.rejects(
      async () => f.make().collect(),
      /C3_COMPOSITE_|canonical/i,
      defect,
    );
  }
});
test("oracle confidence retains its own semantics; it is not replaced by market depth", async () => {
  const f = compositeFixture(),
    m = f.sources[0]!.PortalETH;
  const {
    asset,
    mint,
    sourceId,
    operatorId,
    upstreamIds,
    priceUsdE12,
    evidenceHash,
    contextSlot,
  } = m;
  f.sources[0]!.PortalETH = {
    asset,
    mint,
    sourceId,
    operatorId,
    upstreamIds,
    poolIds: [],
    priceUsdE12,
    evidenceHash,
    contextSlot,
    kind: "oracle",
    publishedAtUnix: f.times.wall,
    confidenceUsdE12: "40000000000",
  };
  assert.equal(
    evaluateIsolatedCompositePoint(await f.make().collect()).status,
    "COMPOSITE_CANDIDATE_NOT_PRODUCTION",
  );
  f.sources[0]!.PortalETH = {
    ...f.sources[0]!.PortalETH,
    confidenceUsdE12: "40000000001",
  } as (typeof f.sources)[0]["PortalETH"];
  await assert.rejects(() => f.make().collect(), /ORACLE_CONFIDENCE/);
});
test("clock rollback and source mutation during collection cannot extend validity", async () => {
  const f = compositeFixture(),
    p = await f.make().collect();
  f.times.wall--;
  assert.equal(evaluateIsolatedCompositePoint(p).status, "UNAVAILABLE");
});
test("untrusted accessors never execute, incomplete proofs and excessive collection delay reject", async () => {
  const f = compositeFixture();
  let reads = 0;
  Object.defineProperty(f.sources[0]!.PortalETH, "priceUsdE12", {
    enumerable: true,
    get() {
      reads++;
      return "2000000000000";
    },
  });
  await assert.rejects(() => f.make().collect(), /SHAPE/);
  assert.equal(reads, 0);
  const delayed = compositeFixture();
  const collector = delayed.make();
  delayed.setRead(() => {
    delayed.times.mono = 9000;
  });
  // Clock mismatch is independently enforced even when an adapter completed.
  await assert.rejects(() => collector.collect(), /CLOCK|TIMEOUT/);
});
test("array method/prototype substitution cannot rewrite samples during snapshot", async () => {
  for (const mode of ["own-method", "prototype"]) {
    const f = compositeFixture(),
      o = f.sources[0]!.PortalETH;
    if (o.kind !== "market") throw Error("fixture");
    let calls = 0;
    const malicious = () => {
      calls++;
      return Array.from({ length: 6 }, (_, j) => ({
        timeUnix: f.times.wall - 300 + j * 60,
        priceUsdE12: o.priceUsdE12,
      }));
    };
    if (mode === "own-method")
      Object.defineProperty(o.samples, "map", { value: malicious });
    else Object.setPrototypeOf(o.samples, { map: malicious });
    await assert.rejects(() => f.make().collect(), /SHAPE/);
    assert.equal(calls, 0);
  }
});
test("source kind is pinned before awaits and cannot downgrade market evidence", async () => {
  const f = compositeFixture(),
    collector = f.make();
  f.setRead(() => {
    const {
      asset,
      mint,
      sourceId,
      operatorId,
      upstreamIds,
      poolIds,
      priceUsdE12,
      evidenceHash,
      contextSlot,
    } = f.sources[0]!.PortalETH;
    f.sources[0]!.PortalETH = {
      asset,
      mint,
      sourceId,
      operatorId,
      upstreamIds,
      poolIds,
      priceUsdE12,
      evidenceHash,
      contextSlot,
      kind: "oracle",
      publishedAtUnix: f.times.wall,
      confidenceUsdE12: "0",
    };
  });
  await assert.rejects(() => collector.collect(), /PIN_SUBSTITUTION/);
});
test("monotonic elapsed time expires an already-old source despite tolerated wall-clock stall", async () => {
  const f = compositeFixture(),
    o = f.sources[0]!.USDC;
  const {
    asset,
    mint,
    sourceId,
    operatorId,
    upstreamIds,
    poolIds,
    priceUsdE12,
    evidenceHash,
    contextSlot,
  } = o;
  f.sources[0]!.USDC = {
    asset,
    mint,
    sourceId,
    operatorId,
    upstreamIds,
    poolIds,
    priceUsdE12,
    evidenceHash,
    contextSlot,
    kind: "oracle",
    publishedAtUnix: f.times.wall - 59,
    confidenceUsdE12: "1",
  };
  const p = await f.make().collect();
  f.times.mono += 2000;
  assert.equal(evaluateIsolatedCompositePoint(p).status, "UNAVAILABLE");
});
