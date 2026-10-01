import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStatus, readOnlyEndpoint } from "../src/backend.ts";
const wallet = "2".repeat(32);
const good = {
  version: "c3-read-only/v1",
  mainnetExecutionEnabled: false,
  wallet,
  evidenceScope: "LOCAL_SIMULATION",
  position: null,
  intents: [],
};
test("backend fails closed for forged positions, networks, wallet and enablement", () => {
  assert.equal(parseStatus(good, wallet).position, null);
  for (const patch of [
    { mainnetExecutionEnabled: true },
    { position: { shares: "100" } },
    { wallet: "3".repeat(32) },
    { evidenceScope: "MAINNET" },
    { intents: [{ id: "a", state: "active", confirmedLegs: 7 }] },
  ])
    assert.throws(() => parseStatus({ ...good, ...patch }, wallet));
});
test("only credential-free HTTPS or fixed loopback read-only endpoint", () => {
  assert.equal(
    readOnlyEndpoint("http://127.0.0.1:8787"),
    "http://127.0.0.1:8787",
  );
  for (const u of [
    "http://api.example.com",
    "https://user:pass@example.com",
    "https://example.com?key=secret",
    "http://127.0.0.1:8899",
    "https://example.com/arbitrary",
  ])
    assert.equal(readOnlyEndpoint(u), null);
});
