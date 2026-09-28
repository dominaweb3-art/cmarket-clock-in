import assert from "node:assert/strict";
import test from "node:test";
import { toBaseUnits } from "../src/index.ts";

test("exact amount parsing never accepts floating point or exponent inputs", () => {
  assert.equal(toBaseUnits("1"), 1_000_000n);
  assert.equal(toBaseUnits("1.000001"), 1_000_001n);
  for (const value of [
    "1e0",
    "01",
    "-1",
    "1.0000001",
    "NaN",
    "1,0",
    "",
    "0x1",
  ]) {
    assert.throws(() => toBaseUnits(value));
  }
  assert.throws(() => toBaseUnits(1 as unknown as string));
  assert.throws(() => toBaseUnits("18446744073710"));
});
