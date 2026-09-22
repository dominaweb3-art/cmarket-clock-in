import { createHash } from "node:crypto";

import type { C3AuthorizationManifest, TrustedEffect } from "./builder.ts";
import { C3_AMOUNTS, C3_MAINNET } from "./constants.ts";
import { canonicalize } from "./manifest.ts";
import { publicKeyBytes } from "./solana.ts";

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

type RegisteredRpcProvider = Readonly<{
  providerId: string;
  operatorId: string;
  endpoint: string;
  reviewEvidenceHash: string;
  transportKind: "https-json-rpc";
  fetchFinalizedTransaction(signature: string): Promise<unknown>;
}>;

const RPC_PROVIDER_REGISTRY: ReadonlyMap<
  string,
  readonly [RegisteredRpcProvider, RegisteredRpcProvider]
> = new Map();

export function rpcProviderRegistryStatus(): Readonly<{
  registryVersion: "c3-rpc-provider-registry/v1";
  configuredRegistryIds: readonly string[];
  productionReady: false;
}> {
  return Object.freeze({
    registryVersion: "c3-rpc-provider-registry/v1",
    configuredRegistryIds: Object.freeze([...RPC_PROVIDER_REGISTRY.keys()]),
    productionReady: false,
  });
}

export type VerifiedSettlementEvidence = Readonly<{
  signature: string;
  effectsFingerprint: string;
}>;

const verifiedSettlements = new WeakSet<object>();
const verifiedVaultSnapshots = new WeakSet<object>();

export type VerifiedVaultSnapshotEvidence = Readonly<{
  snapshotFingerprint: string;
  providerEvidenceFingerprints: readonly [string, string];
}>;

export function assertVerifiedVaultSnapshotEvidence(
  evidence: VerifiedVaultSnapshotEvidence,
): void {
  if (
    !verifiedVaultSnapshots.has(evidence) ||
    !/^[a-f0-9]{64}$/.test(evidence.snapshotFingerprint) ||
    evidence.providerEvidenceFingerprints.some(
      (fingerprint) => !/^[a-f0-9]{64}$/.test(fingerprint),
    )
  )
    throw new Error(
      "Vault snapshot evidence was not produced by the sealed RPC quorum.",
    );
}

export function assertVerifiedSettlementEvidence(
  evidence: VerifiedSettlementEvidence,
  expectedSignature: string,
): void {
  if (
    !verifiedSettlements.has(evidence) ||
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
    if (BigInt(balance.amountBaseUnits) > C3_AMOUNTS.u64Max)
      throw new Error("RPC token balance exceeds u64.");
    if (result.has(balance.tokenAccount))
      throw new Error("RPC token balances contain duplicate accounts.");
    result.set(balance.tokenAccount, balance);
  }
  return result;
}

function reconstructTokenEffects(
  transaction: RawFinalizedTransaction,
  authorization: C3AuthorizationManifest,
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
        kind:
          identity.mint === authorization.shareMint &&
          identity.owner === authorization.wallet
            ? delta < 0n
              ? "share_burn"
              : "share_mint"
            : delta < 0n
              ? "token_debit"
              : "token_credit",
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
    !Number.isSafeInteger(transaction.blockTimeUnix) ||
    transaction.blockTimeUnix < authorization.issuedAtUnix ||
    transaction.blockTimeUnix > authorization.expiresAtUnix
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
  const effects = reconstructTokenEffects(transaction, authorization);
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
    !/^(0|[1-9]\d*)$/.test(transaction.shareSupplyAfter) ||
    BigInt(transaction.shareSupplyBefore) > C3_AMOUNTS.u64Max ||
    BigInt(transaction.shareSupplyAfter) > C3_AMOUNTS.u64Max
  )
    throw new Error("Share-supply evidence is malformed.");
  const shareSupplyBefore = BigInt(transaction.shareSupplyBefore);
  const shareSupplyAfter = BigInt(transaction.shareSupplyAfter);
  const expectedShareDelta = authorization.expectedEffects
    .filter(
      (effect) =>
        effect.mint === authorization.shareMint &&
        effect.owner === authorization.wallet &&
        ["share_mint", "share_burn"].includes(effect.kind),
    )
    .reduce(
      (sum, effect) =>
        sum +
        (effect.kind === "share_burn" ? -1n : 1n) *
          BigInt(effect.amountBaseUnits),
      0n,
    );
  if (shareSupplyAfter - shareSupplyBefore !== expectedShareDelta)
    throw new Error("Share supply delta differs from authorization.");
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

