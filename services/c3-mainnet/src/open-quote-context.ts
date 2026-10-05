/** Pure canonical quote context and build contract. No transport or authorization. */
import type { QuoteContextV1 } from "./quote-seal.ts";

const assert = (condition: unknown, code: string): void => {
  if (!condition) throw new Error(`C3_OPEN_QUOTE_${code}`);
};
export type StoredQuoteContext = Readonly<{
  keeper: string;
  governance: string;
  policy: string;
  reviewedPrograms: string[];
  genesisHash: string;
  vault: string;
  configVersion: string;
  registry: string;
  registryRevision: string;
  registryHash: string;
  plan: string;
  planRevision: string;
  intent: string;
  wallet: string;
  leg: number;
  direction: 1 | 2;
  inputMint: string;
  outputMint: string;
  source: string;
  destination: string;
  routerProgram: string;
  policyRevision: string;
  inputAmount: string;
  authority: string;
  maxSlippageBps: number;
  maxQuoteAgeSeconds: number;
  planExpiresAt: string;
  configurationHash: string;
  /** Server-read committed plan floor, never client-selected. */
  planMinimumOutput?: string;
  economicReviewOnly?: boolean;
}>;
export function openQuoteContext(value: StoredQuoteContext): QuoteContextV1 {
  assert(!value.economicReviewOnly, "REVIEW_NOT_EXECUTABLE");
  const hex = (v: string) => {
    assert(/^[a-f0-9]{64}$/.test(v), "INVALID_HASH");
    return Buffer.from(v, "hex");
  };
  const integer = (v: string) => {
    assert(/^(0|[1-9][0-9]{0,19})$/.test(v), "INVALID_INTEGER");
    return BigInt(v);
  };
  assert(value.direction === 1 || value.direction === 2, "INVALID_DIRECTION");
  assert(
    Number.isInteger(value.leg) && value.leg >= 0 && value.leg < 3,
    "INVALID_LEG",
  );
  assert(
    Number.isInteger(value.maxSlippageBps) &&
      value.maxSlippageBps > 0 &&
      value.maxSlippageBps <= 100,
    "INVALID_SLIPPAGE",
  );
  hex(value.authority);
  assert(
    Number.isInteger(value.maxQuoteAgeSeconds) &&
      value.maxQuoteAgeSeconds > 0 &&
      value.maxQuoteAgeSeconds <= 30,
    "INVALID_QUOTE_AGE",
  );
  integer(value.planExpiresAt);
  hex(value.configurationHash);
  integer(value.inputAmount);
  return {
    ...value,
    genesisHash: hex(value.genesisHash),
    registryHash: hex(value.registryHash),
    configVersion: integer(value.configVersion),
    registryRevision: integer(value.registryRevision),
    planRevision: integer(value.planRevision),
    policyRevision: integer(value.policyRevision),
  };
}

export type ValidatedQuoteMaterial = Readonly<{
  authorizationNonce: Uint8Array;
  quotedOutput: bigint;
  jupiterThreshold: bigint;
  slippageBps: number;
  routeHash: Uint8Array;
  instructionHash: Uint8Array;
  accountMetasHash: Uint8Array;
  altCount: number;
  altContentsHash: Uint8Array;
  builderTimestamp: bigint;
  builderSlot: bigint;
  expiresAt: bigint;
  expiresSlot: bigint;
  unsignedPacketBytes: number;
  executionMessageHash?: string;
  effectManifest?: Readonly<{
    pool: string;
    poolInput: string;
    poolOutput: string;
  }>;
}>;
/** Server-owned builder boundary. It must resolve/validate RPC accounts and the
 * actual unsigned v0 envelope. A public request cannot provide this material.
 * JupiterLegCompiler implements this contract without signing or submission.
 * A compile result alone is never production approval.
 */
export interface OpenQuoteBuilder {
  validateAndBuild(
    trusted: StoredQuoteContext,
  ): Promise<ValidatedQuoteMaterial>;
}
