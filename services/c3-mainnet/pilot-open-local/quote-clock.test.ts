import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitQuoteClock } from "./quote-clock.ts";
test("bounded quote clock waits without rewriting metadata or extending expiry", async () => {
  const timestamp = Date.now() + 15;
  await awaitQuoteClock(timestamp, 30000);
  assert.ok(Date.now() >= timestamp);
  assert.ok(Date.now() < timestamp + 30000);
  await assert.rejects(
    () => awaitQuoteClock(Date.now() + 6000, 30000),
    /UNUSABLE/,
  );
  await assert.rejects(
    () => awaitQuoteClock(Date.now() - 30001, 30000),
    /UNUSABLE/,
  );
  for (const value of [NaN, Infinity, 0, 1.5])
    await assert.rejects(() => awaitQuoteClock(value, 30000), /INVALID/);
  await assert.rejects(() => awaitQuoteClock(Date.now(), 30001), /INVALID/);
});
test("a delayed timer cannot bypass the monotonic deadline", async (t) => {
  const wall = [10000, 10000, 10000, 10000, 10020];
  t.mock.method(Date, "now", () => wall.shift() ?? 10020);
  const monotonic = [0, 0, 6000];
  t.mock.method(performance, "now", () => monotonic.shift() ?? 6000);
  await assert.rejects(() => awaitQuoteClock(10015, 30000), /UNUSABLE/);
});
test("a regressing wall clock cannot wait beyond the monotonic deadline", async (t) => {
  const wall = [10000, 9990, 9990, 9990];
  t.mock.method(Date, "now", () => wall.shift() ?? 9990);
  const monotonic = [0, 0, 5100];
  t.mock.method(performance, "now", () => monotonic.shift() ?? 5100);
  await assert.rejects(() => awaitQuoteClock(10015, 30000), /UNUSABLE/);
});
test("a quote that expires while waiting fails rather than extending expiry", async (t) => {
  const wall = [10000, 10000, 10000, 10000, 40015];
  t.mock.method(Date, "now", () => wall.shift() ?? 40015);
  const monotonic = [0, 0, 20];
  t.mock.method(performance, "now", () => monotonic.shift() ?? 20);
  await assert.rejects(() => awaitQuoteClock(10015, 30000), /UNUSABLE/);
});
