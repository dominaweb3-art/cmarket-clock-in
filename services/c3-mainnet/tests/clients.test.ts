import assert from "node:assert/strict";
import test from "node:test";

import {
  createJupiterReadOnlyClient,
  createPythReadOnlyClient,
  type FetchLike,
} from "../src/clients.ts";
import { C3_MAINNET_ASSET_REGISTRY } from "../src/registry.ts";

test("authenticated clients fail closed without isolated credentials or approved HTTPS hosts", () => {
  assert.throws(() =>
    createJupiterReadOnlyClient({
      endpoint: "https://api.jup.ag/swap/v2/build",
      apiKey: undefined,
    }),
  );
  assert.throws(() =>
    createPythReadOnlyClient({
      endpoint: "http://pyth.dourolabs.app/hermes/v2/updates/price/latest",
      apiKey: "not-a-real-secret",
    }),
  );
  assert.throws(() =>
    createJupiterReadOnlyClient({
      endpoint: "https://example.com/swap/v2/build",
      apiKey: "not-a-real-secret",
    }),
  );
});

test("authenticated read-only clients use bounded requests without exposing credentials in outputs", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ verified: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const credential = ["test", "only", "credential"].join("-");
  const jupiter = createJupiterReadOnlyClient({
    endpoint: "https://api.jup.ag/swap/v2/build",
    apiKey: credential,
    fetchImpl,
  });
  const pyth = createPythReadOnlyClient({
    endpoint: "https://pyth.dourolabs.app/hermes/v2/updates/price/latest",
    apiKey: credential,
    fetchImpl,
  });
  assert.deepEqual(await jupiter.requestUnsignedBuild({ amount: "1000000" }), {
    verified: true,
  });
  assert.deepEqual(
    await pyth.requestLatestPrices([
      C3_MAINNET_ASSET_REGISTRY.USDC.oracleFeedId,
    ]),
    { verified: true },
  );
  assert.equal(requests.length, 2);
  assert.doesNotMatch(
    JSON.stringify(await jupiter.requestQuote({ amount: "1" })),
    /credential/,
  );
});
