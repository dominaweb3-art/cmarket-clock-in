import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  C3_AMOUNTS,
  C3_FEES,
  C3_MAINNET,
  C3_MAINNET_EXECUTION_CAPABILITY,
  assertExecutionDisabled,
} from "./constants.ts";
import { canonicalize } from "./manifest.ts";
import { checkedMulDivFloorU64 } from "./math.ts";
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
  policySchemaVersion: "c3-operation-policy/v3";
  policyIdentifier: string;
  registryVersion: "c3-operation-registry/v1";
  configurationVersion: string;
  configurationHash: string;
  vaultIdentifier: string;
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
  bountyBaseUnits: "0";
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
}>;

export type AuthorizationContextRequest = Readonly<{
  policyIdentifier: string;
  operation: C3Operation;
  wallet: string;
  inputAmountBaseUnits: string;
  slippageBps: number;
}>;

type StoredAuthorizationContext = Readonly<{
  schemaVersion: "c3-authorization-context/v1";
  intentId: string;
  idempotencyKey: string;
  policyIdentifier: string;
  policyVersion: string;
  configurationVersion: string;
  vaultIdentifier: string;
  cluster: "mainnet-beta";
  operation: C3Operation;
  wallet: string;
  inputAmountBaseUnits: string;
  slippageBps: number;
  nonce: string;
  issuedAtUnix: number;
  expiresAtUnix: number;
  expectedAuthorizationHash?: string;
  expectedMessageHash?: string;
}>;

export type AuthorizationContextReceipt = Readonly<{
  intentId: string;
  policyIdentifier: string;
  issuedAtUnix: number;
  expiresAtUnix: number;
}>;

