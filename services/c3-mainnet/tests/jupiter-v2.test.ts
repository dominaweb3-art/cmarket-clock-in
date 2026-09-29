import assert from "node:assert/strict";
import { test } from "node:test";
import { C3_MAINNET } from "../src/constants.ts";
import {
  JupiterV2ReadOnlyClient,
  parseRouterBuild,
  quoteFingerprint,
  type RouterRequest,
} from "../src/jupiter-v2.ts";

const taker = "11111111111111111111111111111111";
const request: RouterRequest = {
  inputMint: C3_MAINNET.usdcMint,
  outputMint: C3_MAINNET.cbBtcMint,
  amount: 400_000n,
  taker,
  slippageBps: 100,
  maxAccounts: 32,
};

function fixture(): Record<string, unknown> {
  return {
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount: "400000",
    outAmount: "479",
    otherAmountThreshold: "475",
    swapMode: "ExactIn",
    slippageBps: 100,
    priceImpactPct: "0.0009072651006712520732692995",
    routePlan: [
      {
        bps: 10_000,
        percent: 100,
        swapInfo: {
          ammKey: C3_MAINNET.jupiterProgram,
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          inAmount: "400000",
          outAmount: "479",
        },
      },
    ],
    computeBudgetInstructions: [],
    setupInstructions: [],
    swapInstruction: {
      programId: C3_MAINNET.jupiterProgram,
      accounts: [{ pubkey: taker, isSigner: true, isWritable: false }],
      data: Buffer.from([1, 2, 3]).toString("base64"),
    },
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    addressesByLookupTableAddress: {},
    blockhashWithMetadata: {
      blockhash: Array(32).fill(7),
      lastValidBlockHeight: 123456,
      fetchedAt: {
        secs_since_epoch: Math.floor(Date.now() / 1_000),
        nanos_since_epoch: 0,
      },
    },
  };
}

test("valid V2-shaped response parses without treating labels as authority", () => {
  const build = parseRouterBuild(fixture(), request);
  assert.equal(build.inAmount, "400000");
  assert.equal(build.otherAmountThreshold, "475");
  assert.match(quoteFingerprint(build), /^[a-f0-9]{64}$/);
});

test("raw build parses 83 ordered meta occurrences but rejects an unbounded response", () => {
  const raw = fixture();
  const accounts = (
    raw.swapInstruction as {
      accounts: Array<{
        pubkey: string;
        isSigner: boolean;
        isWritable: boolean;
      }>;
    }
  ).accounts;
  for (let index = 1; index < 83; index += 1) {
    accounts.push({
      pubkey: index % 2 === 0 ? request.inputMint : request.outputMint,
      isSigner: false,
      isWritable: true,
    });
  }
  const parsed = parseRouterBuild(raw, request);
  assert.equal(parsed.swapInstruction.accounts.length, 83);
  assert.equal(parsed.swapInstruction.accounts[1]?.pubkey, request.outputMint);
  assert.equal(parsed.swapInstruction.accounts[2]?.pubkey, request.inputMint);
  assert.equal(parsed.swapInstruction.accounts[82]?.pubkey, request.inputMint);
  for (let index = 83; index < 257; index += 1) {
    accounts.push({
      pubkey: request.inputMint,
      isSigner: false,
      isWritable: false,
    });
  }
  assert.throws(() => parseRouterBuild(raw, request), /INVALID_ACCOUNTS/);
});

test("multi-hop route accounting is per mint, not sum of all hop bps", () => {
  const raw = fixture();
  raw.routePlan = [
    {
      bps: 10_000,
      swapInfo: {
        ammKey: C3_MAINNET.jupiterProgram,
        inputMint: request.inputMint,
        outputMint: C3_MAINNET.portalEthMint,
        inAmount: "400000",
        outAmount: "11179",
      },
    },
    {
      bps: 10_000,
      swapInfo: {
        ammKey: C3_MAINNET.jupiterProgram,
        inputMint: C3_MAINNET.portalEthMint,
        outputMint: request.outputMint,
        inAmount: "11179",
        outAmount: "479",
      },
    },
  ];
  assert.equal(parseRouterBuild(raw, request).routePlan.length, 2);
  (
    raw.routePlan as Array<{ swapInfo: { inAmount: string } }>
  )[1]!.swapInfo.inAmount = "11178";
  assert.throws(
    () => parseRouterBuild(raw, request),
    /C3_JUPITER_INVALID_ROUTE/,
  );
});

