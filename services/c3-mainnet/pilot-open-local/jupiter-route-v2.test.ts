import assert from "node:assert/strict";
import { test } from "node:test";
import { C3_MAINNET as c } from "../src/constants.ts";
import type { RouterBuild } from "../src/jupiter-v2.ts";
import { validateDirectWhirlpoolRoute } from "./jupiter-route-v2.ts";
import { VAULT_AUTHORITY, vaultAta } from "./jupiter-vault-cpi-inspection.ts";
// Actual public /swap/v2/build direct Whirlpool instruction, observed 2026-10-01.
// No transaction, private key or signing payload is stored in this fixture.
const raw = Buffer.from(
  "bb64facc31c4af14801a060000000000dc0100000000000064000000000001000000110010270001",
  "hex",
);
const expected = {
  authority: VAULT_AUTHORITY.toBase58(),
  source: vaultAta(c.usdcMint),
  destination: vaultAta(c.cbBtcMint),
  inputMint: c.usdcMint,
  outputMint: c.cbBtcMint,
  inputAmount: 400000n,
  maxSlippageBps: 100,
};
const meta = (pubkey: string, isSigner = false, isWritable = false) => ({
  pubkey,
  isSigner,
  isWritable,
});
const accounts = [
  meta(expected.authority, true),
  meta(expected.source, false, true),
  meta(expected.destination, false, true),
  meta(c.usdcMint),
  meta(c.cbBtcMint),
  meta(c.tokenProgram),
  meta(c.tokenProgram),
  meta(expected.destination, false, true),
  meta("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"),
  meta(c.jupiterProgram),
  meta("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
  meta("HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM", false, true),
];
type MutableBuild = { -readonly [K in keyof RouterBuild]: RouterBuild[K] };
const build = () =>
  ({
    inputMint: c.usdcMint,
    outputMint: c.cbBtcMint,
    inAmount: "400000",
    outAmount: "476",
    otherAmountThreshold: "472",
    swapMode: "ExactIn",
    priceImpactPct: "0",
    slippageBps: 100,
    computeBudgetInstructions: [],
    setupInstructions: [],
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    addressesByLookupTableAddress: {},
    blockhashWithMetadata: {
      blockhash: Array(32).fill(1),
      lastValidBlockHeight: 100,
      fetchedAtEpochMs: 0,
    },
    routePlan: [
      {
        bps: 10000,
        swapInfo: {
          ammKey: accounts[11]!.pubkey,
          inputMint: c.usdcMint,
          outputMint: c.cbBtcMint,
          inAmount: "400000",
          outAmount: "476",
        },
      },
    ],
    swapInstruction: {
      programId: c.jupiterProgram,
      accounts: accounts.map((a) => ({ ...a })),
      data: raw.toString("base64"),
    },
  }) as MutableBuild;
test("actual route_v2 bytes bind exact amount/output, fees, ordered duplicate accounts and single route", () => {
  assert.deepEqual(validateDirectWhirlpoolRoute(build(), expected), {
    aToB: false,
    pool: accounts[11]!.pubkey,
    legacy: true,
  });
  const v2 = build();
  const bytes = Buffer.concat([
    raw.subarray(0, 34),
    Buffer.from([47, 0, 0]),
    raw.subarray(36),
  ]);
  v2.swapInstruction = {
    ...v2.swapInstruction,
    data: bytes.toString("base64"),
  };
  assert.equal(validateDirectWhirlpoolRoute(v2, expected).aToB, false);
});
test("hostile header, route graph, enum, bool, trailing bytes and fee changes fail closed", () => {
  for (const offset of [0, 8, 16, 24, 26, 28, 30, 34, 35, 36, 38, 39]) {
    const q = build(),
      data = Buffer.from(raw);
    data[offset] = 255;
    q.swapInstruction = { ...q.swapInstruction, data: data.toString("base64") };
    assert.throws(
      () => validateDirectWhirlpoolRoute(q, expected),
      /C3_ROUTE_V2_/,
    );
  }
  for (const data of [
    raw.subarray(0, 39),
    Buffer.concat([raw, Buffer.from([0])]),
    Buffer.alloc(4096),
  ]) {
    const q = build();
    q.swapInstruction = { ...q.swapInstruction, data: data.toString("base64") };
    assert.throws(() => validateDirectWhirlpoolRoute(q, expected));
  }
  for (const field of [
    "inputMint",
    "outputMint",
    "inAmount",
    "outAmount",
  ] as const) {
    const q = build();
    q[field] = "1";
    assert.throws(() => validateDirectWhirlpoolRoute(q, expected));
  }
});
test("account, signer, mint, token program, program and duplicate-occurrence substitution fail closed", () => {
  for (let i = 0; i < 11; i++) {
    const q = build();
    const metas = q.swapInstruction.accounts.map((a) => ({ ...a }));
    metas[i]!.pubkey = c.systemProgram;
    q.swapInstruction = { ...q.swapInstruction, accounts: metas };
    assert.throws(
      () => validateDirectWhirlpoolRoute(q, expected),
      /ORDERED_FIXED_ACCOUNTS/,
    );
  }
  const q = build(),
    metas = q.swapInstruction.accounts.map((a) => ({ ...a }));
  metas[7]!.isWritable = false;
  q.swapInstruction = { ...q.swapInstruction, accounts: metas };
  assert.throws(() => validateDirectWhirlpoolRoute(q, expected));
});