export type C3AuthorizationManifest = Readonly<{
  schemaVersion: "c3-authorization/v3";
  authorizationHash: string;
  executionCapability: false;
  intentId: string;
  idempotencyKey: string;
  policyIdentifier: string;
  policyVersion: string;
  configurationVersion: string;
  configurationHash: string;
  vaultIdentifier: string;
  cluster: "mainnet-beta";
  genesisHash: string;
  operation: C3Operation;
  wallet: string;
  vault: string;
  shareMint: string;
  inputMint: string;
  inputAmountBaseUnits: string;
  expectedOutputBaseUnits: string;
  minimumOutputBaseUnits: string;
  feeBaseUnits: "0";
  bountyBaseUnits: "0";
  slippageBps: number;
  nonce: string;
  issuedAtUnix: number;
  expiresAtUnix: number;
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

type PolicyRegistryEntry = Readonly<{
  policyIdentifier: string;
  policyVersion: string;
  configurationVersion: string;
  vaultIdentifier: string;
  operation: C3Operation;
  enabled: boolean;
  validUntilUnix: number;
}>;

const INTEGER = /^(0|[1-9]\d*)$/;
const HASH = /^[a-f0-9]{64}$/;
const POLICY_IDENTIFIER = "c3.deposit-intent.disabled-validation.v1";
const REGISTRY_VERSION = "c3-operation-registry/v1" as const;
const VAULT_IDENTIFIER = "c3-symmetry-mainnet-candidate-v1";
const CONFIGURATION_VERSION = "c3-mainnet-disabled/v1";
const CONFIGURATION_HASH = createHash("sha256")
  .update(
    canonicalize({
      registryVersion: REGISTRY_VERSION,
      vaultIdentifier: VAULT_IDENTIFIER,
      allocationBps: [4000, 3000, 3000],
      minimumPurchaseUsdcBaseUnits: "1000000",
      executionCapability: false,
    }),
  )
  .digest("hex");

const POLICY_REGISTRY: ReadonlyMap<string, PolicyRegistryEntry> = new Map([
  [
    POLICY_IDENTIFIER,
    Object.freeze({
      policyIdentifier: POLICY_IDENTIFIER,
      policyVersion: "1",
      configurationVersion: CONFIGURATION_VERSION,
      vaultIdentifier: VAULT_IDENTIFIER,
      operation: "deposit_intent" as const,
      enabled: true,
      validUntilUnix: 4_102_444_800,
    }),
  ],
]);

const authorizationContexts = new Map<string, StoredAuthorizationContext>();
const authorizationRecords = new Map<
  string,
  Readonly<{ canonicalJson: string; expectedHash: string }>
>();

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

function resolvePolicyEntry(
  policyIdentifier: string,
  operation: C3Operation,
  nowUnix: number,
): PolicyRegistryEntry {
  const entry = POLICY_REGISTRY.get(policyIdentifier);
  if (!entry) throw new Error("Unknown server operation policy identifier.");
  if (!entry.enabled) throw new Error("Server operation policy is disabled.");
  if (entry.operation !== operation)
    throw new Error("Operation does not match the server policy registry.");
  if (nowUnix >= entry.validUntilUnix)
    throw new Error("Server operation policy is stale.");
  return entry;
}

function validateContextRequest(request: AuthorizationContextRequest): bigint {
  const expected = [
    "inputAmountBaseUnits",
    "operation",
    "policyIdentifier",
    "slippageBps",
    "wallet",
  ];
  if (!exactArray(Object.keys(request).sort(), expected))
    throw new Error("Authorization request contains an unauthorized field.");
  publicKeyBytes(request.wallet);
  const input = amount(request.inputAmountBaseUnits, "input amount");
  if (
    request.operation === "deposit_intent" &&
    input < C3_AMOUNTS.minimumPurchaseUsdcBaseUnits
  )
    throw new Error("Controlled pilot minimum is 1 USDC.");
  if (input > C3_AMOUNTS.maximumPilotPurchaseUsdcBaseUnits)
    throw new Error("Controlled pilot maximum is 10 USDC.");
  if (
    !Number.isInteger(request.slippageBps) ||
    request.slippageBps < 0 ||
    request.slippageBps > 100
  )
    throw new Error("Slippage exceeds immutable policy.");
  return input;
}

export function createAuthorizationContext(
  request: AuthorizationContextRequest,
): AuthorizationContextReceipt {
  assertExecutionDisabled();
  validateContextRequest(request);
  const issuedAtUnix = Math.floor(Date.now() / 1_000);
  const entry = resolvePolicyEntry(
    request.policyIdentifier,
    request.operation,
    issuedAtUnix,
  );
  const intentId = `c3-${randomBytes(24).toString("hex")}`;
  const nonce = randomBytes(32).toString("hex");
  const idempotencyKey = createHash("sha256")
    .update(`${intentId}:${nonce}`)
    .digest("hex");
  const context: StoredAuthorizationContext = Object.freeze({
    schemaVersion: "c3-authorization-context/v1",
    intentId,
    idempotencyKey,
    policyIdentifier: entry.policyIdentifier,
    policyVersion: entry.policyVersion,
    configurationVersion: entry.configurationVersion,
    vaultIdentifier: entry.vaultIdentifier,
    cluster: C3_MAINNET.cluster,
    operation: request.operation,
    wallet: request.wallet,
    inputAmountBaseUnits: request.inputAmountBaseUnits,
    slippageBps: request.slippageBps,
    nonce,
    issuedAtUnix,
    expiresAtUnix: issuedAtUnix + 50,
  });
  authorizationContexts.set(intentId, context);
  return Object.freeze({
    intentId,
    policyIdentifier: entry.policyIdentifier,
    issuedAtUnix: context.issuedAtUnix,
    expiresAtUnix: context.expiresAtUnix,
  });
}

function loadContext(
  intentId: string,
  nowUnix: number,
): StoredAuthorizationContext {
  const context = authorizationContexts.get(intentId);
  if (!context) throw new Error("Trusted authorization context is missing.");
  if (!Number.isSafeInteger(nowUnix) || nowUnix < context.issuedAtUnix)
    throw new Error("Authorization verification time is invalid.");
  if (nowUnix >= context.expiresAtUnix)
    throw new Error("Trusted authorization context is expired.");
  return context;
}

function deriveRegisteredPolicy(
  context: StoredAuthorizationContext,
): TrustedOperationPolicy {
  const entry = resolvePolicyEntry(
    context.policyIdentifier,
    context.operation,
    context.issuedAtUnix,
  );
  const input = amount(context.inputAmountBaseUnits, "context input");
  const minimum = checkedMulDivFloorU64(
    input,
    BigInt(10_000 - context.slippageBps),
    10_000n,
    "authorization minimum output",
  );
  const wallet = context.wallet;
  const vault = C3_MAINNET.symmetryGlobalConfig;
  const shareMint = C3_MAINNET.portalEthMint;
  const userInputTokenAccount = deriveAssociatedTokenAddress(
    wallet,
    C3_MAINNET.usdcMint,
  );
  const vaultInputTokenAccount = deriveAssociatedTokenAddress(
    vault,
    C3_MAINNET.usdcMint,
  );
  const userShareTokenAccount = deriveAssociatedTokenAddress(wallet, shareMint);
  const expectedEffects: TrustedEffect[] = [
    {
      kind: "token_debit",
      owner: wallet,
      mint: C3_MAINNET.usdcMint,
      amountBaseUnits: context.inputAmountBaseUnits,
      tokenAccount: userInputTokenAccount,
    },
    {
      kind: "token_credit",
      owner: vault,
      mint: C3_MAINNET.usdcMint,
      amountBaseUnits: context.inputAmountBaseUnits,
      tokenAccount: vaultInputTokenAccount,
    },
    {
      kind: "share_mint",
      owner: wallet,
      mint: shareMint,
      amountBaseUnits: context.inputAmountBaseUnits,
      tokenAccount: userShareTokenAccount,
    },
  ];
  expectedEffects.sort((left, right) =>
    left.tokenAccount.localeCompare(right.tokenAccount),
  );
  const instruction: TrustedInstructionPolicy = Object.freeze({
    programId: C3_MAINNET.symmetryProgram,
    accountAddresses: Object.freeze([
      wallet,
      userInputTokenAccount,
      vaultInputTokenAccount,
      userShareTokenAccount,
      C3_MAINNET.usdcMint,
      shareMint,
    ]),
    signerFlags: Object.freeze([true, false, false, false, false, false]),
    writableFlags: Object.freeze([true, true, true, true, false, false]),
    dataBase64: Buffer.from(Uint8Array.of(1, 2, 3, 4)).toString("base64"),
  });
  return Object.freeze({
    policySchemaVersion: "c3-operation-policy/v3",
    policyIdentifier: entry.policyIdentifier,
    registryVersion: REGISTRY_VERSION,
    configurationVersion: entry.configurationVersion,
    configurationHash: CONFIGURATION_HASH,
    vaultIdentifier: entry.vaultIdentifier,
    cluster: C3_MAINNET.cluster,
    genesisHash: C3_MAINNET.genesisHash,
    operation: context.operation,
    wallet,
    feePayer: wallet,
    vault,
    shareMint,
    inputMint: C3_MAINNET.usdcMint,
    userInputTokenAccount,
    vaultInputTokenAccount,
    userShareTokenAccount,
    inputAmountBaseUnits: context.inputAmountBaseUnits,
    expectedOutputBaseUnits: context.inputAmountBaseUnits,
    minimumOutputBaseUnits: minimum.toString(),
    feeBaseUnits: "0",
    bountyBaseUnits: "0",
    allowedPrograms: Object.freeze([C3_MAINNET.symmetryProgram]),
    approvedRoutePrograms: Object.freeze([]),
    instructions: Object.freeze([instruction]),
    expectedEffects: Object.freeze(expectedEffects),
    expectedDestinations: Object.freeze([
      vaultInputTokenAccount,
      userShareTokenAccount,
    ]),
    reconciliationPostConditions: Object.freeze([
      "vault USDC credited",
      "user C3 shares credited",
    ]),
    quoteContextHash: createHash("sha256")
      .update(`${context.intentId}:${context.nonce}:disabled-quote`)
      .digest("hex"),
    quoteObservedAtUnix: context.issuedAtUnix,
    quoteExpiresAtUnix: context.issuedAtUnix + 20,
    transactionExpiresAtUnix: context.expiresAtUnix,
    lastValidBlockHeight: 1,
    lookupTableContents: Object.freeze([]),
  });
}

function validateTrustedPolicy(
  policy: TrustedOperationPolicy,
  nowUnix: number,
): void {
  if (
    policy.policySchemaVersion !== "c3-operation-policy/v3" ||
    policy.registryVersion !== REGISTRY_VERSION
  )
    throw new Error("Unsupported server operation policy.");
  if (
    policy.cluster !== C3_MAINNET.cluster ||
    policy.genesisHash !== C3_MAINNET.genesisHash
  )
    throw new Error("Operation policy uses the wrong network.");
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
  const minimum = amount(
    policy.minimumOutputBaseUnits,
    "policy minimum output",
  );
  if (
    minimum > amount(policy.expectedOutputBaseUnits, "policy expected output")
  )
    throw new Error("Minimum output exceeds expected output.");
  if (
    policy.feeBaseUnits !== "0" ||
    C3_FEES.collectionEnabled ||
    C3_FEES.skrDiscountEnabled
  )
    throw new Error("Fees remain disabled until approvals exist.");
  if (
    !HASH.test(policy.configurationHash) ||
    !HASH.test(policy.quoteContextHash)
  )
    throw new Error("Server policy hash evidence is malformed.");
  if (
    nowUnix < policy.quoteObservedAtUnix ||
    nowUnix >= policy.quoteExpiresAtUnix ||
    nowUnix >= policy.transactionExpiresAtUnix
  )
    throw new Error("Server quote or transaction context is stale.");
  const debits = policy.expectedEffects
    .filter(
      (effect) =>
        effect.kind === "token_debit" &&
        effect.owner === policy.wallet &&
        effect.mint === policy.inputMint,
    )
    .reduce((sum, effect) => sum + amount(effect.amountBaseUnits, "debit"), 0n);
  if (debits !== input)
    throw new Error("Server policy debit differs from the approved amount.");
  for (const instruction of policy.instructions) {
    if (!policy.allowedPrograms.includes(instruction.programId))
      throw new Error("Server policy contains an unapproved program.");
    if (
      instruction.accountAddresses.length !== instruction.signerFlags.length ||
      instruction.accountAddresses.length !== instruction.writableFlags.length
    )
      throw new Error("Server instruction account metadata is inconsistent.");
  }
}

function validateCanonicalV0Transaction(
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
    throw new Error("Canonical v0 instructions differ from the sealed policy.");
  return decoded;
}

function authorizationPayload(
  context: StoredAuthorizationContext,
  policy: TrustedOperationPolicy,
  decoded: DecodedV0Message,
): Omit<C3AuthorizationManifest, "authorizationHash"> {
  return {
    schemaVersion: "c3-authorization/v3",
    executionCapability: C3_MAINNET_EXECUTION_CAPABILITY,
    intentId: context.intentId,
    idempotencyKey: context.idempotencyKey,
    policyIdentifier: context.policyIdentifier,
    policyVersion: context.policyVersion,
    configurationVersion: context.configurationVersion,
    configurationHash: policy.configurationHash,
    vaultIdentifier: context.vaultIdentifier,
    cluster: context.cluster,
    genesisHash: policy.genesisHash,
    operation: context.operation,
    wallet: context.wallet,
    vault: policy.vault,
    shareMint: policy.shareMint,
    inputMint: policy.inputMint,
    inputAmountBaseUnits: context.inputAmountBaseUnits,
    expectedOutputBaseUnits: policy.expectedOutputBaseUnits,
    minimumOutputBaseUnits: policy.minimumOutputBaseUnits,
    feeBaseUnits: policy.feeBaseUnits,
    bountyBaseUnits: policy.bountyBaseUnits,
    slippageBps: context.slippageBps,
    nonce: context.nonce,
    issuedAtUnix: context.issuedAtUnix,
    expiresAtUnix: context.expiresAtUnix,
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
  intentId: string,
  canonicalV0MessageBase64: string,
  nowUnix: number,
): C3AuthorizationManifest {
  assertExecutionDisabled();
  const context = loadContext(intentId, nowUnix);
  const policy = deriveRegisteredPolicy(context);
  validateTrustedPolicy(policy, nowUnix);
  const decoded = validateCanonicalV0Transaction(
    policy,
    canonicalV0MessageBase64,
  );
  const payload = authorizationPayload(context, policy, decoded);
  const authorizationHash = createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
  if (
    context.expectedAuthorizationHash &&
    context.expectedAuthorizationHash !== authorizationHash
  )
    throw new Error(
      "Immutable authorization context already binds another message.",
    );
  authorizationContexts.set(
    intentId,
    Object.freeze({
      ...context,
      expectedAuthorizationHash: authorizationHash,
      expectedMessageHash: decoded.messageHash,
    }),
  );
  const manifest = { ...payload, authorizationHash };
  const canonicalJson = canonicalize(manifest);
  const previous = authorizationRecords.get(intentId);
  if (previous && previous.canonicalJson !== canonicalJson)
    throw new Error("Authorization replacement is forbidden.");
  authorizationRecords.set(
    intentId,
    Object.freeze({ canonicalJson, expectedHash: authorizationHash }),
  );
  return structuredClone(manifest);
}

function safeHashEqual(left: string, right: string): boolean {
  if (!HASH.test(left) || !HASH.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function loadAuthorizationRecord(
  intentId: string,
): C3AuthorizationManifest {
  const context = authorizationContexts.get(intentId);
  if (!context) throw new Error("Trusted authorization context is missing.");
  if (!context.expectedAuthorizationHash || !context.expectedMessageHash)
    throw new Error(
      "Expected authorization hash is absent from trusted storage.",
    );
  const stored = authorizationRecords.get(intentId);
  if (!stored) throw new Error("Canonical authorization record is missing.");
  let value: unknown;
  try {
    value = JSON.parse(stored.canonicalJson) as unknown;
  } catch {
    throw new Error("Authorization manifest JSON is malformed.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Authorization manifest must be an object.");
  const record = value as Record<string, unknown>;
  if (stored.canonicalJson !== canonicalize(record))
    throw new Error("Authorization JSON is not canonical.");
  const suppliedHash = String(record.authorizationHash ?? "");
  const payload = { ...record };
  delete payload.authorizationHash;
  const recomputedHash = createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
  if (
    !safeHashEqual(suppliedHash, recomputedHash) ||
    !safeHashEqual(suppliedHash, context.expectedAuthorizationHash) ||
    !safeHashEqual(suppliedHash, stored.expectedHash)
  )
    throw new Error("Authorization hash does not match trusted storage.");
  const manifest = record as C3AuthorizationManifest;
  const immutableContext = {
    intentId: manifest.intentId,
    idempotencyKey: manifest.idempotencyKey,
    policyIdentifier: manifest.policyIdentifier,
    policyVersion: manifest.policyVersion,
    configurationVersion: manifest.configurationVersion,
    vaultIdentifier: manifest.vaultIdentifier,
    cluster: manifest.cluster,
    operation: manifest.operation,
    wallet: manifest.wallet,
    inputAmountBaseUnits: manifest.inputAmountBaseUnits,
    slippageBps: manifest.slippageBps,
    nonce: manifest.nonce,
    issuedAtUnix: manifest.issuedAtUnix,
    expiresAtUnix: manifest.expiresAtUnix,
  };
  const expectedContext = {
    intentId: context.intentId,
    idempotencyKey: context.idempotencyKey,
    policyIdentifier: context.policyIdentifier,
    policyVersion: context.policyVersion,
    configurationVersion: context.configurationVersion,
    vaultIdentifier: context.vaultIdentifier,
    cluster: context.cluster,
    operation: context.operation,
    wallet: context.wallet,
    inputAmountBaseUnits: context.inputAmountBaseUnits,
    slippageBps: context.slippageBps,
    nonce: context.nonce,
    issuedAtUnix: context.issuedAtUnix,
    expiresAtUnix: context.expiresAtUnix,
  };
  if (canonicalize(immutableContext) !== canonicalize(expectedContext))
    throw new Error("Authorization fields differ from trusted intent context.");
  if (
    manifest.schemaVersion !== "c3-authorization/v3" ||
    manifest.executionCapability !== false ||
    manifest.genesisHash !== C3_MAINNET.genesisHash ||
    manifest.canonicalV0MessageHash !== context.expectedMessageHash
  )
    throw new Error(
      "Authorization is unsupported, mutated, wrong-network, or expired.",
    );
  const messageBytes = Buffer.from(manifest.canonicalV0MessageBase64, "base64");
  if (
    messageBytes.toString("base64") !== manifest.canonicalV0MessageBase64 ||
    createHash("sha256").update(messageBytes).digest("hex") !==
      manifest.canonicalV0MessageHash
  )
    throw new Error("Stored unsigned message hash is inconsistent.");
  return structuredClone(manifest);
}

export function operationPolicyRegistryStatus(): Readonly<{
  registryVersion: string;
  policyIdentifiers: readonly string[];
  executionCapability: false;
}> {
  return Object.freeze({
    registryVersion: REGISTRY_VERSION,
    policyIdentifiers: Object.freeze([...POLICY_REGISTRY.keys()]),
    executionCapability: false,
  });
}

export function authorizationContextRepositoryStatus(): Readonly<{
  repositoryVersion: "c3-authorization-context-repository/v1";
  durable: false;
  productionReady: false;
}> {
  return Object.freeze({
    repositoryVersion: "c3-authorization-context-repository/v1",
    durable: false,
    productionReady: false,
  });
}
