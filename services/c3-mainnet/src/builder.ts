import { createHash } from "node:crypto";

import {
  C3_AMOUNTS,
  C3_FEES,
  C3_MAINNET,
  C3_MAINNET_EXECUTION_CAPABILITY,
  assertExecutionDisabled,
} from "./constants.ts";
import {
  canonicalize,
  computeManifestHash,
  validateDeploymentManifest,
  type C3DeploymentManifest,
} from "./manifest.ts";
import {
  decodeVersionedMessage,
  deriveAssociatedTokenAddress,
  publicKeyBytes,
  type DecodedV0Message,
  type LookupTableContents,
} from "./solana.ts";

export type C3Operation =
  | "seed_deposit"
  | "deposit_intent"
  | "rebalance_intent"
  | "redemption_intent"
  | "usdc_withdrawal"
  | "emergency_pause";

export type UserOperationIntent = Readonly<{
  operation: C3Operation;
  intentId: string;
  idempotencyKey: string;
  wallet: string;
  inputAmountBaseUnits: string;
  slippageBps: number;
  nowUnix: number;
}>;

export type TrustedInstructionPolicy = Readonly<{
  programId: string;
  accountAddresses: readonly string[];
  signerFlags: readonly boolean[];
  writableFlags: readonly boolean[];
  dataBase64: string;
}>;

export type TrustedEffect = Readonly<{
  kind: "token_debit" | "token_credit" | "share_mint" | "share_burn";
  owner: string;
  mint: string;
  amountBaseUnits: string;
  tokenAccount: string;
}>;

export type TrustedOperationPolicy = Readonly<{
  policySchemaVersion: "c3-operation-policy/v2";
  configurationVersion: string;
  configurationHash: string;
  cluster: "mainnet-beta";
  genesisHash: string;
  operation: C3Operation;
  wallet: string;
  feePayer: string;
  vault: string;
  shareMint: string;
  inputMint: string;
  userInputTokenAccount: string;
  vaultInputTokenAccount: string;
  userShareTokenAccount: string;
  inputAmountBaseUnits: string;
  expectedOutputBaseUnits: string;
  minimumOutputBaseUnits: string;
  feeBaseUnits: "0";
  bountyBaseUnits: string;
  allowedPrograms: readonly string[];
  approvedRoutePrograms: readonly string[];
  instructions: readonly TrustedInstructionPolicy[];
  expectedEffects: readonly TrustedEffect[];
  expectedDestinations: readonly string[];
  reconciliationPostConditions: readonly string[];
  quoteContextHash: string;
  quoteObservedAtUnix: number;
  quoteExpiresAtUnix: number;
  transactionExpiresAtUnix: number;
  lastValidBlockHeight: number;
  lookupTableContents: readonly LookupTableContents[];
  evidenceHash: string;
  evidenceSource: "reviewed-official" | "synthetic-test";
}>;

export type C3AuthorizationManifest = Readonly<{
  schemaVersion: "c3-authorization/v2";
  authorizationHash: string;
  executionCapability: false;
  configurationVersion: string;
  configurationHash: string;
  cluster: "mainnet-beta";
  genesisHash: string;
  operation: C3Operation;
  intentId: string;
  idempotencyKey: string;
  wallet: string;
  vault: string;
  shareMint: string;
  inputMint: string;
  inputAmountBaseUnits: string;
  expectedOutputBaseUnits: string;
  minimumOutputBaseUnits: string;
  feeBaseUnits: "0";
  bountyBaseUnits: string;
  slippageBps: number;
  quoteContextHash: string;
  quoteObservedAtUnix: number;
  quoteExpiresAtUnix: number;
  transactionExpiresAtUnix: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  canonicalV0MessageBase64: string;
  canonicalV0MessageHash: string;
  wireBytes: number;
  staticAccounts: DecodedV0Message["staticAccounts"];
  loadedAccounts: DecodedV0Message["loadedAccounts"];
  compiledInstructions: DecodedV0Message["instructions"];
  lookupTables: DecodedV0Message["lookupTables"];
  allowedPrograms: readonly string[];
  approvedRoutePrograms: readonly string[];
  expectedEffects: readonly TrustedEffect[];
  expectedDestinations: readonly string[];
  reconciliationPostConditions: readonly string[];
}>;

