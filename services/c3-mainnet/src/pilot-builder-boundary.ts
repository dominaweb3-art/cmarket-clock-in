/** Candidate-only SDK process boundary. This module cannot authorize a wallet invocation. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { C3_MAINNET } from "./constants.ts";
import {
  decodeVersionedMessage,
  deriveAssociatedTokenAddress,
  type DecodedV0Message,
  type LookupTableContents,
} from "./solana.ts";

const MAX_OUTPUT_BYTES = 48_000;
const MAX_INPUT_BYTES = 1_024;
const TIMEOUT_MS = 15_000;
const ID = /^c3p-[a-f0-9]{32}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,95}$/;

export type BuilderRequest = Readonly<{
  intentId: string;
  configurationVersion: string;
  operation: "deposit" | "redemption";
  expectedRevision: string;
}>;

export type CandidateTransaction = Readonly<{
  unsignedTransactionBase64: string;
  sdkMessageVersion: unknown;
  sdkPayer: unknown;
  sdkRecentBlockhash: unknown;
  sdkLastValidBlockHeight: unknown;
}>;

export type CandidateResponse = Readonly<
  | { code: "C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION" }
  | {
      code: "C3_UNSIGNED_CANDIDATE_REQUIRES_EXTERNAL_VALIDATION";
      mode: "DEPOSIT_CANDIDATE" | "EXPERIMENTAL_VENDOR_CONFIRMED_USDC_MODE";
      builderVersion: "c3-symmetry-builder/0.1.0";
      sdkVersion: "1.0.22";
      sdkIntegrity: string;
      expiresAt: string;
      expectedEffectsStatus: "UNVERIFIED_CANDIDATE";
      transactions: readonly CandidateTransaction[];
    }
>;

const SDK_INTEGRITY =
  "sha512-yopoVu6VnFiktGsjgeJ2dbFX8pdciePK7BUFNbUYb5wAto6DQqVq6a51qE33dRT6BRkL/ANBpKZEJgqpJX+KMA==";

export function parseCandidateResponse(value: unknown): CandidateResponse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("C3_BUILDER_INVALID_RESPONSE");
  const result = value as Record<string, unknown>;
  if (
    result.code === "C3_REDEMPTION_REQUIRES_DEPLOYED_POSITION" &&
    Object.keys(result).join(",") === "code"
  )
    return result as CandidateResponse;
  if (
    result.code !== "C3_UNSIGNED_CANDIDATE_REQUIRES_EXTERNAL_VALIDATION" ||
    Object.keys(result).sort().join(",") !==
      "builderVersion,code,expectedEffectsStatus,expiresAt,mode,sdkIntegrity,sdkVersion,transactions" ||
    !["DEPOSIT_CANDIDATE", "EXPERIMENTAL_VENDOR_CONFIRMED_USDC_MODE"].includes(
      String(result.mode),
    ) ||
    result.builderVersion !== "c3-symmetry-builder/0.1.0" ||
    result.sdkVersion !== "1.0.22" ||
    result.sdkIntegrity !== SDK_INTEGRITY ||
    result.expectedEffectsStatus !== "UNVERIFIED_CANDIDATE" ||
    typeof result.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    !Array.isArray(result.transactions) ||
    result.transactions.length < 1 ||
    result.transactions.length > 4
  )
    throw new Error("C3_BUILDER_INVALID_RESPONSE");
  for (const raw of result.transactions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("C3_BUILDER_INVALID_RESPONSE");
    const tx = raw as Record<string, unknown>;
    if (
      Object.keys(tx).sort().join(",") !==
        "sdkLastValidBlockHeight,sdkMessageVersion,sdkPayer,sdkRecentBlockhash,unsignedTransactionBase64" ||
      tx.sdkMessageVersion !== "0" ||
      typeof tx.sdkPayer !== "string" ||
      typeof tx.sdkRecentBlockhash !== "string" ||
      !Number.isSafeInteger(tx.sdkLastValidBlockHeight)
    )
      throw new Error("C3_BUILDER_INVALID_RESPONSE");
    canonicalBase64(tx.unsignedTransactionBase64);
  }
  return result as CandidateResponse;
}

export type InspectedCandidate = Readonly<{
  decoded: DecodedV0Message;
  programIds: readonly string[];
  instructionFingerprints: readonly string[];
  writableAccounts: readonly string[];
  serializedSize: number;
  lastValidBlockHeight: number;
}>;

function canonicalBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > 8_192 || value.length < 1)
    throw new Error("C3_BUILDER_NONCANONICAL_TRANSACTION");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    throw new Error("C3_BUILDER_NONCANONICAL_TRANSACTION");
  return bytes;
}

function readShortVec(
  bytes: Uint8Array,
): Readonly<{ count: number; bytes: number }> {
  if (bytes.length === 0)
    throw new Error("C3_BUILDER_INVALID_SIGNATURE_VECTOR");
  const first = bytes[0]!;
  if (first >= 0x80) throw new Error("C3_BUILDER_INVALID_SIGNATURE_VECTOR");
  return { count: first, bytes: 1 };
}

/** Decode the actual wire bytes; never use SDK account or instruction assertions as authority. */
export function inspectUnsignedCandidate(
  candidate: CandidateTransaction,
  expected: Readonly<{
    wallet: string;
    operation: "deposit" | "redemption";
    amountBaseUnits: bigint;
    vault: string;
    shareMint: string;
    observedBlockHeight: number;
    lookupEvidence: readonly LookupTableContents[];
  }>,
): InspectedCandidate {
  const wire = canonicalBase64(candidate.unsignedTransactionBase64);
  if (wire.length > 1_232 || wire.length < 66)
    throw new Error("C3_BUILDER_SIZE_BOUND");
  const signatures = readShortVec(wire);
  if (signatures.count !== 1) throw new Error("C3_BUILDER_SIGNER_COUNT");
  if (!wire.subarray(1, 65).every((byte) => byte === 0))
    throw new Error("C3_BUILDER_SIGNED_PAYLOAD_FORBIDDEN");
  const messageBytes = wire.subarray(65);
  const decoded = decodeVersionedMessage(
    messageBytes.toString("base64"),
    expected.lookupEvidence,
  );
  if (
    decoded.wireBytes !== wire.length ||
    decoded.requiredSignatures !== 1 ||
    decoded.staticAccounts[0]?.address !== expected.wallet ||
    decoded.staticAccounts.filter((account) => account.signer).length !== 1 ||
    candidate.sdkMessageVersion !== "0" ||
    candidate.sdkPayer !== expected.wallet ||
    candidate.sdkRecentBlockhash !== decoded.recentBlockhash
  )
    throw new Error("C3_BUILDER_WALLET_OR_MESSAGE_MISMATCH");
  const lastValid = candidate.sdkLastValidBlockHeight;
  if (
    !Number.isSafeInteger(lastValid) ||
    typeof lastValid !== "number" ||
    lastValid <= expected.observedBlockHeight ||
    lastValid > expected.observedBlockHeight + 300
  )
    throw new Error("C3_BUILDER_STALE_BLOCKHASH");
  const programs = decoded.instructions.map((ix) => ix.programId);
  const allowed: ReadonlySet<string> = new Set([
    C3_MAINNET.systemProgram,
    C3_MAINNET.tokenProgram,
    C3_MAINNET.associatedTokenProgram,
    C3_MAINNET.computeBudgetProgram,
    C3_MAINNET.symmetryProgram,
  ]);
  if (
    programs.length === 0 ||
    programs.some((program) => !allowed.has(program))
  )
    throw new Error("C3_BUILDER_UNKNOWN_PROGRAM");
  if (
    expected.amountBaseUnits !== 1_000_000n &&
    expected.operation === "deposit"
  )
    throw new Error("C3_BUILDER_AMOUNT_MISMATCH");
  return Object.freeze({
    decoded,
    programIds: Object.freeze(programs),
    instructionFingerprints: Object.freeze(
      decoded.instructions.map((ix) =>
        createHash("sha256")
          .update(ix.programId)
          .update(ix.accountIndexes.join(","))
          .update(ix.dataBase64)
          .digest("hex"),
      ),
    ),
    writableAccounts: Object.freeze(
      [...decoded.staticAccounts, ...decoded.loadedAccounts]
        .filter((account) => account.writable)
        .map((account) => account.address),
    ),
    serializedSize: wire.length,
    lastValidBlockHeight: lastValid,
  });
}

