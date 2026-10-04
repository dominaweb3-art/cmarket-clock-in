import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectJupiterMarketPrices,
  collectJupiterMarketEvidence,
} from "./jupiter-market-collector.ts";
import { C3_MAINNET } from "../../src/constants.ts";
import { C3_MAINNET_ASSET_REGISTRY as registry } from "../../src/registry.ts";
const response = () =>
  Object.fromEntries(
    Object.values(registry).map((r) => [
      r.mint,
      {
        usdPrice: 0.9999,
        decimals: r.decimals,
        blockId: 100,
        liquidity: 100000,
      },
    ]),
  );
test("exact mint/decimals, no assumed peg, undisclosed lineage never admissible", () => {
  const r = inspectJupiterMarketPrices(response());
  assert.equal(r.length, 4);
  for (const row of r) {
    assert.equal(row.eligibleForNav, false);
    if ("priceUsdE12" in row) {
      assert.equal(row.priceUsdE12, "999900000000");
      assert.equal(row.upstreamPoolIds, null);
      assert.equal(row.confidence, null);
    }
  }
});
test("missing market is unavailable; mint substitution, decimals and invalid values reject", () => {
  const r = response();
  delete r[registry.PortalETH.mint];
  assert.equal(
    inspectJupiterMarketPrices(r).find((x) => x.asset === "PortalETH")!.status,
    "UNAVAILABLE",
  );
  r.wrong = { usdPrice: 1, decimals: 8, blockId: 100, liquidity: 1 };
  assert.throws(() => inspectJupiterMarketPrices(r), /UNREQUESTED/);
  for (const value of [NaN, Infinity, -1, 0]) {
    const x = response();
    x[registry.USDC.mint]!.usdPrice = value;
    assert.throws(() => inspectJupiterMarketPrices(x), /BINDING/);
  }
  const x = response();
  x[registry.USDC.mint]!.decimals = 8;
  assert.throws(() => inspectJupiterMarketPrices(x), /BINDING/);
});
test("slow RPC timestamp collection cannot refresh a stale aggregate price", async (t) => {
  const published = 1800000000;
  let wall = published * 1000,
    calls = 0,
    jupiterCalls = 0;
  t.mock.method(Date, "now", () => wall);
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      const url = String(input);
      if (url.startsWith("https://api.jup.ag/price/v3?ids=")) {
        jupiterCalls++;
        return new Response(JSON.stringify(response()), { status: 200 });
      }
      assert.equal(url, "https://api.mainnet-beta.solana.com");
      const q = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      };
      let result: unknown;
      if (q.method === "getGenesisHash") result = C3_MAINNET.genesisHash;
      else if (q.method === "getSlot") result = 100;
      else {
        assert.equal(q.method, "getBlockTime");
        wall += 61000;
        result = published;
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: q.id, result }),
        { status: 200 },
      );
    },
  );
  const r = await collectJupiterMarketEvidence();
  assert.ok("evidence" in r);
  assert.equal(jupiterCalls, 1);
  assert.equal(calls, 4);
  for (const row of r.evidence) {
    assert.ok("observationFreshWithin60Seconds" in row);
    assert.equal(row.observationFreshWithin60Seconds, false);
    assert.equal(row.eligibleForNav, false);
  }
  assert.equal(r.decision, "BLOCKED");
});