const INTEGER = /^(0|[1-9]\d*)$/;
const HASH = /^[a-f0-9]{64}$/;
const trustedPolicies = new WeakSet<object>();

function amount(value: string, label: string): bigint {
  if (!INTEGER.test(value))
    throw new TypeError(`${label} must be a canonical integer string.`);
  const parsed = BigInt(value);
  if (parsed > C3_AMOUNTS.u64Max) throw new RangeError(`${label} exceeds u64.`);
  return parsed;
}

function exactArray(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return canonicalize(left) === canonicalize(right);
}

function validateIntent(intent: UserOperationIntent): void {
  const keys = Object.keys(intent).sort();
  const expectedKeys = [
    "idempotencyKey",
    "inputAmountBaseUnits",
    "intentId",
    "nowUnix",
    "operation",
    "slippageBps",
    "wallet",
  ];
  if (!exactArray(keys, expectedKeys))
    throw new Error("User intent contains an unauthorized policy override.");
  if (
    ![
      "seed_deposit",
      "deposit_intent",
      "rebalance_intent",
      "redemption_intent",
      "usdc_withdrawal",
      "emergency_pause",
    ].includes(intent.operation)
  )
    throw new Error("Unsupported operation type.");
  if (
    !/^c3-[a-f0-9]{32,64}$/.test(intent.intentId) ||
    !HASH.test(intent.idempotencyKey)
  )
    throw new Error("Intent identity is malformed.");
  publicKeyBytes(intent.wallet);
  const input = amount(intent.inputAmountBaseUnits, "input amount");
  if (
    ["seed_deposit", "deposit_intent"].includes(intent.operation) &&
    input < C3_AMOUNTS.minimumPurchaseUsdcBaseUnits
  )
    throw new Error("Controlled pilot minimum is 1 USDC.");
  if (input > C3_AMOUNTS.maximumPilotPurchaseUsdcBaseUnits)
    throw new Error("Controlled pilot maximum is 10 USDC.");
  if (
    !Number.isInteger(intent.slippageBps) ||
    intent.slippageBps < 0 ||
    intent.slippageBps > 100
  )
    throw new Error("Slippage exceeds immutable policy.");
  if (!Number.isSafeInteger(intent.nowUnix) || intent.nowUnix <= 0)
    throw new Error("Intent time is invalid.");
}

/** Policy derivation is server-side and excludes all caller-controlled authorization fields. */
export function deriveTrustedOperationPolicy(
  manifest: C3DeploymentManifest,
  intent: UserOperationIntent,
): TrustedOperationPolicy {
  assertExecutionDisabled();
  validateIntent(intent);
  const validation = validateDeploymentManifest(manifest);
  if (!validation.valid || validation.missingPublicInputs.length > 0)
    throw new Error("Verified deployment manifest is incomplete.");
  if (!["deployment_ready", "deployed", "paused"].includes(manifest.status))
    throw new Error(
      "Manifest lifecycle is not ready for trusted policy derivation.",
    );
  const root = manifest as Record<string, unknown>;
  const vaultConfig = root.vault as Record<string, unknown>;
  const operations = root.operationPolicies as
    Record<string, unknown> | undefined;
  const configured = operations?.[intent.operation] as
    Record<string, unknown> | undefined;
  if (!configured || configured.evidenceSource !== "reviewed-official")
    throw new Error("Reviewed operation policy evidence is unavailable.");
  const vault = String(vaultConfig.address);
  const shareMint = String(vaultConfig.shareMint);
  publicKeyBytes(vault);
  publicKeyBytes(shareMint);
  const policy = Object.freeze({
    policySchemaVersion: "c3-operation-policy/v2" as const,
    configurationVersion: manifest.schemaVersion,
    configurationHash: computeManifestHash(manifest),
    cluster: C3_MAINNET.cluster,
    genesisHash: C3_MAINNET.genesisHash,
    operation: intent.operation,
    wallet: intent.wallet,
    feePayer: intent.wallet,
    vault,
    shareMint,
    inputMint: C3_MAINNET.usdcMint,
    userInputTokenAccount: deriveAssociatedTokenAddress(
      intent.wallet,
      C3_MAINNET.usdcMint,
    ),
    vaultInputTokenAccount: deriveAssociatedTokenAddress(
      vault,
      C3_MAINNET.usdcMint,
    ),
    userShareTokenAccount: deriveAssociatedTokenAddress(
      intent.wallet,
      shareMint,
    ),
    inputAmountBaseUnits: intent.inputAmountBaseUnits,
    expectedOutputBaseUnits: String(configured.expectedOutputBaseUnits),
    minimumOutputBaseUnits: String(configured.minimumOutputBaseUnits),
    feeBaseUnits: "0" as const,
    bountyBaseUnits: String(configured.bountyBaseUnits),
    allowedPrograms: Object.freeze([
      ...(configured.allowedPrograms as string[]),
    ]),
    approvedRoutePrograms: Object.freeze([
      ...(configured.approvedRoutePrograms as string[]),
    ]),
    instructions: Object.freeze([
      ...(configured.instructions as TrustedInstructionPolicy[]),
    ]),
    expectedEffects: Object.freeze([
      ...(configured.expectedEffects as TrustedEffect[]),
    ]),
    expectedDestinations: Object.freeze([
      ...(configured.expectedDestinations as string[]),
    ]),
    reconciliationPostConditions: Object.freeze([
      ...(configured.reconciliationPostConditions as string[]),
    ]),
    quoteContextHash: String(configured.quoteContextHash),
    quoteObservedAtUnix: Number(configured.quoteObservedAtUnix),
    quoteExpiresAtUnix: Number(configured.quoteExpiresAtUnix),
    transactionExpiresAtUnix: Number(configured.transactionExpiresAtUnix),
    lastValidBlockHeight: Number(configured.lastValidBlockHeight),
    lookupTableContents: Object.freeze([
      ...(configured.lookupTableContents as LookupTableContents[]),
    ]),
    evidenceHash: String(configured.evidenceHash),
    evidenceSource: "reviewed-official" as const,
  });
  validateTrustedPolicy(policy, intent.nowUnix);
  trustedPolicies.add(policy);
  return policy;
}

