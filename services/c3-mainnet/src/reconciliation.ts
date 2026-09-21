import { createHash } from "node:crypto";

import type { C3AuthorizationManifest, TrustedEffect } from "./builder.ts";
import { C3_MAINNET } from "./constants.ts";
import { canonicalize } from "./manifest.ts";

export type RawTokenBalance = Readonly<{
  tokenAccount: string;
  owner: string;
  mint: string;
  amountBaseUnits: string;
}>;

export type RawObservedInstruction = Readonly<{
  programId: string;
  dataBase64: string;
  accounts: readonly string[];
  inner: boolean;
  decodedKind?:
    | "transfer"
    | "transfer_checked"
    | "mint_to"
    | "burn"
    | "approve"
    | "revoke"
    | "set_authority"
    | "close_account"
    | "other";
}>;

export type RawFinalizedTransaction = Readonly<{
  signature: string;
  cluster: string;
  genesisHash: string;
  confirmationStatus: "finalized" | "confirmed" | "processed" | "missing";
  slot: number;
  blockTimeUnix: number;
  error: unknown;
  canonicalV0MessageHash: string;
  feePayer: string;
  signers: readonly string[];
  staticAccounts: readonly string[];
  loadedAddresses: readonly string[];
  lookupTableContentsHash: string;
  outerInstructions: readonly RawObservedInstruction[];
  innerInstructions: readonly RawObservedInstruction[];
  preTokenBalances: readonly RawTokenBalance[];
  postTokenBalances: readonly RawTokenBalance[];
  preLamports: readonly string[];
  postLamports: readonly string[];
  shareSupplyBefore: string;
  shareSupplyAfter: string;
  logs: readonly string[];
}>;

export type ReviewedRpcProvider = Readonly<{
  providerId: string;
  operatorId: string;
  endpoint: string;
  reviewEvidenceHash: string;
  transportKind: "reviewed-https-json-rpc" | "synthetic-test";
  fetchFinalizedTransaction(
    signature: string,
  ): Promise<RawFinalizedTransaction>;
}>;

export class ReviewedRpcRegistry {
  readonly #providers: readonly [ReviewedRpcProvider, ReviewedRpcProvider];

  constructor(providers: readonly [ReviewedRpcProvider, ReviewedRpcProvider]) {
    for (const provider of providers) {
      const url = new URL(provider.endpoint);
      if (
        url.protocol !== "https:" ||
        !provider.providerId ||
        !provider.operatorId
      )
        throw new Error("RPC registry requires reviewed HTTPS providers.");
      if (!/^[a-f0-9]{64}$/.test(provider.reviewEvidenceHash))
        throw new Error("RPC provider review evidence is malformed.");
    }
    if (
      providers[0].providerId === providers[1].providerId ||
      providers[0].operatorId === providers[1].operatorId ||
      new URL(providers[0].endpoint).host.toLowerCase() ===
        new URL(providers[1].endpoint).host.toLowerCase()
    )
      throw new Error("RPC providers are not independently operated.");
    this.#providers = Object.freeze([...providers]) as unknown as readonly [
      ReviewedRpcProvider,
      ReviewedRpcProvider,
    ];
  }

  providers(): readonly [ReviewedRpcProvider, ReviewedRpcProvider] {
    return this.#providers;
  }

  productionReady(): boolean {
    return this.#providers.every(
      (provider) => provider.transportKind === "reviewed-https-json-rpc",
    );
  }
}

export type VerifiedSettlementEvidence = Readonly<{
  signature: string;
  effectsFingerprint: string;
  productionEvidence: true;
}>;

const verifiedSettlements = new WeakSet<object>();

export function assertVerifiedSettlementEvidence(
  evidence: VerifiedSettlementEvidence,
  expectedSignature: string,
): void {
  if (
    !verifiedSettlements.has(evidence) ||
    evidence.productionEvidence !== true ||
    evidence.signature !== expectedSignature ||
    !/^[a-f0-9]{64}$/.test(evidence.effectsFingerprint)
  )
    throw new Error(
      "Settlement evidence was not produced by independent reconciliation.",
    );
}

function canonicalBalanceMap(
  balances: readonly RawTokenBalance[],
): Map<string, RawTokenBalance> {
  const result = new Map<string, RawTokenBalance>();
  for (const balance of balances) {
    if (!/^(0|[1-9]\d*)$/.test(balance.amountBaseUnits))
      throw new Error("RPC token balance is malformed.");
    if (result.has(balance.tokenAccount))
      throw new Error("RPC token balances contain duplicate accounts.");
    result.set(balance.tokenAccount, balance);
  }
  return result;
}

