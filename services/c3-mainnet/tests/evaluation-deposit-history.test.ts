import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluationDepositHistory } from "../src/evaluation-state.ts";

test("finalized historical issuance is retained after the current balance is burned", () => {
  assert.deepEqual(
    evaluationDepositHistory(
      { deposited: "1000000", shares_issued: "1000000" },
      1000000n,
    ),
    { deposited: 1000000n, sharesIssued: 1000000n },
  );
  assert.deepEqual(
    evaluationDepositHistory({ deposited: "1000000", shares_issued: "0" }, 0n),
    { deposited: 1000000n, sharesIssued: 0n },
  );
});
test("malformed, excessive or contradictory history cannot be displayed as a purchase result", () => {
  for (const deposited of [
    undefined,
    null,
    "-1",
    "1e6",
    "01000000",
    "1000001",
    "18446744073709551616",
  ])
    assert.throws(() =>
      evaluationDepositHistory(
        { deposited, shares_issued: "1000000" },
        1000000n,
      ),
    );
  for (const shares_issued of [undefined, "999999", "2000000", "-1"])
    assert.throws(() =>
      evaluationDepositHistory(
        { deposited: "1000000", shares_issued },
        1000000n,
      ),
    );
  assert.throws(() =>
    evaluationDepositHistory(
      { deposited: "1000000", shares_issued: "1000000" },
      0n,
    ),
  );
});