/** Structural sequence checks only; no Symmetry instruction-policy approval is implied. */
export function inspectUnsignedSequence(
  transactions: readonly CandidateTransaction[],
  expected: Parameters<typeof inspectUnsignedCandidate>[1],
): readonly InspectedCandidate[] {
  if (expected.operation === "deposit" && transactions.length !== 2)
    throw new Error("C3_BUILDER_TRANSACTION_COUNT_MISMATCH");
  if (
    expected.operation === "redemption" &&
    (transactions.length < 1 || transactions.length > 4)
  )
    throw new Error("C3_BUILDER_TRANSACTION_COUNT_MISMATCH");
  const inspected = transactions.map((tx) =>
    inspectUnsignedCandidate(tx, expected),
  );
  if (expected.operation === "deposit") {
    const sourceUsdc = deriveAssociatedTokenAddress(
      expected.wallet,
      C3_MAINNET.usdcMint,
    );
    const vaultUsdc = deriveAssociatedTokenAddress(
      expected.vault,
      C3_MAINNET.usdcMint,
    );
    const first = inspected[0]?.decoded;
    const second = inspected[1]?.decoded;
    const deposit = second?.instructions[0];
    const data = deposit ? canonicalBase64(deposit.dataBase64) : null;
    if (
      !first ||
      !second ||
      first.instructions.length !== 8 ||
      second.instructions.length !== 3 ||
      first.instructions[0]?.programId !== C3_MAINNET.associatedTokenProgram ||
      first.instructions[1]?.programId !== C3_MAINNET.systemProgram ||
      first.instructions[2]?.programId !== C3_MAINNET.tokenProgram ||
      !first.instructions
        .slice(3, 6)
        .every((ix) => ix.programId === C3_MAINNET.symmetryProgram) ||
      !first.instructions
        .slice(6)
        .every((ix) => ix.programId === C3_MAINNET.computeBudgetProgram) ||
      deposit?.programId !== C3_MAINNET.symmetryProgram ||
      !second.instructions
        .slice(1)
        .every((ix) => ix.programId === C3_MAINNET.computeBudgetProgram) ||
      !data ||
      data.length < 16 ||
      data.length > 128 ||
      data.subarray(0, 8).toString("hex") !== "585c9edb5347efa4" ||
      data.readBigUInt64LE(8) !== expected.amountBaseUnits ||
      deposit.accounts[0]?.address !== expected.wallet ||
      deposit.accounts[1]?.address !== expected.vault ||
      deposit.accounts[7]?.address !== C3_MAINNET.usdcMint ||
      deposit.accounts[8]?.address !== sourceUsdc ||
      deposit.accounts[9]?.address !== vaultUsdc ||
      first.instructions[5]?.accounts[5]?.address !== expected.shareMint
    )
      throw new Error("C3_BUILDER_DEPOSIT_STRUCTURE_MISMATCH");
  }
  return Object.freeze(inspected);
}

