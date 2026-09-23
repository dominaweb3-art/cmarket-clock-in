import { createHash } from "node:crypto";

import {
  loadAuthorizationRecord,
  type C3AuthorizationManifest,
  type TrustedEffect,
} from "./synthetic-builder.ts";
import { C3_AMOUNTS, C3_MAINNET } from "../../src/constants.ts";
import { canonicalize } from "../../src/manifest.ts";
import {
  decodeBase58,
  decodeVersionedMessage,
  encodeBase58,
  publicKeyBytes,
} from "../../src/solana.ts";

type RegisteredRpcProvider = Readonly<{
  providerId: string;
  operatorId: string;
  endpoint: string;
  cluster: "mainnet-beta";
  genesisHash: string;
  reviewEvidenceHash: string;
  transportKind: "https-json-rpc";
  fetchFinalizedTransaction(signature: string): Promise<unknown>;
  fetchSignatureStatus(signature: string): Promise<unknown>;
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
export type VerifiedVaultSnapshotEvidence = Readonly<{
  snapshotFingerprint: string;
  providerEvidenceFingerprints: readonly [string, string];
}>;
const verifiedSettlements = new WeakSet<object>();
const verifiedVaultSnapshots = new WeakSet<object>();
const HASH = /^[a-f0-9]{64}$/;
const INTEGER = /^(0|[1-9]\d*)$/;

export function assertVerifiedVaultSnapshotEvidence(
  evidence: VerifiedVaultSnapshotEvidence,
): void {
  if (
    !verifiedVaultSnapshots.has(evidence) ||
    !HASH.test(evidence.snapshotFingerprint) ||
    evidence.providerEvidenceFingerprints.some(
      (fingerprint) => !HASH.test(fingerprint),
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
    !HASH.test(evidence.effectsFingerprint)
  )
    throw new Error(
      "Settlement evidence was not produced by independent reconciliation.",
    );
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is missing.`);
  return value;
}

function safeNumber(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${label} is not a safe nonnegative integer.`);
  return value as number;
}

function boundedAmount(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !INTEGER.test(value))
    throw new Error(`${label} is not a canonical integer string.`);
  const parsed = BigInt(value);
  if (parsed > C3_AMOUNTS.u64Max) throw new Error(`${label} exceeds u64.`);
  return parsed;
}

