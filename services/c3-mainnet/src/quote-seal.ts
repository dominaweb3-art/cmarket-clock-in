/** Server-only canonical C3 quote codec. This file does not load or contain a signing key. */
import { createHash } from "node:crypto";

import { publicKeyBytes } from "./solana.ts";

const DOMAIN = Buffer.from("C3QUOTESEAL-V1!!", "ascii");
const ZERO = Buffer.alloc(32);
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const hash = (...parts: readonly Uint8Array[]): Buffer =>
  createHash("sha256").update(Buffer.concat(parts)).digest();
function fixed(value: Uint8Array, length: number): Buffer {
  if (!(value instanceof Uint8Array) || value.length !== length)
    throw new Error("C3_QUOTE_INVALID_FIXED_BYTES");
  return Buffer.from(value);
}
function u64(value: bigint): Buffer {
  if (value < 0n || value > U64_MAX) throw new Error("C3_QUOTE_U64_OVERFLOW");
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}
function i64(value: bigint): Buffer {
  if (value < I64_MIN || value > I64_MAX)
    throw new Error("C3_QUOTE_I64_OVERFLOW");
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value);
  return buffer;
}
function byte(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new Error("C3_QUOTE_INVALID_BYTE");
  return Buffer.from([value]);
}
function u16(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 65_535)
    throw new Error("C3_QUOTE_INVALID_U16");
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}
const key = (value: string): Buffer => Buffer.from(publicKeyBytes(value));

export type QuoteContextV1 = Readonly<{
  genesisHash: Uint8Array;
  vault: string;
  configVersion: bigint;
  registry: string;
  registryRevision: bigint;
  registryHash: Uint8Array;
  plan: string;
  planRevision: bigint;
  intent: string;
  wallet: string;
  leg: number;
  direction: 1 | 2;
  inputMint: string;
  outputMint: string;
  source: string;
  destination: string;
  routerProgram: string;
  policyRevision: bigint;
}>;

/** Must match the Rust hashv preimage order exactly. */
export function quoteContextHash(context: QuoteContextV1): Buffer {
  if (context.leg < 0 || context.leg > 2)
    throw new Error("C3_QUOTE_INVALID_LEG");
  return hash(
    Buffer.from("c3-quote-context-v1"),
    DOMAIN,
    fixed(context.genesisHash, 32),
    key(context.vault),
    u64(context.configVersion),
    key(context.registry),
    u64(context.registryRevision),
    fixed(context.registryHash, 32),
    key(context.plan),
    u64(context.planRevision),
    key(context.intent),
    key(context.wallet),
    byte(context.leg),
    byte(context.direction),
    key(context.inputMint),
    key(context.outputMint),
    key(context.source),
    key(context.destination),
    key(context.routerProgram),
    u64(context.policyRevision),
  );
}

export function quoteIdForNonce(nonce: Uint8Array): Buffer {
  return hash(Buffer.from("c3-quote-id-v1"), fixed(nonce, 32));
}

export function deriveQuoteMinimum(
  output: bigint,
  slippageBps: number,
  validatedJupiterThreshold?: bigint,
  committedPlanMinimum?: bigint,
): bigint {
  if (
    output <= 0n ||
    output > U64_MAX ||
    !Number.isInteger(slippageBps) ||
    slippageBps <= 0 ||
    slippageBps > 100
  )
    throw new Error("C3_QUOTE_INVALID_MINIMUM_INPUT");
  let result = (output * BigInt(10_000 - slippageBps)) / 10_000n;
  if (result <= 0n || result > U64_MAX)
    throw new Error("C3_QUOTE_INVALID_MINIMUM_OUTPUT");
  if (validatedJupiterThreshold !== undefined) {
    if (validatedJupiterThreshold <= 0n || validatedJupiterThreshold > output)
      throw new Error("C3_QUOTE_INVALID_JUPITER_THRESHOLD");
    if (validatedJupiterThreshold > result) result = validatedJupiterThreshold;
  }
  // A fresh quote may tolerate a STRICTER floor than its own slippage threshold.
  // Never lower the owner-committed plan floor or authorize above quoted output.
  if (committedPlanMinimum !== undefined) {
    if (committedPlanMinimum <= 0n || committedPlanMinimum > output)
      throw new Error("C3_QUOTE_COMMITTED_MINIMUM_UNATTAINABLE");
    if (committedPlanMinimum > result) result = committedPlanMinimum;
  }
  return result;
}

export type QuoteSealV1 = Readonly<{
  contextHash: Uint8Array;
  quoteId: Uint8Array;
  nonce: Uint8Array;
  inputAmount: bigint;
  quotedOutput: bigint;
  slippageBps: number;
  minimumOutput: bigint;
  routeHash: Uint8Array;
  instructionHash: Uint8Array;
  accountMetasHash: Uint8Array;
  altCount: number;
  altContentsHash: Uint8Array;
  builderTimestamp: bigint;
  builderSlot: bigint;
  expiresAt: bigint;
  expiresSlot: bigint;
}>;

/** Borsh fixed-field encoding. Inputs must come from a validated builder, never a public request. */
export function encodeQuoteSealV1(seal: QuoteSealV1): Buffer {
  if (
    seal.inputAmount <= 0n ||
    seal.builderTimestamp > seal.expiresAt ||
    seal.builderSlot >= seal.expiresSlot ||
    !Number.isInteger(seal.altCount) ||
    seal.altCount < 0 ||
    seal.altCount > 4 ||
    (seal.altCount === 0) !== fixed(seal.altContentsHash, 32).equals(ZERO) ||
    !fixed(seal.quoteId, 32).equals(quoteIdForNonce(seal.nonce)) ||
    seal.minimumOutput <
      deriveQuoteMinimum(seal.quotedOutput, seal.slippageBps) ||
    seal.minimumOutput > seal.quotedOutput
  )
    throw new Error("C3_QUOTE_INVALID_SEAL");
  return Buffer.concat([
    DOMAIN,
    byte(1),
    fixed(seal.contextHash, 32),
    fixed(seal.quoteId, 32),
    fixed(seal.nonce, 32),
    u64(seal.inputAmount),
    u64(seal.quotedOutput),
    u16(seal.slippageBps),
    u64(seal.minimumOutput),
    fixed(seal.routeHash, 32),
    fixed(seal.instructionHash, 32),
    fixed(seal.accountMetasHash, 32),
    byte(seal.altCount),
    fixed(seal.altContentsHash, 32),
    i64(seal.builderTimestamp),
    u64(seal.builderSlot),
    i64(seal.expiresAt),
    u64(seal.expiresSlot),
  ]);
}

/** Implement only in an isolated signing service. No environment-key fallback exists. */
export interface QuoteAuthoritySigner {
  readonly publicKey: Uint8Array;
  signCanonicalBytes(bytes: Uint8Array): Promise<Uint8Array>;
}