function parseRawFinalizedTransaction(value: unknown): RawFinalizedTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("RPC response is not an object.");
  const record = value as Record<string, unknown>;
  const required = [
    "signature",
    "cluster",
    "genesisHash",
    "confirmationStatus",
    "slot",
    "blockTimeUnix",
    "error",
    "canonicalV0MessageHash",
    "feePayer",
    "signers",
    "staticAccounts",
    "loadedAddresses",
    "lookupTableContentsHash",
    "outerInstructions",
    "innerInstructions",
    "preTokenBalances",
    "postTokenBalances",
    "preLamports",
    "postLamports",
    "shareSupplyBefore",
    "shareSupplyAfter",
    "logs",
  ];
  if (
    Object.keys(record).length !== required.length ||
    required.some((key) => !(key in record))
  )
    throw new Error("RPC response fields are missing or unexpected.");
  for (const key of [
    "signers",
    "staticAccounts",
    "loadedAddresses",
    "outerInstructions",
    "innerInstructions",
    "preTokenBalances",
    "postTokenBalances",
    "preLamports",
    "postLamports",
    "logs",
  ])
    if (!Array.isArray(record[key]))
      throw new Error(`RPC response ${key} is not an array.`);
  for (const key of [
    "signature",
    "cluster",
    "genesisHash",
    "confirmationStatus",
    "canonicalV0MessageHash",
    "feePayer",
    "lookupTableContentsHash",
    "shareSupplyBefore",
    "shareSupplyAfter",
  ])
    if (typeof record[key] !== "string")
      throw new Error(`RPC response ${key} is not a string.`);
  const requireStringArray = (key: string): readonly string[] => {
    const values = record[key] as unknown[];
    if (values.some((item) => typeof item !== "string"))
      throw new Error(`RPC response ${key} contains a non-string value.`);
    return values as string[];
  };
  for (const address of [
    record.feePayer as string,
    ...requireStringArray("signers"),
    ...requireStringArray("staticAccounts"),
    ...requireStringArray("loadedAddresses"),
  ])
    publicKeyBytes(address);
  for (const key of ["preLamports", "postLamports"])
    if (
      requireStringArray(key).some(
        (item) =>
          !/^(0|[1-9]\d*)$/.test(item) || BigInt(item) > C3_AMOUNTS.u64Max,
      )
    )
      throw new Error(`RPC response ${key} contains a malformed amount.`);
  requireStringArray("logs");
  const parseInstructions = (key: string): readonly RawObservedInstruction[] =>
    (record[key] as unknown[]).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error(
          `RPC response ${key} contains a malformed instruction.`,
        );
      const instruction = item as Record<string, unknown>;
      const allowed = new Set([
        "programId",
        "dataBase64",
        "accounts",
        "inner",
        "decodedKind",
      ]);
      if (
        Object.keys(instruction).some((field) => !allowed.has(field)) ||
        typeof instruction.programId !== "string" ||
        typeof instruction.dataBase64 !== "string" ||
        !Array.isArray(instruction.accounts) ||
        typeof instruction.inner !== "boolean" ||
        instruction.accounts.some((account) => typeof account !== "string")
      )
        throw new Error(
          `RPC response ${key} instruction fields are malformed.`,
        );
      publicKeyBytes(instruction.programId);
      for (const account of instruction.accounts as string[])
        publicKeyBytes(account);
      const bytes = Buffer.from(instruction.dataBase64, "base64");
      if (bytes.toString("base64") !== instruction.dataBase64)
        throw new Error(
          `RPC response ${key} instruction data is non-canonical.`,
        );
      if (
        instruction.decodedKind !== undefined &&
        ![
          "transfer",
          "transfer_checked",
          "mint_to",
          "burn",
          "approve",
          "revoke",
          "set_authority",
          "close_account",
          "other",
        ].includes(String(instruction.decodedKind))
      )
        throw new Error(`RPC response ${key} decoded kind is unsupported.`);
      return structuredClone(instruction) as RawObservedInstruction;
    });
  const parseBalances = (key: string): readonly RawTokenBalance[] =>
    (record[key] as unknown[]).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error(`RPC response ${key} contains a malformed balance.`);
      const balance = item as Record<string, unknown>;
      if (
        Object.keys(balance).length !== 4 ||
        !["tokenAccount", "owner", "mint", "amountBaseUnits"].every(
          (field) => typeof balance[field] === "string",
        ) ||
        !/^(0|[1-9]\d*)$/.test(String(balance.amountBaseUnits))
      )
        throw new Error(`RPC response ${key} balance fields are malformed.`);
      for (const field of ["tokenAccount", "owner", "mint"])
        publicKeyBytes(String(balance[field]));
      return structuredClone(balance) as RawTokenBalance;
    });
  return Object.freeze({
    ...(structuredClone(record) as RawFinalizedTransaction),
    signers: Object.freeze([...requireStringArray("signers")]),
    staticAccounts: Object.freeze([...requireStringArray("staticAccounts")]),
    loadedAddresses: Object.freeze([...requireStringArray("loadedAddresses")]),
    outerInstructions: Object.freeze(parseInstructions("outerInstructions")),
    innerInstructions: Object.freeze(parseInstructions("innerInstructions")),
    preTokenBalances: Object.freeze(parseBalances("preTokenBalances")),
    postTokenBalances: Object.freeze(parseBalances("postTokenBalances")),
    preLamports: Object.freeze([...requireStringArray("preLamports")]),
    postLamports: Object.freeze([...requireStringArray("postLamports")]),
    logs: Object.freeze([...requireStringArray("logs")]),
  });
}

