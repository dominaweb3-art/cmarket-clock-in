/** Explicit offline RPC fixtures; no signer, network or asset acquisition. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicKey,
  type VersionedTransactionResponse,
  VersionedTransaction,
} from "@solana/web3.js";
import { evaluationContextFixture } from "./evaluation-leg-context.test.ts";
import { evaluationTestRoute } from "../src/evaluation-route.ts";
import {
  evaluationExecuteInstruction,
  compileEvaluationServicePacket,
} from "../src/evaluation-settlement-client.ts";
import { EVAL_TOKEN } from "../src/evaluation-client.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
import { encodeBase58 } from "../src/solana.ts";
import {
  verifyEvaluationSwapEffects,
  type EvaluationSwapExpectation,
} from "../src/evaluation-swap-effects.ts";
async function fixture(direction: 1 | 2, leg: number) {
  const f = await evaluationContextFixture(
      direction,
      leg,
      BigInt(Math.floor(Date.now() / 1000)),
    ),
    r = evaluationTestRoute(f.c, f.verify(), new Uint8Array(32).fill(3));
  const packet = VersionedTransaction.deserialize(
    compileEvaluationServicePacket(
      [evaluationExecuteInstruction(f.c, r)],
      "keeper",
      PublicKey.default.toBase58(),
    ).packet,
  );
  const e: EvaluationSwapExpectation = {
    authority: String(f.c.authority),
    source: String(r.source),
    destination: String(r.destination),
    inputPool: String(r.keys[3]!.pubkey),
    outputPool: String(r.keys[4]!.pubkey),
    poolAuthority: String(r.keys[5]!.pubkey),
    inputMint: String(r.keys[6]!.pubkey),
    outputMint: String(r.keys[7]!.pubkey),
    input: String(r.input),
    output: String(r.output),
    instructionData: r.data.toString("hex"),
  };
  const index = (k: string) =>
    packet.message.staticAccountKeys.findIndex((p) => String(p) === k);
  const transfer = (n: bigint) => {
    const b = Buffer.alloc(10);
    b[0] = 12;
    b.writeBigUInt64LE(n, 1);
    b[9] = 6;
    return b;
  };
  const inner = (
    program: string,
    accounts: string[],
    data: Uint8Array,
    stackHeight: number,
  ) => ({
    programIdIndex: index(program),
    accounts: accounts.map(index),
    data: encodeBase58(data),
    stackHeight,
  });
  const amounts = [
    [e.source, e.inputMint, e.authority, 2_000_000n, -r.input],
    [e.inputPool, e.inputMint, e.poolAuthority, 100_000_000n, r.input],
    [e.outputPool, e.outputMint, e.poolAuthority, 100_000_000n, -r.output],
    [e.destination, e.outputMint, e.authority, 0n, r.output],
  ] as const;
  const token = (a: (typeof amounts)[number], after: boolean) => ({
    accountIndex: index(a[0]),
    mint: a[1],
    owner: a[2],
    programId: EVAL_TOKEN.toBase58(),
    uiTokenAmount: {
      amount: String(a[3] + (after ? a[4] : 0n)),
      decimals: 6,
      uiAmount: null,
      uiAmountString: "not_trusted",
    },
  });
  const preBalances = packet.message.staticAccountKeys.map(() => 10_000_000),
    postBalances = [...preBalances];
  postBalances[0]! -= 5000;
  const tx = {
    slot: 1000,
    blockTime: 1800000000,
    version: 0,
    transaction: { message: packet.message, signatures: ["2".repeat(88)] },
    meta: {
      err: null,
      fee: 5000,
      preBalances,
      postBalances,
      preTokenBalances: amounts.map((a) => token(a, false)),
      postTokenBalances: amounts.map((a) => token(a, true)),
      innerInstructions: [
        {
          index: 0,
          instructions: [
            inner(
              EVALUATION.router,
              r.keys.map((k) => String(k.pubkey)),
              r.data,
              2,
            ),
            inner(
              EVAL_TOKEN.toBase58(),
              [e.source, e.inputMint, e.inputPool, e.authority],
              transfer(r.input),
              3,
            ),
            inner(
              EVAL_TOKEN.toBase58(),
              [e.outputPool, e.outputMint, e.destination, e.poolAuthority],
              transfer(r.output),
              3,
            ),
          ],
        },
      ],
      logMessages: [],
    },
  } as unknown as VersionedTransactionResponse;
  return { e, tx };
}
test("all six exact test-router effect shapes pass offline, not as chain acceptance", async () => {
  for (const d of [1, 2] as const)
    for (let i = 0; i < 3; i++) {
      const f = await fixture(d, i);
      const result = verifyEvaluationSwapEffects(f.tx, f.e);
      assert.equal(result.output, f.e.output);
      assert.equal(result.evidenceHash.length, 32);
    }
});
test("hostile CPI, output ownership, debits, missing effects and SOL changes fail", async () => {
  const mutations: ((f: Awaited<ReturnType<typeof fixture>>) => void)[] = [
    (f) => {
      f.tx.meta!.innerInstructions = null;
    },
    (f) => {
      f.tx.meta!.innerInstructions![0]!.instructions.push(
        f.tx.meta!.innerInstructions![0]!.instructions[1]!,
      );
    },
    (f) => {
      f.tx.meta!.innerInstructions![0]!.instructions[1]!.accounts.reverse();
    },
    (f) => {
      f.tx.meta!.innerInstructions![0]!.instructions[2]!.data = encodeBase58(
        new Uint8Array([4]),
      );
    },
    (f) => {
      f.tx.meta!.postTokenBalances![0]!.uiTokenAmount.amount = "1";
    },
    (f) => {
      f.tx.meta!.postTokenBalances![3]!.owner = EVALUATION.keeper;
    },
    (f) => {
      f.tx.meta!.preTokenBalances!.pop();
      f.tx.meta!.postTokenBalances!.pop();
    },
    (f) => {
      delete f.tx.meta!.preTokenBalances![0]!.programId;
    },
    (f) => {
      f.tx.meta!.postBalances[1]! += 1;
    },
    (f) => {
      f.tx.meta!.fee = 10_001;
    },
    (f) => {
      f.e = { ...f.e, output: "1" };
    },
    (f) => {
      f.tx.meta!.preTokenBalances!.push({
        ...f.tx.meta!.preTokenBalances![0]!,
      });
    },
  ];
  for (const mutate of mutations) {
    const f = await fixture(1, 0);
    mutate(f);
    assert.throws(() => verifyEvaluationSwapEffects(f.tx, f.e), /EVAL_SWAP_/);
  }
});
