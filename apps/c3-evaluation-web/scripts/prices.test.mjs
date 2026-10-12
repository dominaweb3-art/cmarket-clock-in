import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPrices } from "../api/prices.mjs";
test("official-only read-only collector validates timestamps and fails without full data", async () => {
  const now = Date.now(),
    requests = [];
  const fake = async (url, options) => {
    requests.push(url);
    assert.ok(url.startsWith("https://api.exchange.coinbase.com/products/"));
    assert.equal(options.redirect, "error");
    assert.equal(options.method, undefined);
    return new Response(
      JSON.stringify(
        url.endsWith("ticker")
          ? { price: "123.45", time: new Date(now).toISOString() }
          : { open: "120.00" },
      ),
    );
  };
  const value = await collectPrices(fake, () => now);
  assert.equal(requests.length, 6);
  assert.equal(value.assets[0].priceUnits, "12345000000");
  assert.equal(value.authorizesMoney, false);
  await assert.rejects(
    collectPrices(
      async () =>
        new Response(
          JSON.stringify({
            price: "123",
            time: new Date(now - 120001).toISOString(),
            open: "120",
          }),
        ),
      () => now,
    ),
    /STALE/,
  );
  await assert.rejects(
    collectPrices(
      async () => new Response("{}", { status: 429 }),
      () => now,
    ),
    /MARKET_UNAVAILABLE/,
  );
});