export function validateTrustedPolicy(
  policy: TrustedOperationPolicy,
  nowUnix: number,
): void {
  if (policy.policySchemaVersion !== "c3-operation-policy/v2")
    throw new Error("Unsupported operation policy.");
  if (
    policy.cluster !== C3_MAINNET.cluster ||
    policy.genesisHash !== C3_MAINNET.genesisHash
  )
    throw new Error("Operation policy uses the wrong network.");
  for (const key of [
    policy.wallet,
    policy.feePayer,
    policy.vault,
    policy.shareMint,
  ])
    publicKeyBytes(key);
  if (
    policy.wallet !== policy.feePayer ||
    policy.inputMint !== C3_MAINNET.usdcMint
  )
    throw new Error("Signer, fee payer, or input mint policy mismatch.");
  if (
    policy.userInputTokenAccount !==
      deriveAssociatedTokenAddress(policy.wallet, policy.inputMint) ||
    policy.vaultInputTokenAccount !==
      deriveAssociatedTokenAddress(policy.vault, policy.inputMint) ||
    policy.userShareTokenAccount !==
      deriveAssociatedTokenAddress(policy.wallet, policy.shareMint)
  )
    throw new Error("Trusted token destinations are not canonical ATAs.");
  const input = amount(policy.inputAmountBaseUnits, "policy input");
  const expected = amount(
    policy.expectedOutputBaseUnits,
    "policy expected output",
  );
  const minimum = amount(
    policy.minimumOutputBaseUnits,
    "policy minimum output",
  );
  if (minimum > expected)
    throw new Error("Minimum output exceeds expected output.");
  if (
    policy.feeBaseUnits !== "0" ||
    C3_FEES.collectionEnabled ||
    C3_FEES.skrDiscountEnabled
  )
    throw new Error("Fees remain disabled until approvals exist.");
  if (
    !HASH.test(policy.configurationHash) ||
    !HASH.test(policy.quoteContextHash) ||
    !HASH.test(policy.evidenceHash)
  )
    throw new Error("Trusted policy hash evidence is malformed.");
  if (
    !Number.isSafeInteger(nowUnix) ||
    nowUnix < policy.quoteObservedAtUnix ||
    nowUnix >= policy.quoteExpiresAtUnix ||
    nowUnix >= policy.transactionExpiresAtUnix ||
    policy.quoteExpiresAtUnix - policy.quoteObservedAtUnix > 20
  )
    throw new Error("Trusted quote or transaction context is stale.");
  if (new Set(policy.allowedPrograms).size !== policy.allowedPrograms.length)
    throw new Error("Allowed programs contain duplicates.");
  if (policy.instructions.length === 0 || policy.expectedEffects.length === 0)
    throw new Error("Trusted policy lacks exact instructions or effects.");
  const debits = policy.expectedEffects
    .filter(
      (effect) =>
        effect.kind === "token_debit" &&
        effect.owner === policy.wallet &&
        effect.mint === policy.inputMint,
    )
    .reduce(
      (sum, effect) => sum + amount(effect.amountBaseUnits, "authorized debit"),
      0n,
    );
  if (debits > input)
    throw new Error("Trusted policy can debit more than the user approved.");
  for (const instruction of policy.instructions) {
    publicKeyBytes(instruction.programId);
    if (!policy.allowedPrograms.includes(instruction.programId))
      throw new Error("Trusted policy contains an unapproved program.");
    if (
      instruction.accountAddresses.length !== instruction.signerFlags.length ||
      instruction.accountAddresses.length !== instruction.writableFlags.length
    )
      throw new Error("Trusted instruction account metadata is inconsistent.");
    for (const account of instruction.accountAddresses) publicKeyBytes(account);
  }
}