test("tampered mint, amount, minimum, slippage, signer and program fail closed", () => {
  for (const [field, value] of [
    ["inputMint", C3_MAINNET.portalEthMint],
    ["inAmount", "400001"],
    ["otherAmountThreshold", "1"],
    ["slippageBps", 101],
    ["priceImpactPct", "0.051"],
  ] as const) {
    const raw = fixture();
    raw[field] = value;
    assert.throws(() => parseRouterBuild(raw, request));
  }
  const wrongSigner = fixture();
  (
    wrongSigner.swapInstruction as { accounts: Array<{ isSigner: boolean }> }
  ).accounts[0]!.isSigner = false;
  assert.throws(
    () => parseRouterBuild(wrongSigner, request),
    /AUTHORITY_MISMATCH/,
  );
  const wrongProgram = fixture();
  (wrongProgram.swapInstruction as { programId: string }).programId =
    C3_MAINNET.systemProgram;
  assert.throws(
    () => parseRouterBuild(wrongProgram, request),
    /AUTHORITY_MISMATCH/,
  );
});

test("malformed base64, route, lookup, blockhash and bigint are rejected", () => {
  const malformed = fixture();
  (malformed.swapInstruction as { data: string }).data = "!";
  assert.throws(() => parseRouterBuild(malformed, request));
  const route = fixture();
  (route.routePlan as Array<{ bps: number }>)[0]!.bps = 9_999;
  assert.throws(() => parseRouterBuild(route, request));
  const lookup = fixture();
  lookup.addressesByLookupTableAddress = {
    [C3_MAINNET.jupiterProgram]: ["not-base58"],
  };
  assert.throws(() => parseRouterBuild(lookup, request));
  const blockhash = fixture();
  (blockhash.blockhashWithMetadata as { blockhash: number[] }).blockhash = [
    1, 2,
  ];
  assert.throws(() => parseRouterBuild(blockhash, request));
  const oversized = fixture();
  oversized.inAmount = (1n << 64n).toString();
  assert.throws(() => parseRouterBuild(oversized, request));
  const stale = fixture();
  (
    stale.blockhashWithMetadata as {
      fetchedAt: { secs_since_epoch: number };
    }
  ).fetchedAt.secs_since_epoch -= 31;
  assert.throws(
    () => parseRouterBuild(stale, request),
    /C3_JUPITER_STALE_QUOTE/,
  );
  const tipped = fixture();
  tipped.tipInstruction = tipped.swapInstruction;
  assert.throws(
    () => parseRouterBuild(tipped, request),
    /UNEXPECTED_FEE_OR_INSTRUCTION/,
  );
});

test("401 returns credential-required without exposing body or retrying", async () => {
  let requests = 0;
  const client = new JupiterV2ReadOnlyClient({
    fetchImpl: async (_input, init) => {
      requests += 1;
      assert.equal(
        (init?.headers as Record<string, string>)["x-api-key"],
        undefined,
      );
      return new Response(JSON.stringify({ error: "sensitive body" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    client.getExactInQuote(request),
    /C3_JUPITER_CREDENTIAL_REQUIRED/,
  );
  assert.equal(requests, 1);
});

test("client rejects oversized body before parsing", async () => {
  const client = new JupiterV2ReadOnlyClient({
    apiKey: "test-only-never-log",
    fetchImpl: async (_input, init) => {
      assert.equal(
        (init?.headers as Record<string, string>)["x-api-key"],
        "test-only-never-log",
      );
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "999999",
        },
      });
    },
  });
  await assert.rejects(
    client.getExactInQuote(request),
    /C3_JUPITER_UNEXPECTED_RESPONSE/,
  );
});
