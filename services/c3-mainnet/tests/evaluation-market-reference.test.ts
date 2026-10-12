import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  checkedObservation,
  historicalClose,
  marketReference,
  referencePrice,
  representativeValue,
} from "../src/evaluation-market-reference.ts";
const prices = [100n, 100n, 100n] as const;
test("reference collector cannot enter authorization or settlement paths", () => {
  const root = new URL("../src/", import.meta.url);
  for (const name of readdirSync(root)) {
    if (
      name === "evaluation-owner-service.ts" ||
      name === "evaluation-market-reference.ts" ||
      !name.endsWith(".ts")
    )
      continue;
    assert.ok(
      !readFileSync(new URL(name, root), "utf8").includes(
        'from "./evaluation-market-reference.ts"',
      ),
      name,
    );
  }
  const owner = readFileSync(
    new URL("evaluation-owner-service.ts", root),
    "utf8",
  );
  assert.equal(owner.split("await marketReference(").length, 2);
  const position = owner.slice(
    owner.indexOf("async position("),
    owner.indexOf("async prepare("),
  );
  assert.ok(position.includes("await marketReference("));
  const source = readFileSync(
    new URL("evaluation-market-reference.ts", root),
    "utf8",
  );
  for (const forbidden of [
    "sendTransaction",
    "signTransaction",
    "signMessage",
    "mintTo",
    "transferChecked",
    "process.env",
    "@solana/web3.js",
  ])
    assert.ok(!source.includes(forbidden));
});
test("100 hypothetical dollars follow fixed 40/30/30 quantities, up and down", () => {
  assert.equal(
    representativeValue(100_000_000n, prices, prices).valueUnits,
    "100000000",
  );
  assert.equal(
    representativeValue(100_000_000n, prices, [110n, 100n, 100n]).valueUnits,
    "104000000",
  );
  assert.equal(
    representativeValue(100_000_000n, prices, [90n, 100n, 100n]).changeUnits,
    "-4000000",
  );
  assert.equal(
    representativeValue(200_000_000n, prices, [110n, 110n, 110n]).valueUnits,
    "220000000",
  );
  assert.equal(
    representativeValue(1_000_000_000_000n, prices, prices).valueUnits,
    "1000000000000",
  );
  for (const amount of [0n, 999999n, 1000000000001n])
    assert.throws(() => representativeValue(amount, prices, prices));
  for (const value of [
    null,
    "NaN",
    "1e3",
    "-1",
    "0",
    "1.000000001",
    "99999999999",
  ])
    assert.throws(() => referencePrice(value));
});
test("stale/future ticker and unavailable history fail closed; no future candle bias", () => {
  const now = Date.now();
  for (const time of [
    "bad",
    new Date(now - 120001).toISOString(),
    new Date(now + 5001).toISOString(),
  ])
    assert.throws(() => checkedObservation(time, now));
  assert.equal(
    historicalClose(
      [
        [60, 90, 110, 100, 101, 1],
        [120, 90, 120, 100, 119, 1],
      ],
      150,
    ).price,
    10100000000n,
  );
  assert.throws(() => historicalClose([[120, 90, 120, 100, 119, 1]], 150));
  assert.throws(() => historicalClose([[60, 90, 110, 100, 101, 0]], 150));
});
test("same verified basis survives restart; sold position freezes; network failure cannot block claim", async () => {
  const now = 1_800_000_000_000,
    entry = now / 1000 - 600,
    exit = now / 1000 - 300;
  const fake: typeof fetch = async (url) => {
    const u = new URL(String(url));
    const cutoff = Date.parse(u.searchParams.get("end") ?? "") / 1000;
    return Response.json(
      u.pathname.endsWith("/ticker")
        ? { price: "110", time: new Date(now).toISOString() }
        : [
            [
              Math.floor(cutoff / 60) * 60 - 60,
              90,
              120,
              100,
              cutoff === entry ? 100 : 110,
              1,
            ],
          ],
    );
  };
  const input = {
    deposited: 100_000_000n,
    sharesIssued: 100_000_000n,
    shares: 100_000_000n,
    depositTime: entry,
    saleTime: null,
    lifecycle: 2,
  };
  const first = await marketReference(input, fake, now);
  assert.equal(first.status, "available");
  assert.deepEqual(first, await marketReference(input, fake, now));
  if (first.status === "available") assert.equal(first.valueUnits, "110000000");
  const sold = await marketReference(
    { ...input, shares: 0n, saleTime: exit, lifecycle: 4 },
    fake,
    now,
  );
  if (sold.status !== "available") assert.fail("Expected historical reference");
  assert.equal(sold.currentPositionValueUnits, "0");
  assert.equal(sold.frozen, true);
  assert.equal(
    (
      await marketReference(
        input,
        async () => {
          throw Error("offline");
        },
        now,
      )
    ).status,
    "unavailable",
  );
  assert.equal(
    (await marketReference({ ...input, sharesIssued: 0n }, fake, now)).status,
    "unavailable",
  );
});