export function validateCanonicalV0Transaction(
  policy: TrustedOperationPolicy,
  canonicalV0MessageBase64: string,
): DecodedV0Message {
  const decoded = decodeVersionedMessage(
    canonicalV0MessageBase64,
    policy.lookupTableContents,
  );
  if (decoded.wireBytes > 1_232)
    throw new Error("Transaction exceeds Solana's 1,232-byte limit.");
  const allAccounts = [...decoded.staticAccounts, ...decoded.loadedAccounts];
  const signers = allAccounts
    .filter((account) => account.signer)
    .map((account) => account.address);
  if (
    !exactArray(signers, [policy.wallet]) ||
    decoded.staticAccounts[0]?.address !== policy.feePayer
  )
    throw new Error("Connected user must be the only signer and fee payer.");
  const actual = decoded.instructions.map((instruction) => ({
    programId: instruction.programId,
    accountAddresses: instruction.accounts.map((account) => account.address),
    signerFlags: instruction.accounts.map((account) => account.signer),
    writableFlags: instruction.accounts.map((account) => account.writable),
    dataBase64: instruction.dataBase64,
  }));
  if (!exactArray(actual, policy.instructions))
    throw new Error(
      "Canonical v0 instructions do not exactly match trusted policy.",
    );
  if (
    actual.some(
      (instruction) => !policy.allowedPrograms.includes(instruction.programId),
    )
  )
    throw new Error("Canonical v0 message contains an unapproved program.");
  return decoded;
}

function authorizationPayload(
  intent: UserOperationIntent,
  policy: TrustedOperationPolicy,
  decoded: DecodedV0Message,
): Omit<C3AuthorizationManifest, "authorizationHash"> {
  return {
    schemaVersion: "c3-authorization/v2",
    executionCapability: C3_MAINNET_EXECUTION_CAPABILITY,
    configurationVersion: policy.configurationVersion,
    configurationHash: policy.configurationHash,
    cluster: policy.cluster,
    genesisHash: policy.genesisHash,
    operation: policy.operation,
    intentId: intent.intentId,
    idempotencyKey: intent.idempotencyKey,
    wallet: policy.wallet,
    vault: policy.vault,
    shareMint: policy.shareMint,
    inputMint: policy.inputMint,
    inputAmountBaseUnits: policy.inputAmountBaseUnits,
    expectedOutputBaseUnits: policy.expectedOutputBaseUnits,
    minimumOutputBaseUnits: policy.minimumOutputBaseUnits,
    feeBaseUnits: policy.feeBaseUnits,
    bountyBaseUnits: policy.bountyBaseUnits,
    slippageBps: intent.slippageBps,
    quoteContextHash: policy.quoteContextHash,
    quoteObservedAtUnix: policy.quoteObservedAtUnix,
    quoteExpiresAtUnix: policy.quoteExpiresAtUnix,
    transactionExpiresAtUnix: policy.transactionExpiresAtUnix,
    recentBlockhash: decoded.recentBlockhash,
    lastValidBlockHeight: policy.lastValidBlockHeight,
    canonicalV0MessageBase64: decoded.messageBase64,
    canonicalV0MessageHash: decoded.messageHash,
    wireBytes: decoded.wireBytes,
    staticAccounts: decoded.staticAccounts,
    loadedAccounts: decoded.loadedAccounts,
    compiledInstructions: decoded.instructions,
    lookupTables: decoded.lookupTables,
    allowedPrograms: policy.allowedPrograms,
    approvedRoutePrograms: policy.approvedRoutePrograms,
    expectedEffects: policy.expectedEffects,
    expectedDestinations: policy.expectedDestinations,
    reconciliationPostConditions: policy.reconciliationPostConditions,
  };
}

