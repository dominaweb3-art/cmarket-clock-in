import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HERMES,
  REQUIRED,
  authenticatedGet,
  collectPythEvidence,
  selectProxyCandidates,
  selectRequiredMetadata,
  validateLatest,
} from "./pyth-evidence.ts";

const now = 1_800_000_000;
const catalog = REQUIRED.map(({ id, symbol }) => ({
  id,
  attributes: {
    symbol,
    description: `${symbol} fixture`,
    asset_type: "Crypto",
    quote_currency: "USD",
  },
}));
const feed = selectRequiredMetadata(catalog);
const payload = () => ({
  parsed: feed.map(({ id }) => ({
    id,
    price: {
      price: "100000000",
      conf: "1000",
      expo: -8,
      publish_time: now - 1,
    },
  })),
});
const endpoint = `${HERMES}/v2/updates/price/latest`;

test("metadata binds exact IDs, symbol and quote; missing proxy feeds remain unavailable", () => {
  assert.deepEqual(
    feed.map((item) => item.symbol),
    REQUIRED.map((item) => item.symbol),
  );
  assert.deepEqual(selectProxyCandidates(catalog, "cbBTC"), []);
  assert.deepEqual(selectProxyCandidates(catalog, "PortalETH"), []);
  const cbBtcCatalog = [
    ...catalog,
    {
      id: "2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97",
      attributes: {
        symbol: "Crypto.CBBTC/USD",
        description: "COINBASE WRAPPED BITCOIN / US DOLLAR",
        asset_type: "Crypto",
        quote_currency: "USD",
      },
    },
  ];
  assert.equal(selectProxyCandidates(cbBtcCatalog, "cbBTC").length, 1);
  assert.throws(
    () => selectRequiredMetadata(catalog.slice(1)),
    /required_feed_missing/,
  );
  assert.throws(
    () => selectRequiredMetadata([...catalog, catalog[0]]),
    /duplicate_feed_id/,
  );
  assert.throws(
    () =>
      selectRequiredMetadata([
        {
          ...catalog[0],
          attributes: { ...catalog[0]!.attributes, quote_currency: "EUR" },
        },
        ...catalog.slice(1),
      ]),
    /wrong_symbol_or_quote/,
  );
  assert.throws(
    () =>
      selectRequiredMetadata([
        { ...catalog[0], attributes: { symbol: "BTC/EUR" } },
        ...catalog.slice(1),
      ]),
    /wrong_symbol_or_quote/,
  );
});

test("latest observations enforce ID, age, confidence, price, exponent and duplicate checks", () => {
  const good = validateLatest(payload(), feed, now, endpoint);
  assert.equal(good.length, 4);
  assert.equal(good[0]?.confidenceBpsCeil, "1");
  assert.match(good[0]?.fingerprint ?? "", /^[a-f0-9]{64}$/);
  const bad = (change: (row: Record<string, unknown>) => void) => {
    const copy = structuredClone(payload()) as {
      parsed: Record<string, unknown>[];
    };
    change(copy.parsed[0]!);
    return () => validateLatest(copy, feed, now, endpoint);
  };
  const price = (
    row: Record<string, unknown>,
    change: Record<string, unknown>,
  ) => Object.assign(row.price as Record<string, unknown>, change);
  assert.throws(
    bad((row) => {
      row.id = "a".repeat(64);
    }),
    /wrong_feed_id/,
  );
  assert.throws(
    bad((row) => price(row, { publish_time: now - 61 })),
    /stale_publish_time/,
  );
  assert.throws(
    bad((row) => price(row, { publish_time: now + 1 })),
    /future_publish_time/,
  );
  assert.throws(
    bad((row) => price(row, { conf: "3000000" })),
    /excessive_confidence/,
  );
  assert.throws(
    bad((row) => price(row, { price: "-1" })),
    /malformed_price/,
  );
  assert.throws(
    bad((row) => price(row, { price: "0" })),
    /nonpositive_price/,
  );
  assert.throws(
    bad((row) => price(row, { expo: -19 })),
    /exponent_out_of_bounds/,
  );
  assert.throws(
    bad((row) => price(row, { expo: 1e20 })),
    /exponent_out_of_bounds/,
  );
  assert.throws(
    () =>
      validateLatest(
        {
          parsed: [
            payload().parsed[0],
            payload().parsed[0],
            ...payload().parsed.slice(2),
          ],
        },
        feed,
        now,
        endpoint,
      ),
    /duplicate_feed_id/,
  );
});

test("absent/empty key and 401, 403, 429, malformed JSON and timeout fail with sanitized output", async () => {
  const secret = "PRIVATE_KEY_FIXTURE_DO_NOT_LOG";
  await assert.rejects(authenticatedGet(undefined, endpoint), /missing_key/);
  await assert.rejects(authenticatedGet(" ", endpoint), /missing_key/);
  for (const status of [401, 403, 429]) {
    const fetcher: typeof fetch = async () => new Response(secret, { status });
    await assert.rejects(
      authenticatedGet(secret, endpoint, fetcher),
      (error: unknown) => {
        const message = String(error);
        assert.match(message, new RegExp(`HTTP ${status}`));
        assert.equal(message.includes(secret), false);
        return true;
      },
    );
  }
  const malformed: typeof fetch = async () =>
    new Response("not-json", { status: 200 });
  await assert.rejects(
    authenticatedGet(secret, endpoint, malformed),
    /malformed_json/,
  );
  const timeout: typeof fetch = async () => {
    throw new Error(secret);
  };
  await assert.rejects(
    authenticatedGet(secret, endpoint, timeout),
    (error: unknown) => {
      assert.equal(String(error).includes(secret), false);
      return true;
    },
  );
  assert.equal(
    JSON.stringify(validateLatest(payload(), feed, now, endpoint)).includes(
      secret,
    ),
    false,
  );
});

test("three sequential authenticated samples remain one operator and never imply production approval", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return Response.json(url.endsWith("price_feeds") ? catalog : payload());
  };
  const evidence = await collectPythEvidence(
    "test-only",
    fetcher,
    () => now,
    async () => undefined,
  );
  assert.equal(evidence.samples.length, 3);
  assert.equal(evidence.samples.flat().length, 12);
  assert.equal(evidence.sourceOperator, "Pyth");
  assert.equal(evidence.decision, "NO_GO");
  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(evidence).includes("test-only"), false);
});

test("a provider echo of the credential is never serialized as public evidence", async () => {
  const key = "LONG_TEST_CREDENTIAL_REFLECTION_FIXTURE";
  const reflected = structuredClone(catalog);
  reflected[0]!.attributes.description = key;
  const fetcher: typeof fetch = async (input) =>
    Response.json(
      String(input).endsWith("price_feeds") ? reflected : payload(),
    );
  await assert.rejects(
    collectPythEvidence(
      key,
      fetcher,
      () => now,
      async () => undefined,
    ),
    (error: unknown) => {
      assert.match(String(error), /secret_reflected_in_public_metadata/);
      assert.equal(String(error).includes(key), false);
      return true;
    },
  );
});
