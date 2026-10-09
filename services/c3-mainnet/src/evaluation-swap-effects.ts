/** Strict TEST-router economic evidence. This is not a Jupiter/real-price
 * verifier. Only the bound PDA -> test pool -> PDA transfer pair is accepted. */
import { createHash } from "node:crypto";
import type { VersionedTransactionResponse } from "@solana/web3.js";
import { EVAL_TOKEN } from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import { decodeBase58 } from "./solana.ts";
export type EvaluationSwapExpectation = Readonly<{
  authority: string;
  source: string;
  destination: string;
  inputPool: string;
  outputPool: string;
  poolAuthority: string;
  inputMint: string;
  outputMint: string;
  input: string;
  output: string;
  instructionData: string;
}>;
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_SWAP_" + code);
};
const uint = (s: string) => {
  check(/^(0|[1-9][0-9]{0,19})$/.test(s), "INTEGER");
  const n = BigInt(s);
  check(n < 1n << 64n, "INTEGER");
  return n;
};
export function verifyEvaluationSwapEffects(
  tx: VersionedTransactionResponse,
  e: EvaluationSwapExpectation,
) {
  const m = tx.meta,
    msg = tx.transaction.message;
  check(
    m &&
      m.err === null &&
      m.innerInstructions &&
      m.preTokenBalances &&
      m.postTokenBalances &&
      msg.version === 0 &&
      !msg.addressTableLookups.length,
    "MISSING_EVIDENCE",
  );
  const key = (i: number) => {
    const k = msg.staticAccountKeys[i];
    check(k, "ACCOUNT_INDEX");
    return k!.toBase58();
  };
  check(
    msg.header.numRequiredSignatures === 1 &&
      key(0) === EVALUATION.keeper &&
      msg.compiledInstructions.length === 1 &&
      key(msg.compiledInstructions[0]!.programIdIndex) === EVALUATION.program,
    "OUTER",
  );
  const transfer = (amount: bigint) => {
    const b = Buffer.alloc(10);
    b[0] = 12;
    b.writeBigUInt64LE(amount, 1);
    b[9] = 6;
    return b;
  };
  const input = uint(e.input),
    output = uint(e.output);
  check(input > 0n && output > 0n, "AMOUNT");
  const expected = [
    {
      program: EVALUATION.router,
      accounts: [
        e.authority,
        e.source,
        e.destination,
        e.inputPool,
        e.outputPool,
        e.poolAuthority,
        e.inputMint,
        e.outputMint,
        EVAL_TOKEN.toBase58(),
      ],
      data: Buffer.from(e.instructionData, "hex"),
      stack: 2,
    },
    {
      program: EVAL_TOKEN.toBase58(),
      accounts: [e.source, e.inputMint, e.inputPool, e.authority],
      data: transfer(input),
      stack: 3,
    },
    {
      program: EVAL_TOKEN.toBase58(),
      accounts: [e.outputPool, e.outputMint, e.destination, e.poolAuthority],
      data: transfer(output),
      stack: 3,
    },
  ];
  const groups = m!.innerInstructions!.filter((g) => g.instructions.length > 0);
  check(
    groups.length === 1 &&
      groups[0]!.index === 0 &&
      groups[0]!.instructions.length === 3,
    "INNER_COUNT",
  );
  expected.forEach((expected, i) => {
    const a = groups[0]!.instructions[i]!;
    check(
      key(a.programIdIndex) === expected.program &&
        a.accounts.length === expected.accounts.length &&
        a.accounts.every((j, n) => key(j) === expected.accounts[n]) &&
        Buffer.from(decodeBase58(a.data)).equals(expected.data) &&
        (a as { stackHeight?: number }).stackHeight === expected.stack,
      "HOSTILE_CPI",
    );
  });
  const changes = new Map([
    [e.source, { delta: -input, mint: e.inputMint, owner: e.authority }],
    [e.inputPool, { delta: input, mint: e.inputMint, owner: e.poolAuthority }],
    [
      e.outputPool,
      { delta: -output, mint: e.outputMint, owner: e.poolAuthority },
    ],
    [e.destination, { delta: output, mint: e.outputMint, owner: e.authority }],
  ]);
  check(changes.size === 4, "ACCOUNT_ALIAS");
  const pre = m!.preTokenBalances!,
    post = m!.postTokenBalances!;
  check(
    pre.length === post.length &&
      new Set(pre.map((b) => b.accountIndex)).size === pre.length &&
      new Set(post.map((b) => b.accountIndex)).size === post.length,
    "TOKEN_SET",
  );
  const observed = new Set<string>();
  for (const before of pre) {
    const after = post.find((b) => b.accountIndex === before.accountIndex),
      address = key(before.accountIndex),
      expected = changes.get(address);
    check(
      after &&
        before.owner &&
        before.programId &&
        before.owner === after.owner &&
        before.mint === after.mint &&
        before.programId === after.programId &&
        before.uiTokenAmount.decimals === after.uiTokenAmount.decimals,
      "TOKEN_IDENTITY",
    );
    check(
      uint(after!.uiTokenAmount.amount) - uint(before.uiTokenAmount.amount) ===
        (expected?.delta ?? 0n),
      "UNEXPECTED_TOKEN_DELTA",
    );
    if (expected) {
      check(
        before.owner === expected.owner &&
          before.mint === expected.mint &&
          before.programId === EVAL_TOKEN.toBase58() &&
          before.uiTokenAmount.decimals === 6,
        "TOKEN_CUSTODY",
      );
      observed.add(address);
    }
  }
  check(observed.size === 4, "MISSING_TOKEN_EFFECT");
  check(
    m!.preBalances.length === msg.staticAccountKeys.length &&
      m!.postBalances.length === msg.staticAccountKeys.length &&
      Number.isSafeInteger(m!.fee) &&
      m!.fee >= 0 &&
      m!.fee <= 10000,
    "LAMPORT_EVIDENCE",
  );
  m!.preBalances.forEach((before, i) => {
    check(
      Number.isSafeInteger(before) &&
        Number.isSafeInteger(m!.postBalances[i]) &&
        m!.postBalances[i]! >= 0 &&
        m!.postBalances[i]! - before === (i === 0 ? -m!.fee : 0),
      "UNEXPECTED_SOL_EFFECT",
    );
  });
  return {
    input: input.toString(),
    output: output.toString(),
    slot: tx.slot,
    evidenceHash: createHash("sha256")
      .update(
        JSON.stringify({
          scope: "DEVNET_TEST_ROUTER",
          signature: tx.transaction.signatures[0],
          slot: tx.slot,
          message: Buffer.from(msg.serialize()).toString("hex"),
          pre,
          post,
          inner: groups,
        }),
      )
      .digest(),
  };
}