export function buildDisabledUnsignedPackage(
  intent: UserOperationIntent,
  policy: TrustedOperationPolicy,
  canonicalV0MessageBase64: string,
): C3AuthorizationManifest {
  assertExecutionDisabled();
  validateIntent(intent);
  if (!trustedPolicies.has(policy))
    throw new Error(
      "Operation policy was not derived by the trusted policy factory.",
    );
  if (
    intent.operation !== policy.operation ||
    intent.wallet !== policy.wallet ||
    intent.inputAmountBaseUnits !== policy.inputAmountBaseUnits
  )
    throw new Error("User intent does not match trusted operation policy.");
  validateTrustedPolicy(policy, intent.nowUnix);
  const decoded = validateCanonicalV0Transaction(
    policy,
    canonicalV0MessageBase64,
  );
  const payload = authorizationPayload(intent, policy, decoded);
  const authorizationHash = createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
  return Object.freeze({ ...payload, authorizationHash });
}

const AUTHORIZATION_KEYS = [
  "schemaVersion",
  "authorizationHash",
  "executionCapability",
  "configurationVersion",
  "configurationHash",
  "cluster",
  "genesisHash",
  "operation",
  "intentId",
  "idempotencyKey",
  "wallet",
  "vault",
  "shareMint",
  "inputMint",
  "inputAmountBaseUnits",
  "expectedOutputBaseUnits",
  "minimumOutputBaseUnits",
  "feeBaseUnits",
  "bountyBaseUnits",
  "slippageBps",
  "quoteContextHash",
  "quoteObservedAtUnix",
  "quoteExpiresAtUnix",
  "transactionExpiresAtUnix",
  "recentBlockhash",
  "lastValidBlockHeight",
  "canonicalV0MessageBase64",
  "canonicalV0MessageHash",
  "wireBytes",
  "staticAccounts",
  "loadedAccounts",
  "compiledInstructions",
  "lookupTables",
  "allowedPrograms",
  "approvedRoutePrograms",
  "expectedEffects",
  "expectedDestinations",
  "reconciliationPostConditions",
] as const;

export function parseAndVerifyAuthorizationManifest(
  rawCanonicalJson: string,
  nowUnix: number,
): C3AuthorizationManifest {
  let value: unknown;
  try {
    value = JSON.parse(rawCanonicalJson) as unknown;
  } catch {
    throw new Error("Authorization manifest JSON is malformed.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Authorization manifest must be an object.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== AUTHORIZATION_KEYS.length ||
    AUTHORIZATION_KEYS.some((key) => !(key in record)) ||
    Object.keys(record).some(
      (key) => !AUTHORIZATION_KEYS.includes(key as never),
    )
  )
    throw new Error("Authorization manifest keys are missing or unknown.");
  const hash = record.authorizationHash;
  const payload = { ...record };
  delete payload.authorizationHash;
  const expected = createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
  if (hash !== expected) throw new Error("Authorization hash mismatch.");
  if (rawCanonicalJson !== canonicalize(record))
    throw new Error(
      "Authorization JSON is not canonical or contains alternate encoding.",
    );
  const manifest = record as C3AuthorizationManifest;
  if (
    manifest.schemaVersion !== "c3-authorization/v2" ||
    manifest.executionCapability !== false ||
    manifest.cluster !== C3_MAINNET.cluster ||
    manifest.genesisHash !== C3_MAINNET.genesisHash ||
    nowUnix >= manifest.quoteExpiresAtUnix ||
    nowUnix >= manifest.transactionExpiresAtUnix
  )
    throw new Error(
      "Authorization manifest is unsupported, wrong-network, or expired.",
    );
  return Object.freeze(manifest);
}
