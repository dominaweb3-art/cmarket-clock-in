/** Synthetic finalized RPC evidence, never submitted. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { C3_MAINNET as c } from "../src/constants.ts";
import { encodeBase58, decodeBase58 } from "../src/solana.ts";
import {
  verifyFinalizedEffects,
  verifyJupiterSwapEvent,
} from "./open-reconcile.ts";
import type { StoredQuoteContext } from "./open-quote.ts";
import { fixture, addr } from "./open-reconcile.fixture.ts";
test("finalized v0 signature and exact closed token effects; missing evidence never confirms", () => {
  const f = fixture();
  assert.deepEqual(
    [
      verifyFinalizedEffects(f.tx, f.e).debit,
      verifyFinalizedEffects(f.tx, f.e).credit,
    ],
    ["400000", "476"],
  );
  f.tx.meta!.err = { InstructionError: [1, "Custom"] };
  assert.throws(() => verifyFinalizedEffects(f.tx, f.e), /FINALIZED_EVIDENCE/);
});
test("hostile token effects, ownership, unknown CPI, approvals, burns and closes fail closed", () => {
  for (const mode of [
    "extra-debit",
    "owner-missing",
    "mint-change",
    "input-extra",
    "output-low",
    "pool-missing",
    "extra-cpi",
    "approve",
    "burn",
    "close",
    "wrong-authority",
  ]) {
    const f = fixture();
    if (mode === "extra-debit") f.post[4]!.uiTokenAmount.amount = "99";
    if (mode === "owner-missing") delete (f.pre[0] as { owner?: string }).owner;
    if (mode === "mint-change") f.post[1]!.mint = c.portalEthMint;
    if (mode === "input-extra") f.post[0]!.uiTokenAmount.amount = "599999";
    if (mode === "output-low") f.post[1]!.uiTokenAmount.amount = "471";
    if (mode === "pool-missing") {
      f.pre.splice(2, 1);
      f.post.splice(2, 1);
    }
    if (mode === "extra-cpi")
      f.inner.push({
        programIdIndex: f.index(f.unrelated),
        accounts: [],
        data: encodeBase58(Buffer.from([1])),
        stackHeight: 3,
      });
    if (["approve", "burn", "close"].includes(mode))
      f.inner[2]!.data = encodeBase58(
        Buffer.from([
          { approve: 4, burn: 8, close: 9 }[
            mode as "approve" | "burn" | "close"
          ],
        ]),
      );
    if (mode === "wrong-authority")
      f.inner[2]!.accounts[2] = f.index(f.unrelated);
    assert.throws(
      () => verifyFinalizedEffects(f.tx, f.e),
      /C3_RECONCILE_/,
      mode,
    );
  }
});
test("outer message, signatures, expiry, unknown route bytes and aggregate transfers fail closed", () => {
  for (const mode of [
    "message",
    "signature",
    "expiry",
    "slot",
    "route",
    "transfer",
    "missing-inner",
    "reordered-inner",
    "additional-account",
    "sol-drain",
    "missing-event",
    "whirlpool-amount",
    "whirlpool-metas",
  ]) {
    const f = fixture();
    if (mode === "message")
      f.tx.transaction.message.compiledInstructions.reverse();
    if (mode === "signature")
      f.tx.transaction.signatures[0] = encodeBase58(Buffer.alloc(64));
    if (mode === "expiry") f.tx.blockTime = 1030;
    if (mode === "slot") f.tx.slot = 200;
    if (mode === "route") f.inner[0]!.data = encodeBase58(Buffer.from([1]));
    if (mode === "transfer") f.inner.splice(2, 1);
    if (mode === "missing-inner") f.tx.meta!.innerInstructions = [];
    if (mode === "missing-event") f.inner.pop();
    if (mode === "whirlpool-amount") {
      const d = Buffer.from(decodeBase58(f.inner[1]!.data));
      d.writeBigUInt64LE(399999n, 8);
      f.inner[1]!.data = encodeBase58(d);
    }
    if (mode === "whirlpool-metas") f.inner[1]!.accounts.reverse();
    if (mode === "reordered-inner") f.inner[0]!.accounts.reverse();
    if (mode === "additional-account")
      f.inner[0]!.accounts.push(f.index(f.unrelated));
    if (mode === "sol-drain")
      f.tx.meta!.postBalances[f.index(f.unrelated)]! += 1;
    assert.throws(
      () => verifyFinalizedEffects(f.tx, f.e),
      /C3_RECONCILE_/,
      mode,
    );
  }
});
test("current Jupiter V2 132-byte event from real cloned CPI and hostile events", () => {
  const data = Buffer.from(
    decodeBase58(
      "3drYVtAcBYiMtM5fDAD2VT79gAoNj334DsrKgm4gzCARvmKMnaLer2PAtpL3S12jYu5ctFpfLp9jGJ3PW3RTbbxKuaYkh63Kov7uhafyUXkDN3MQsNk2HYGdHKHxssvJKbavsZr2y2SytCPAdEG5RowJrFiwMrtzAFo1pdsPX3no9fsrE6BVr",
    ),
  );
  const e = {
    pool: "HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM",
    context: {
      inputMint: c.usdcMint,
      outputMint: c.cbBtcMint,
    } as StoredQuoteContext,
  };
  const accounts = ["D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"];
  assert.equal(data.length, 132);
  verifyJupiterSwapEvent(data, accounts, e, 400000n, 475n);
  for (const mode of [
    "count",
    "amount",
    "mint",
    "pool",
    "authority",
    "trailing",
  ]) {
    const bad = Buffer.from(data),
      metas = [...accounts];
    if (mode === "count") bad.writeUInt32LE(2, 16);
    if (mode === "amount") bad.writeBigUInt64LE(399999n, 52);
    if (mode === "mint") bad[20]! ^= 1;
    if (mode === "pool") bad[100]! ^= 1;
    if (mode === "authority") metas[0] = addr(27).toBase58();
    assert.throws(
      () =>
        verifyJupiterSwapEvent(
          mode === "trailing" ? Buffer.concat([bad, Buffer.alloc(1)]) : bad,
          metas,
          e,
          400000n,
          475n,
        ),
      /C3_RECONCILE_/,
    );
  }
});