function canonicalBase64(value: unknown, label: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > 4_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new Error(`${label} is malformed.`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    throw new Error(`${label} is not canonical base64.`);
  return bytes;
}

function parseSignedTransaction(
  raw: unknown,
  signature: string,
  authorization: C3AuthorizationManifest,
) {
  const pair = array(raw, "base64 transaction");
  if (pair.length !== 2 || pair[1] !== "base64")
    throw new Error(
      "Only official base64 getTransaction encoding is accepted.",
    );
  const bytes = canonicalBase64(pair[0], "signed transaction");
  if (bytes.length > 1_232 || bytes.length < 67 || bytes[0] !== 1)
    throw new Error("Signed v0 transaction has invalid signer count or size.");
  if (encodeBase58(bytes.subarray(1, 65)) !== signature)
    throw new Error(
      "RPC transaction signature does not match the requested signature.",
    );
  const message = bytes.subarray(65);
  const messageBase64 = Buffer.from(message).toString("base64");
  // The closed policy currently authorizes no ALTs. An ALT cannot be accepted
  // until its full on-chain contents and activity are bound by a sealed registry.
  if (authorization.lookupTables.length !== 0)
    throw new Error(
      "EXTERNAL_CONFIGURATION_MISSING: sealed ALT contents are unavailable.",
    );
  const decoded = decodeVersionedMessage(messageBase64, []);
  if (
    decoded.messageHash !== authorization.canonicalV0MessageHash ||
    decoded.messageBase64 !== authorization.canonicalV0MessageBase64 ||
    decoded.recentBlockhash !== authorization.recentBlockhash
  )
    throw new Error(
      "Signed transaction message differs from the stored authorization.",
    );
  if (
    decoded.requiredSignatures !== 1 ||
    decoded.staticAccounts[0]?.address !== authorization.wallet ||
    decoded.wireBytes !== bytes.length
  )
    throw new Error(
      "Signed transaction signer or fee payer differs from authorization.",
    );
  if (
    canonicalize(decoded.instructions) !==
    canonicalize(authorization.compiledInstructions)
  )
    throw new Error("Signed outer instructions differ from authorization.");
  return decoded;
}

type Balance = Readonly<{
  tokenAccount: string;
  owner: string;
  mint: string;
  amountBaseUnits: string;
}>;

function parseTokenBalances(
  raw: unknown,
  accounts: readonly string[],
  label: string,
): Map<string, Balance> {
  const balances = new Map<string, Balance>();
  for (const entry of array(raw, label)) {
    const row = object(entry, label);
    const index = safeNumber(row.accountIndex, `${label} account index`);
    const tokenAccount = accounts[index];
    if (!tokenAccount || balances.has(tokenAccount))
      throw new Error(`${label} has an invalid or duplicate token account.`);
    if (typeof row.mint !== "string" || typeof row.owner !== "string")
      throw new Error(`${label} lacks mint or owner.`);
    publicKeyBytes(row.mint);
    publicKeyBytes(row.owner);
    const ui = object(row.uiTokenAmount, `${label} uiTokenAmount`);
    boundedAmount(ui.amount, `${label} token amount`);
    const decimals = safeNumber(ui.decimals, `${label} decimals`);
    if (decimals > 18) throw new Error("Token decimals exceed policy.");
    balances.set(tokenAccount, {
      tokenAccount,
      owner: row.owner,
      mint: row.mint,
      amountBaseUnits: ui.amount as string,
    });
  }
  return balances;
}

function reconstructEffects(
  before: Map<string, Balance>,
  after: Map<string, Balance>,
  authorization: C3AuthorizationManifest,
): readonly TrustedEffect[] {
  const effects: TrustedEffect[] = [];
  for (const account of [
    ...new Set([...before.keys(), ...after.keys()]),
  ].sort()) {
    const pre = before.get(account);
    const post = after.get(account);
    if (!pre || !post || pre.owner !== post.owner || pre.mint !== post.mint)
      throw new Error("Missing or changed token-account owner/mint evidence.");
    const delta =
      boundedAmount(post.amountBaseUnits, "post amount") -
      boundedAmount(pre.amountBaseUnits, "pre amount");
    if (delta === 0n) continue;
    effects.push({
      kind:
        pre.mint === authorization.shareMint &&
        pre.owner === authorization.wallet
          ? delta > 0n
            ? "share_mint"
            : "share_burn"
          : delta > 0n
            ? "token_credit"
            : "token_debit",
      owner: pre.owner,
      mint: pre.mint,
      amountBaseUnits: (delta > 0n ? delta : -delta).toString(),
      tokenAccount: account,
    });
  }
  if (canonicalize(effects) !== canonicalize(authorization.expectedEffects))
    throw new Error(
      "Finalized token effects differ from stored authorization.",
    );
  return effects;
}

function inspectOfficialTransaction(
  raw: unknown,
  statusRaw: unknown,
  signature: string,
  intentId: string,
): Readonly<{ effectsFingerprint: string; evidenceFingerprint: string }> {
  const authorization = loadAuthorizationRecord(intentId);
  const status = object(statusRaw, "getSignatureStatuses result");
  if (
    status.confirmationStatus !== "finalized" ||
    status.err !== null ||
    safeNumber(status.slot, "status slot") <= 0
  )
    throw new Error("Signature is not finalized without error.");
  const transaction = object(raw, "getTransaction result");
  if (transaction.version !== 0)
    throw new Error("Only official version-0 transactions are accepted.");
  const slot = safeNumber(transaction.slot, "transaction slot");
  const blockTime = safeNumber(transaction.blockTime, "block time");
  if (
    slot !== status.slot ||
    slot <= 0 ||
    blockTime < authorization.issuedAtUnix ||
    blockTime > authorization.expiresAtUnix
  )
    throw new Error(
      "Finalized slot or block time disagrees with authorization.",
    );
  const decoded = parseSignedTransaction(
    transaction.transaction,
    signature,
    authorization,
  );
  const meta = object(transaction.meta, "transaction meta");
  if (meta.err !== null) throw new Error("Finalized transaction failed.");
  const loaded = object(meta.loadedAddresses, "loaded addresses");
  if (
    array(loaded.writable, "loaded writable addresses").length !== 0 ||
    array(loaded.readonly, "loaded readonly addresses").length !== 0
  )
    throw new Error("Unregistered ALT addresses are forbidden.");
  const accounts = [...decoded.staticAccounts, ...decoded.loadedAccounts].map(
    (item) => item.address,
  );
  const preLamports = array(meta.preBalances, "preBalances").map((value) =>
    safeNumber(value, "pre lamports"),
  );
  const postLamports = array(meta.postBalances, "postBalances").map((value) =>
    safeNumber(value, "post lamports"),
  );
  const fee = safeNumber(meta.fee, "transaction fee");
  if (
    preLamports.length !== accounts.length ||
    postLamports.length !== accounts.length ||
    preLamports[0]! - postLamports[0]! !== fee ||
    preLamports
      .slice(1)
      .some((value, index) => value !== postLamports[index + 1])
  )
    throw new Error("Lamport changes exceed the authorized fee.");
  const inner = array(meta.innerInstructions, "innerInstructions");
  for (const group of inner) {
    const instructionGroup = object(group, "inner group");
    const parent = safeNumber(instructionGroup.index, "inner parent index");
    if (parent >= decoded.instructions.length)
      throw new Error("Inner instruction parent is invalid.");
    for (const instruction of array(
      instructionGroup.instructions,
      "inner instructions",
    )) {
      const item = object(instruction, "inner instruction");
      const programIndex = safeNumber(
        item.programIdIndex,
        "inner program index",
      );
      const program = accounts[programIndex];
      if (!program || !authorization.allowedPrograms.includes(program))
        throw new Error("Inner instruction invokes an unapproved program.");
      for (const index of array(item.accounts, "inner accounts"))
        if (!accounts[safeNumber(index, "inner account index")])
          throw new Error("Inner instruction references an unknown account.");
      if (typeof item.data !== "string" || decodeBase58(item.data).length === 0)
        throw new Error("Inner instruction data is malformed.");
    }
  }
  if (
    inner.some(
      (group) =>
        array(object(group, "inner group").instructions, "inner instructions")
          .length > 0,
    )
  )
    throw new Error(
      "EXTERNAL_CONFIGURATION_MISSING: sealed inner CPI semantics are unavailable.",
    );
  const before = parseTokenBalances(
    meta.preTokenBalances,
    accounts,
    "preTokenBalances",
  );
  const after = parseTokenBalances(
    meta.postTokenBalances,
    accounts,
    "postTokenBalances",
  );
  for (const balance of [
    ...array(meta.preTokenBalances, "preTokenBalances"),
    ...array(meta.postTokenBalances, "postTokenBalances"),
  ]) {
    const row = object(balance, "token balance");
    const ui = object(row.uiTokenAmount, "token amount");
    if (
      row.mint === authorization.inputMint &&
      ui.decimals !== C3_AMOUNTS.usdcDecimals
    )
      throw new Error("USDC decimals differ from the sealed policy.");
    if (
      row.mint === authorization.shareMint &&
      ui.decimals !== C3_AMOUNTS.shareDecimals
    )
      throw new Error("Share decimals differ from the sealed policy.");
  }
  const effects = reconstructEffects(before, after, authorization);
  const logs = array(meta.logMessages, "logMessages");
  if (logs.some((log) => typeof log !== "string"))
    throw new Error("Transaction logs are malformed.");
  // A token balance delta alone does not prove a C3 share mint. A real
  // Token Program mint instruction and supply reconciliation are required.
  if (
    effects.some(
      (effect) => effect.kind === "share_mint" || effect.kind === "share_burn",
    )
  )
    throw new Error(
      "EXTERNAL_CONFIGURATION_MISSING: share supply and SPL mint/burn evidence are unavailable.",
    );
  return Object.freeze({
    effectsFingerprint: createHash("sha256")
      .update(canonicalize(effects))
      .digest("hex"),
    evidenceFingerprint: createHash("sha256")
      .update(canonicalize({ raw, statusRaw }))
      .digest("hex"),
  });
}

// Read-only parser surface. It cannot create a trusted settlement receipt.
export function inspectOfficialRpcEvidence(
  transaction: unknown,
  signatureStatus: unknown,
  signature: string,
  intentId: string,
): Readonly<{ effectsFingerprint: string; evidenceFingerprint: string }> {
  return inspectOfficialTransaction(
    transaction,
    signatureStatus,
    signature,
    intentId,
  );
}

export async function reconcileFinalizedSignature(
  signature: string,
  intentId: string,
  registryId: string,
): Promise<
  Readonly<{
    settled: boolean;
    reason: string;
    effectsFingerprint?: string;
    verifiedSettlement?: VerifiedSettlementEvidence;
  }>
> {
  if (decodeBase58(signature).length !== 64)
    throw new Error("Transaction signature is malformed.");
  loadAuthorizationRecord(intentId);
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
        !HASH.test(provider.reviewEvidenceHash) ||
        provider.cluster !== C3_MAINNET.cluster ||
        provider.genesisHash !== C3_MAINNET.genesisHash,
    ) ||
    providers[0].providerId === providers[1].providerId ||
    providers[0].operatorId === providers[1].operatorId ||
    endpoints[0]!.host.toLowerCase() === endpoints[1]!.host.toLowerCase() ||
    endpoints.some((endpoint) => endpoint.protocol !== "https:")
  )
    throw new Error("Sealed RPC registry is not independently operated.");
  const results = await Promise.all(
    providers.map(async (provider) => ({
      transaction: await provider.fetchFinalizedTransaction(signature),
      status: await provider.fetchSignatureStatus(signature),
    })),
  );
  let first: ReturnType<typeof inspectOfficialTransaction>;
  let second: ReturnType<typeof inspectOfficialTransaction>;
  try {
    first = inspectOfficialTransaction(
      results[0]!.transaction,
      results[0]!.status,
      signature,
      intentId,
    );
    second = inspectOfficialTransaction(
      results[1]!.transaction,
      results[1]!.status,
      signature,
      intentId,
    );
  } catch (error) {
    return Object.freeze({
      settled: false,
      reason:
        error instanceof Error
          ? error.message
          : "official RPC evidence rejected",
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
