import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { verifyWhirlpoolTick } from "./whirlpool-tick.ts";
test("clone tick layouts reject wrong pool, start, bitmap, tags and truncation", () => {
  const pool = new PublicKey("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
  const fixed = Buffer.alloc(9988);
  Buffer.from("4561bdbe6e0742bb", "hex").copy(fixed);
  pool.toBuffer().copy(fixed, 9956);
  const dynamic = Buffer.alloc(148);
  createHash("sha256")
    .update("account:DynamicTickArray")
    .digest()
    .subarray(0, 8)
    .copy(dynamic);
  pool.toBuffer().copy(dynamic, 12);
  for (const data of [fixed, dynamic]) {
    verifyWhirlpoolTick(data, pool, 0);
    assert.throws(() => verifyWhirlpoolTick(data, pool, 88));
    assert.throws(() =>
      verifyWhirlpoolTick(
        data,
        new PublicKey("11111111111111111111111111111111"),
        0,
      ),
    );
    assert.throws(() =>
      verifyWhirlpoolTick(data.subarray(0, data.length - 1), pool, 0),
    );
  }
  const invalid = Buffer.from(dynamic);
  invalid[59] = 255;
  assert.throws(() => verifyWhirlpoolTick(invalid, pool, 0));
  const tag = Buffer.from(dynamic);
  tag[60] = 2;
  assert.throws(() => verifyWhirlpoolTick(tag, pool, 0));
  const active = Buffer.alloc(260);
  dynamic.subarray(0, 60).copy(active);
  active[44] = 1;
  active[60] = 1;
  verifyWhirlpoolTick(active, pool, 0);
  active[44] = 0;
  assert.throws(() => verifyWhirlpoolTick(active, pool, 0));
});
