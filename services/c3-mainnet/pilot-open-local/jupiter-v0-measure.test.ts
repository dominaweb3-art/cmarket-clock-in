import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair } from "@solana/web3.js";
import { C3_MAINNET } from "../src/constants.ts";
import type { RouterBuild, RouterRequest } from "../src/jupiter-v2.ts";
import {
  assertVaultExecutionAuthorized,
  measureFreshRoutes,
  measureUnsignedV0Candidate,
} from "./jupiter-v0-measure.ts";

const payer = Keypair.generate().publicKey.toBase58();
const source = Keypair.generate().publicKey.toBase58();
const destination = Keypair.generate().publicKey.toBase58();
const request: RouterRequest = {
  inputMint: C3_MAINNET.usdcMint,
  outputMint: C3_MAINNET.cbBtcMint,
  amount: 400_000n,
  taker: payer,
  slippageBps: 100,
  maxAccounts: 64,
};
const meta = (pubkey: string, isSigner = false, isWritable = true) => ({
  pubkey,
  isSigner,
  isWritable,
});
function build(extraAccounts: number): RouterBuild {
  return {
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount: "400000",
    outAmount: "1000",
    otherAmountThreshold: "990",
    swapMode: "ExactIn",
    slippageBps: 100,
    priceImpactPct: "0.001",
    routePlan: [
      {
        bps: 10_000,
        swapInfo: {
          ammKey: C3_MAINNET.jupiterProgram,
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          inAmount: "400000",
          outAmount: "1000",
        },
      },
    ],
    computeBudgetInstructions: [],
    setupInstructions: [],
    swapInstruction: {
      programId: C3_MAINNET.jupiterProgram,
      accounts: [
        meta(payer, true, false),
        meta(source),
        meta(destination),
        ...Array.from({ length: extraAccounts }, () =>
          meta(Keypair.generate().publicKey.toBase58()),
        ),
      ],
      data: Buffer.from([1, 2, 3]).toString("base64"),
    },
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    addressesByLookupTableAddress: {},
    blockhashWithMetadata: {
      blockhash: Array(32).fill(7),
      lastValidBlockHeight: 200,
      fetchedAtEpochMs: Date.now(),
    },
  };
}
function measure(candidate: RouterBuild) {
  return measureUnsignedV0Candidate({
    build: candidate,
    request,
    feePayer: payer,
    lookupEvidence: [],
    currentSlot: 100,
    currentBlockHeight: 100,
    expectedSource: source,
    expectedDestination: destination,
    allowedWritableAccounts: candidate.swapInstruction.accounts
      .filter((account) => account.isWritable)
      .map((account) => account.pubkey),
  });
}
test("actual unsigned v0 serialization is measured and never authorized", () => {
  const result = measure(build(0));
  assert.equal(result.requiredSigners[0], payer);
  assert.ok(result.bytes < 1_232);
  assert.equal(result.executable, false);
  assert.throws(
    () => assertVaultExecutionAuthorized(result),
    /PDA_SWAP_EXECUTION_NOT_IMPLEMENTED/,
  );
});
test("Portal-ETH-sized 60-meta candidate fails at packet measurement", () => {
  assert.throws(
    () => measure(build(57)),
    /C3_V0_(SERIALIZATION_OVERFLOW|TRANSACTION_TOO_LARGE)/,
  );
});
test("mint, destination, signer, writable and blockhash substitutions fail", () => {
  assert.throws(
    () => measure({ ...build(0), inputMint: C3_MAINNET.portalEthMint }),
    /QUOTE_MISMATCH/,
  );
  const missing = build(0);
  (
    missing.swapInstruction.accounts as unknown as Array<{ pubkey: string }>
  )[2]!.pubkey = source;
  assert.throws(() => measure(missing), /SOURCE_OR_DESTINATION_MISSING/);
  const signer = build(0);
  (
    signer.swapInstruction.accounts as unknown as Array<{ isSigner: boolean }>
  )[1]!.isSigner = true;
  assert.throws(() => measure(signer), /UNEXPECTED_REQUIRED_SIGNER/);
  const writable = build(0);
  assert.throws(
    () =>
      measureUnsignedV0Candidate({
        build: writable,
        request,
        feePayer: payer,
        lookupEvidence: [],
        currentSlot: 100,
        currentBlockHeight: 100,
        expectedSource: source,
        expectedDestination: destination,
        allowedWritableAccounts: [source],
      }),
    /UNREVIEWED_WRITABLE_ACCOUNT/,
  );
  const stale = build(0);
  (
    stale.blockhashWithMetadata as { fetchedAtEpochMs: number }
  ).fetchedAtEpochMs = Date.now() - 31_000;
  assert.throws(() => measure(stale), /STALE_BLOCKHASH/);
  assert.throws(
    () =>
      measureUnsignedV0Candidate({
        build: build(0),
        request: { ...request, taker: destination },
        feePayer: payer,
        lookupEvidence: [],
        currentSlot: 100,
        currentBlockHeight: 100,
        expectedSource: source,
        expectedDestination: destination,
        allowedWritableAccounts: [source, destination],
      }),
    /VAULT_PDA_CANNOT_SIGN_EXTERNALLY/,
  );
});
test("fresh-route fallback is bounded to 64, 48, 32 before any signature", async () => {
  const attempts: number[] = [];
  const result = await measureFreshRoutes(async (limit) => {
    attempts.push(limit);
    if (limit !== 32) throw new Error("C3_V0_TRANSACTION_TOO_LARGE");
    return measure(build(0));
  });
  assert.deepEqual(attempts, [64, 48, 32]);
  assert.equal(result.executable, false);
});