function reconstructTokenEffects(
  transaction: RawFinalizedTransaction,
): readonly TrustedEffect[] {
  const before = canonicalBalanceMap(transaction.preTokenBalances);
  const after = canonicalBalanceMap(transaction.postTokenBalances);
  const accounts = new Set([...before.keys(), ...after.keys()]);
  const effects: TrustedEffect[] = [];
  for (const tokenAccount of [...accounts].sort()) {
    const pre = before.get(tokenAccount);
    const post = after.get(tokenAccount);
    const identity = post ?? pre;
    if (!identity) throw new Error("Token balance identity is missing.");
    if (pre && post && (pre.owner !== post.owner || pre.mint !== post.mint))
      throw new Error("Token account owner or mint changed unexpectedly.");
    const delta =
      BigInt(post?.amountBaseUnits ?? "0") -
      BigInt(pre?.amountBaseUnits ?? "0");
    if (delta === 0n) continue;
    effects.push(
      Object.freeze({
        kind: delta < 0n ? "token_debit" : "token_credit",
        owner: identity.owner,
        mint: identity.mint,
        amountBaseUnits: (delta < 0n ? -delta : delta).toString(),
        tokenAccount,
      }),
    );
  }
  return Object.freeze(effects);
}

function inspectRawTransaction(
  transaction: RawFinalizedTransaction,
  authorization: C3AuthorizationManifest,
): Readonly<{ effectsFingerprint: string; evidenceFingerprint: string }> {
  if (
    transaction.cluster !== C3_MAINNET.cluster ||
    transaction.genesisHash !== C3_MAINNET.genesisHash ||
    transaction.confirmationStatus !== "finalized" ||
    transaction.error !== null
  )
    throw new Error(
      "Transaction is not a successful finalized Mainnet transaction.",
    );
  if (
    !Number.isSafeInteger(transaction.slot) ||
    transaction.slot <= 0 ||
    !Number.isSafeInteger(transaction.blockTimeUnix)
  )
    throw new Error("Finalized transaction timing evidence is invalid.");
  if (
    transaction.canonicalV0MessageHash !==
      authorization.canonicalV0MessageHash ||
    transaction.feePayer !== authorization.wallet ||
    canonicalize(transaction.signers) !== canonicalize([authorization.wallet])
  )
    throw new Error(
      "Finalized signer, fee payer, or message differs from authorization.",
    );
  const allowedPrograms = new Set(authorization.allowedPrograms);
  const instructions = [
    ...transaction.outerInstructions,
    ...transaction.innerInstructions,
  ];
  if (instructions.length === 0)
    throw new Error("Finalized instruction evidence is missing.");
  for (const instruction of instructions) {
    if (!allowedPrograms.has(instruction.programId))
      throw new Error("Finalized transaction invoked an unknown program.");
    if (
      ["approve", "set_authority", "revoke"].includes(
        instruction.decodedKind ?? "",
      )
    )
      throw new Error(
        "Finalized transaction changed token authority or delegation.",
      );
    if (
      ["mint_to", "burn", "close_account"].includes(
        instruction.decodedKind ?? "",
      ) &&
      instruction.programId !== C3_MAINNET.symmetryProgram
    )
      throw new Error(
        "Finalized transaction contains a prohibited token effect.",
      );
  }
  const effects = reconstructTokenEffects(transaction);
  if (canonicalize(effects) !== canonicalize(authorization.expectedEffects))
    throw new Error("Finalized token effects differ from authorization.");
  if (
    transaction.preLamports.length !== transaction.postLamports.length ||
    transaction.preLamports.some((value) => !/^(0|[1-9]\d*)$/.test(value)) ||
    transaction.postLamports.some((value) => !/^(0|[1-9]\d*)$/.test(value))
  )
    throw new Error("Lamport balance evidence is incomplete.");
  if (
    !/^(0|[1-9]\d*)$/.test(transaction.shareSupplyBefore) ||
    !/^(0|[1-9]\d*)$/.test(transaction.shareSupplyAfter)
  )
    throw new Error("Share-supply evidence is malformed.");
  const effectsFingerprint = createHash("sha256")
    .update(
      canonicalize({
        effects,
        shareSupplyBefore: transaction.shareSupplyBefore,
        shareSupplyAfter: transaction.shareSupplyAfter,
      }),
    )
    .digest("hex");
  const evidenceFingerprint = createHash("sha256")
    .update(canonicalize(transaction))
    .digest("hex");
  return Object.freeze({ effectsFingerprint, evidenceFingerprint });
}

export async function reconcileFinalizedSignature(
  signature: string,
  authorization: C3AuthorizationManifest,
  registry: ReviewedRpcRegistry,
): Promise<
  Readonly<{
    settled: boolean;
    reason: string;
    productionEvidence: boolean;
    effectsFingerprint?: string;
    verifiedSettlement?: VerifiedSettlementEvidence;
  }>
> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature))
    throw new Error("Transaction signature is malformed.");
  const providers = registry.providers();
  const raw = await Promise.all(
    providers.map((provider) => provider.fetchFinalizedTransaction(signature)),
  );
  if (raw.some((transaction) => transaction.signature !== signature))
    return Object.freeze({
      settled: false,
      reason: "RPC returned the wrong signature",
      productionEvidence: false,
    });
  let first: ReturnType<typeof inspectRawTransaction>;
  let second: ReturnType<typeof inspectRawTransaction>;
  try {
    first = inspectRawTransaction(raw[0]!, authorization);
    second = inspectRawTransaction(raw[1]!, authorization);
  } catch (error) {
    return Object.freeze({
      settled: false,
      reason: error instanceof Error ? error.message : "raw evidence rejected",
      productionEvidence: false,
    });
  }
  if (
    first.effectsFingerprint !== second.effectsFingerprint ||
    first.evidenceFingerprint !== second.evidenceFingerprint
  )
    return Object.freeze({
      settled: false,
      reason: "independent RPC evidence disagrees",
      productionEvidence: false,
    });
  if (!registry.productionReady())
    return Object.freeze({
      settled: false,
      reason: "synthetic evidence cannot settle production intent",
      productionEvidence: false,
    });
  const verifiedSettlement = Object.freeze({
    signature,
    effectsFingerprint: first.effectsFingerprint,
    productionEvidence: true as const,
  });
  verifiedSettlements.add(verifiedSettlement);
  return Object.freeze({
    settled: true,
    reason: "two reviewed independent providers agree on reconstructed effects",
    productionEvidence: true,
    effectsFingerprint: first.effectsFingerprint,
    verifiedSettlement,
  });
}

export type IntentState =
  | "draft"
  | "awaiting_wallet"
  | "intent_submitted"
  | "keeper_pending"
  | "partially_completed"
  | "settled"
  | "failed_recoverable"
  | "manual_review"
  | "cancelled"
  | "expired";

const TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> =
  Object.freeze({
    draft: ["awaiting_wallet", "cancelled", "expired"],
    awaiting_wallet: [
      "intent_submitted",
      "cancelled",
      "expired",
      "manual_review",
    ],
    intent_submitted: [
      "keeper_pending",
      "partially_completed",
      "failed_recoverable",
      "manual_review",
    ],
    keeper_pending: [
      "partially_completed",
      "settled",
      "failed_recoverable",
      "manual_review",
      "expired",
    ],
    partially_completed: ["keeper_pending", "settled", "manual_review"],
    settled: [],
    failed_recoverable: ["keeper_pending", "manual_review"],
    manual_review: [],
    cancelled: [],
    expired: [],
  });

export const C3_INTENT_STATES = Object.freeze(
  Object.keys(TRANSITIONS) as IntentState[],
);

export function assertIntentTransition(
  from: IntentState,
  to: IntentState,
): void {
  if (!TRANSITIONS[from]?.includes(to))
    throw new Error(`Unsafe C3 intent transition: ${from} -> ${to}.`);
}

export function recoveryPolicy(): Readonly<{
  automaticRetry: false;
  automaticReversal: false;
  preserveSubmittedSignature: true;
}> {
  return Object.freeze({
    automaticRetry: false,
    automaticReversal: false,
    preserveSubmittedSignature: true,
  });
}

export function evaluateTimedRecovery(
  input: Readonly<{
    state: IntentState;
    nowUnix: number;
    intentExpiresAtUnix: number;
    withdrawalStartedAtUnix?: number;
    withdrawalTimeoutSeconds: number;
    submittedSignaturePresent: boolean;
  }>,
): "active" | "expired" | "manual_review" {
  if (
    !Number.isSafeInteger(input.nowUnix) ||
    !Number.isSafeInteger(input.intentExpiresAtUnix) ||
    !Number.isSafeInteger(input.withdrawalTimeoutSeconds) ||
    input.withdrawalTimeoutSeconds <= 0
  )
    throw new Error("Recovery timing input is invalid.");
  if (
    ["draft", "awaiting_wallet"].includes(input.state) &&
    input.nowUnix >= input.intentExpiresAtUnix
  )
    return "expired";
  if (
    input.withdrawalStartedAtUnix !== undefined &&
    (!Number.isSafeInteger(input.withdrawalStartedAtUnix) ||
      input.withdrawalStartedAtUnix > input.nowUnix)
  )
    throw new Error("Withdrawal timing evidence is invalid.");
  if (
    input.withdrawalStartedAtUnix !== undefined &&
    input.nowUnix >=
      input.withdrawalStartedAtUnix + input.withdrawalTimeoutSeconds
  )
    return "manual_review";
  if (
    input.submittedSignaturePresent &&
    ["intent_submitted", "keeper_pending", "partially_completed"].includes(
      input.state,
    )
  )
    return "manual_review";
  return "active";
}