export function inspectSanitizedRpcFixture(
  transaction: unknown,
  authorization: C3AuthorizationManifest,
): Readonly<{ effectsFingerprint: string; evidenceFingerprint: string }> {
  return inspectRawTransaction(
    parseRawFinalizedTransaction(transaction),
    authorization,
  );
}

export async function reconcileFinalizedSignature(
  signature: string,
  authorization: C3AuthorizationManifest,
  registryId: string,
): Promise<
  Readonly<{
    settled: boolean;
    reason: string;
    effectsFingerprint?: string;
    verifiedSettlement?: VerifiedSettlementEvidence;
  }>
> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature))
    throw new Error("Transaction signature is malformed.");
  const providers = RPC_PROVIDER_REGISTRY.get(registryId);
  if (!providers)
    throw new Error(
      "External configuration missing: unknown sealed RPC registry identifier.",
    );
  const endpoints = providers.map((provider) => new URL(provider.endpoint));
  if (
    providers.some(
      (provider) =>
        provider.transportKind !== "https-json-rpc" ||
        !/^[a-f0-9]{64}$/.test(provider.reviewEvidenceHash),
    ) ||
    providers[0].providerId === providers[1].providerId ||
    providers[0].operatorId === providers[1].operatorId ||
    endpoints[0]!.host.toLowerCase() === endpoints[1]!.host.toLowerCase() ||
    endpoints.some((endpoint) => endpoint.protocol !== "https:")
  )
    throw new Error("Sealed RPC registry is not independently operated.");
  const responses = await Promise.all(
    providers.map((provider) => provider.fetchFinalizedTransaction(signature)),
  );
  let raw: readonly RawFinalizedTransaction[];
  try {
    raw = responses.map(parseRawFinalizedTransaction);
  } catch (error) {
    return Object.freeze({
      settled: false,
      reason: error instanceof Error ? error.message : "raw RPC parse failed",
    });
  }
  if (raw.some((transaction) => transaction.signature !== signature))
    return Object.freeze({
      settled: false,
      reason: "RPC returned the wrong signature",
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
    });
  }
  if (
    first.effectsFingerprint !== second.effectsFingerprint ||
    first.evidenceFingerprint !== second.evidenceFingerprint
  )
    return Object.freeze({
      settled: false,
      reason: "independent RPC evidence disagrees",
    });
  const verifiedSettlement = Object.freeze({
    signature,
    effectsFingerprint: first.effectsFingerprint,
  });
  verifiedSettlements.add(verifiedSettlement);
  return Object.freeze({
    settled: true,
    reason: "two reviewed independent providers agree on reconstructed effects",
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
