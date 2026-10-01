/** Real serialized v0/signature shape, synthetic RPC effects. Not chain execution. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { C3_MAINNET as c } from "../src/constants.ts";
import { encodeBase58, decodeBase58 } from "../src/solana.ts";
import {
  VAULT_AUTHORITY,
  VAULT_PROGRAM,
} from "./jupiter-vault-cpi-inspection.ts";
import {
  verifyFinalizedEffects,
  verifyJupiterSwapEvent,
  type ExecutionExpectation,
} from "./open-reconcile.ts";
import type { StoredQuoteContext } from "./open-quote.ts";
import { encodeQuoteSealV1, quoteIdForNonce } from "../src/quote-seal.ts";
const whirl = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
const addr = (i: number) => new PublicKey(Buffer.alloc(32, i));
function fixture() {
  const keeper = Keypair.generate(),
    source = addr(3),
    destination = addr(4),
    pool = addr(5),
    pi = addr(6),
    po = addr(7),
    unrelated = addr(8);
  const route = Buffer.from(
    "bb64facc31c4af14801a060000000000dc0100000000000064000000000001000000110110270001",
    "hex",
  );
  const all = [
    VAULT_AUTHORITY,
    source,
    destination,
    new PublicKey(c.usdcMint),
    new PublicKey(c.cbBtcMint),
    new PublicKey(c.tokenProgram),
    new PublicKey(c.tokenProgram),
    destination,
    new PublicKey("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"),
    new PublicKey(c.jupiterProgram),
    whirl,
    new PublicKey(c.tokenProgram),
    VAULT_AUTHORITY,
    pool,
    source,
    pi,
    destination,
    po,
    addr(30),
    addr(31),
    unrelated,
    addr(32),
  ];
  const fixed = [
    keeper.publicKey,
    addr(20),
    addr(21),
    addr(22),
    addr(23),
    addr(24),
    addr(25),
    VAULT_AUTHORITY,
    source,
    destination,
    new PublicKey(c.jupiterProgram),
    new PublicKey(c.tokenProgram),
  ];
  const execution = Buffer.alloc(16 + route.length + all.length);
  hash(Buffer.from("global:execute_swap_leg")).subarray(0, 8).copy(execution);
  execution.writeUInt32LE(route.length, 8);
  route.copy(execution, 12);
  execution.writeUInt32LE(all.length, 12 + route.length);
  const msg = new TransactionMessage({
    payerKey: keeper.publicKey,
    recentBlockhash: addr(9).toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
      new TransactionInstruction({
        programId: VAULT_PROGRAM,
        keys: [...fixed, ...all].map((pubkey) => ({
          pubkey,
          isSigner: pubkey.equals(keeper.publicKey),
          isWritable: ![VAULT_AUTHORITY, whirl].some((k) => k.equals(pubkey)),
        })),
        data: execution,
      }),
    ],
  }).compileToV0Message();
  const signed = new VersionedTransaction(msg);
  signed.sign([keeper]);
  const index = (k: PublicKey) =>
    msg.staticAccountKeys.findIndex((a) => a.equals(k));
  const bal = (k: PublicKey, mint: string, owner: string, n: string) => ({
    accountIndex: index(k),
    mint,
    owner,
    programId: c.tokenProgram,
    uiTokenAmount: {
      amount: n,
      decimals: mint === c.cbBtcMint ? 8 : 6,
      uiAmount: null,
      uiAmountString: n,
    },
  });
  const pre = [
    bal(source, c.usdcMint, VAULT_AUTHORITY.toBase58(), "1000000"),
    bal(destination, c.cbBtcMint, VAULT_AUTHORITY.toBase58(), "0"),
    bal(pi, c.usdcMint, pool.toBase58(), "10000000"),
    bal(po, c.cbBtcMint, pool.toBase58(), "100000"),
    bal(unrelated, c.portalEthMint, VAULT_AUTHORITY.toBase58(), "100"),
  ];
  const post = structuredClone(pre);
  post[0]!.uiTokenAmount.amount = "600000";
  post[1]!.uiTokenAmount.amount = "476";
  post[2]!.uiTokenAmount.amount = "10400000";
  post[3]!.uiTokenAmount.amount = "99524";
  const transfer = (
    src: PublicKey,
    dst: PublicKey,
    auth: PublicKey,
    n: bigint,
  ) => {
    const b = Buffer.alloc(9);
    b[0] = 3;
    b.writeBigUInt64LE(n, 1);
    return {
      programIdIndex: index(new PublicKey(c.tokenProgram)),
      accounts: [src, dst, auth].map(index),
      data: encodeBase58(b),
      stackHeight: 4,
    };
  };
  const inner = [
    {
      programIdIndex: index(new PublicKey(c.jupiterProgram)),
      accounts: all.map(index),
      data: encodeBase58(route),
      stackHeight: 2,
    },
    {
      programIdIndex: index(whirl),
      accounts: all.slice(11).map(index),
      data: (() => {
        const d = Buffer.alloc(42);
        hash(Buffer.from("global:swap")).subarray(0, 8).copy(d);
        d.writeBigUInt64LE(400000n, 8);
        d[40] = 1;
        d[41] = 1;
        return encodeBase58(d);
      })(),
      stackHeight: 3,
    },
    transfer(source, pi, VAULT_AUTHORITY, 400000n),
    transfer(po, destination, pool, 476n),
    {
      programIdIndex: index(new PublicKey(c.jupiterProgram)),
      accounts: [
        index(new PublicKey("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf")),
      ],
      data: (() => {
        const d = Buffer.alloc(132);
        Buffer.from("e445a52e51cb9a1d982f4eebc0606e6a", "hex").copy(d);
        d.writeUInt32LE(1, 16);
        new PublicKey(c.usdcMint).toBuffer().copy(d, 20);
        d.writeBigUInt64LE(400000n, 52);
        new PublicKey(c.cbBtcMint).toBuffer().copy(d, 60);
        d.writeBigUInt64LE(476n, 92);
        whirl.toBuffer().copy(d, 100);
        return encodeBase58(d);
      })(),
      stackHeight: 3,
    },
  ];
  const tx = {
    slot: 101,
    blockTime: 1001,
    version: 0,
    transaction: {
      message: msg,
      signatures: [encodeBase58(signed.signatures[0]!)],
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: msg.staticAccountKeys.map(() => 10000000),
      postBalances: msg.staticAccountKeys.map(() => 10000000),
      preTokenBalances: pre,
      postTokenBalances: post,
      innerInstructions: [{ index: 1, instructions: inner }],
      loadedAddresses: { writable: [], readonly: [] },
      logMessages: [],
    },
  } as VersionedTransactionResponse;
  tx.meta!.postBalances[0] = tx.meta!.preBalances[0]! - 5000;
  // Use the canonical codec, NOT hand-written fixture offsets that could agree
  // with the verifier while both differ from the actual 300-byte chain codec.
  const nonce = hash(Buffer.from("test nonce"));
  const seal = encodeQuoteSealV1({
    contextHash: hash(Buffer.from("context")),
    quoteId: quoteIdForNonce(nonce),
    nonce,
    inputAmount: 400000n,
    quotedOutput: 476n,
    slippageBps: 100,
    minimumOutput: 472n,
    routeHash: hash(Buffer.from("route")),
    instructionHash: hash(
      Buffer.concat([Buffer.from("c3-router-data-v1"), route]),
    ),
    accountMetasHash: hash(Buffer.from("metas")),
    altCount: 0,
    altContentsHash: Buffer.alloc(32),
    builderTimestamp: 1000n,
    builderSlot: 100n,
    expiresAt: 1030n,
    expiresSlot: 200n,
  });
  const e: ExecutionExpectation = {
    signature: tx.transaction.signatures[0]!,
    messageHash: hash(msg.serialize()).toString("hex"),
    seal,
    context: {
      keeper: keeper.publicKey.toBase58(),
      inputMint: c.usdcMint,
      outputMint: c.cbBtcMint,
      source: source.toBase58(),
      destination: destination.toBase58(),
      inputAmount: "400000",
    } as StoredQuoteContext,
    pool: pool.toBase58(),
    poolInput: pi.toBase58(),
    poolOutput: po.toBase58(),
  };
  return {
    tx,
    e,
    inner,
    post,
    pre,
    route,
    index,
    source,
    destination,
    pi,
    po,
    unrelated,
  };
}
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