export function assertSemanticAuthorizationAvailable(): never {
  // The public example has unreviewed System/WSOL funding and does not mint shares.
  // No C3 instruction/effect policy is registered. Generic wire checks are not approval.
  throw new Error("C3_BUILDER_SEMANTIC_POLICY_MISSING");
}

export async function requestIsolatedCandidate(
  request: BuilderRequest,
  options: Readonly<{ workerPath?: string; timeoutMs?: number }> = {},
): Promise<CandidateResponse> {
  if (
    !request ||
    !ID.test(request.intentId) ||
    !VERSION.test(request.configurationVersion) ||
    !["deposit", "redemption"].includes(request.operation) ||
    !/^[1-9]\d{0,15}$/.test(request.expectedRevision) ||
    Object.keys(request).sort().join(",") !==
      "configurationVersion,expectedRevision,intentId,operation"
  )
    throw new Error("C3_BUILDER_INVALID_REQUEST");
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES)
    throw new Error("C3_BUILDER_INPUT_TOO_LARGE");
  const worker =
    options.workerPath ??
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../c3-symmetry-builder/src/worker.mjs",
    );
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > TIMEOUT_MS)
    throw new Error("C3_BUILDER_INVALID_TIMEOUT");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          [
            "DATABASE_URL",
            "PGHOST",
            "PGPORT",
            "PGUSER",
            "PGDATABASE",
            "PGSSLMODE",
          ].includes(key),
        ),
      ),
    });
    let output = "";
    let excessive = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        excessive = true;
        child.kill("SIGKILL");
      }
    });
    // Never forward potentially sensitive SDK or database stderr.
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("C3_BUILDER_PROCESS_FAILED"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (excessive) return reject(new Error("C3_BUILDER_OUTPUT_TOO_LARGE"));
      if (code !== 0)
        return reject(new Error("C3_BUILDER_FAILED_OR_TIMED_OUT"));
      try {
        const parsed = JSON.parse(output) as unknown;
        resolve(parseCandidateResponse(parsed));
      } catch {
        reject(new Error("C3_BUILDER_MALFORMED_JSON"));
      }
    });
    child.stdin.end(input);
  });
}
