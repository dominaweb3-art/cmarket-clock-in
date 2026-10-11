import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVALUATION_USDC_MINT,
  balanceUnits,
  tokenBalance,
} from "../src/evaluation-balances.ts";
const wallet = "owner";
const mint = EVALUATION_USDC_MINT;
const account = (amount: string) => ({
  account: {
    owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    data: {
      parsed: {
        type: "account",
        info: {
          owner: wallet,
          mint,
          state: "initialized",
          tokenAmount: { amount, decimals: 6 },
        },
      },
    },
  },
});
test("read-only balances use exact integers and sum only accounts of one mint", () => {
  assert.equal(balanceUnits(990000n, 6), "0.99");
  assert.equal(balanceUnits(1234567890n, 9), "1.23456789");
  assert.equal(
    tokenBalance({ value: [account("255000000"), account("1")] }, wallet, mint),
    "255.000001",
  );
  assert.equal(tokenBalance({ value: [] }, wallet, mint), "0");
});
test("wrong wallet, mint, owner, malformed amount and missing evidence fail rather than show zero", () => {
  for (const amount of ["-1", "1.2", "18446744073709551616", "abc"])
    assert.throws(() =>
      tokenBalance({ value: [account(amount)] }, wallet, mint),
    );
  assert.throws(() => tokenBalance({ value: [account("1")] }, "other", mint));
  assert.throws(() =>
    tokenBalance(
      { value: [account("1")] },
      wallet,
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    ),
  );
  assert.throws(() => tokenBalance({}, wallet, mint));
});
