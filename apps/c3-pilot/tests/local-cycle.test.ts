import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLocalCycle,
  readLocalCycle,
  startLocalCycle,
} from "../src/local-cycle.ts";
const good = {
  version: "c3-clone-cycle/v1",
  scope: "LOCAL_CLONED_JUPITER",
  mainnetExecutionEnabled: false,
  userPosition: null,
  runId: "12345678-1234-1234-1234-123456789abc",
  token: "a".repeat(64),
  state: "ready",
  stage: "warm-clone",
  confirmedLegs: 0,
  sharesIssued: "0",
  sharesBurned: "0",
  usdcReturned: "0",
};
test("clone result cannot be confused with user position or Mainnet success", () => {
  assert.equal(parseLocalCycle(good).mainnetExecutionEnabled, false);
  for (const patch of [
    { mainnetExecutionEnabled: true },
    { scope: "MAINNET" },
    { userPosition: {} },
    { state: "passed" },
    { confirmedLegs: 7 },
    { sharesIssued: "-1" },
    { token: "bad" },
  ])
    assert.throws(() => parseLocalCycle({ ...good, ...patch }));
  assert.equal(
    parseLocalCycle({
      ...good,
      state: "passed",
      confirmedLegs: 6,
      sharesIssued: "1000000",
      sharesBurned: "1000000",
      usdcReturned: "998530",
    }).state,
    "passed",
  );
});
test("local control cannot target remote service or repeat non-ready run", async () => {
  await assert.rejects(
    readLocalCycle("https://example.com", new AbortController().signal),
  );
  await assert.rejects(
    startLocalCycle(
      "https://example.com",
      parseLocalCycle(good),
      new AbortController().signal,
    ),
  );
  await assert.rejects(
    startLocalCycle(
      "http://127.0.0.1:8787",
      parseLocalCycle({ ...good, state: "running" }),
      new AbortController().signal,
    ),
  );
});
