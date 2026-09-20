import { createHash } from "node:crypto";

import {
  C3_AMOUNTS,
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

export type C3Operation =
  | "squads_create"
  | "vault_initialize"
  | "share_mint_initialize"
  | "vault_configure"
  | "seed_deposit"
  | "deposit_intent"
  | "share_issue"
  | "rebalance_intent"
  | "redemption_intent"
  | "usdc_withdrawal"
  | "emergency_pause";

export type SemanticAccount = Readonly<{
  address: string;
  role: string;
  signer: boolean;
  writable: boolean;
}>;

export type SemanticInstruction = Readonly<{
  programId: string;
  kind: string;
  accounts: readonly SemanticAccount[];
  dataFingerprint: string;
  tokenDebit?: Readonly<{
    owner: string;
    mint: string;
    amountBaseUnits: string;
  }>;
  tokenCredit?: Readonly<{
    owner: string;
    mint: string;
    amountBaseUnits: string;
  }>;
  systemTransfer?: Readonly<{
    source: string;
    destination: string;
    lamports: string;
  }>;
  closeAccount?: Readonly<{
    account: string;
    refundDestination: string;
    expectedEphemeralWsol: boolean;
  }>;
}>;

export type LookupTableEvidence = Readonly<{
  address: string;
  ownerProgram: string;
  active: boolean;
  addressesFingerprint: string;
  approvedFingerprint: string;
}>;

export type TokenEffectRule = Readonly<{
  owner: string;
  mint: string;
  minimumAmountBaseUnits: string;
  maximumAmountBaseUnits: string;
}>;

export type UnsignedBuildRequest = Readonly<{
  operation: C3Operation;
  intentId: string;
  idempotencyKey: string;
  configurationVersion: string;
  manifest: C3DeploymentManifest;
  wallet: string;
  feePayer: string;
  vault: string;
  inputMint: string;
  inputAmountBaseUnits: string;
  expectedShareOutputBaseUnits: string;
  minimumShareOutputBaseUnits: string;
  feeBaseUnits: string;
  bountyBaseUnits: string;
  networkAndRentEstimateBaseUnits: string;
  expiresAtUnix: number;
  quoteObservedAtUnix: number;
  quoteExpiresAtUnix: number;
  blockhashExpiresAtUnix: number;
  nowUnix: number;
  expectedSigners: readonly string[];
  expectedWritableAccounts: readonly string[];
  expectedDestinations: readonly string[];
  allowedInstructionKinds: readonly string[];
  approvedRoutePrograms: readonly string[];
  expectedTokenDebits: readonly TokenEffectRule[];
  expectedTokenCredits: readonly TokenEffectRule[];
  expectedClosableAccounts: readonly string[];
  instructions: readonly SemanticInstruction[];
  lookupTables: readonly LookupTableEvidence[];
  estimatedTransactionBytes: number;
  expectedPostConditions: readonly string[];
  reconciliationRequirements: readonly string[];
}>;

export type C3AuthorizationManifest = Readonly<{
  schemaVersion: "c3-authorization/v1";
  executionCapability: false;
  operation: C3Operation;
  intentId: string;
  idempotencyKey: string;
  configurationVersion: string;
  configurationHash: string;
  wallet: string;
  cluster: "mainnet-beta";
  expiry: number;
  inputAsset: string;
  inputAmountBaseUnits: string;
  expectedShareOutputBaseUnits: string;
  minimumShareOutputBaseUnits: string;
  feeBaseUnits: string;
  bountyBaseUnits: string;
  networkAndRentEstimateBaseUnits: string;
  vault: string;
  programs: readonly string[];
  accounts: readonly SemanticAccount[];
  signers: readonly string[];
  feePayer: string;
  allowedInstructions: readonly Readonly<{
    programId: string;
    kind: string;
    dataFingerprint: string;
  }>[];
  allowedRoutes: readonly string[];
  expectedDestinations: readonly string[];
  expectedTokenDebits: readonly TokenEffectRule[];
  expectedTokenCredits: readonly TokenEffectRule[];
  expectedClosableAccounts: readonly string[];
  expectedPostConditions: readonly string[];
  reconciliationRequirements: readonly string[];
  unsignedTransactionFingerprint: string;
}>;

const OPERATION_PROGRAM_KEYS: Readonly<Record<C3Operation, readonly string[]>> =
  Object.freeze({
    squads_create: ["squads"],
    vault_initialize: ["symmetry", "system", "token"],
    share_mint_initialize: ["symmetry", "system", "token"],
    vault_configure: ["symmetry"],
    seed_deposit: ["symmetry", "token", "associatedToken"],
    deposit_intent: ["symmetry", "token", "associatedToken"],
    share_issue: ["symmetry", "token"],
    rebalance_intent: [
      "symmetry",
      "jupiter",
      "token",
      "associatedToken",
      "computeBudget",
    ],
    redemption_intent: ["symmetry", "token"],
    usdc_withdrawal: ["symmetry", "token", "associatedToken"],
    emergency_pause: ["symmetry", "squads"],
  });

const PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INTEGER = /^(0|[1-9]\d*)$/;

function amount(value: string, label: string): bigint {
  if (!INTEGER.test(value))
    throw new TypeError(`${label} must be an integer base-unit string.`);
  const parsed = BigInt(value);
  if (parsed > C3_AMOUNTS.u64Max) throw new RangeError(`${label} exceeds u64.`);
  return parsed;
}

function equalSets(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function validateEffectRules(
  rules: readonly TokenEffectRule[],
  label: string,
): void {
  const identities = new Set<string>();
  for (const rule of rules) {
    if (!PUBLIC_KEY.test(rule.owner) || !PUBLIC_KEY.test(rule.mint))
      throw new Error(`${label} rule contains malformed public key.`);
    const minimum = amount(rule.minimumAmountBaseUnits, `${label} minimum`);
    const maximum = amount(rule.maximumAmountBaseUnits, `${label} maximum`);
    if (minimum > maximum) throw new Error(`${label} rule range is invalid.`);
    const identity = `${rule.owner}:${rule.mint}`;
    if (identities.has(identity))
      throw new Error(`${label} rules contain a duplicate owner/mint pair.`);
    identities.add(identity);
  }
}

function consumeEffectRule(
  remaining: TokenEffectRule[],
  effect: Readonly<{ owner: string; mint: string; amountBaseUnits: string }>,
  label: string,
): void {
  const value = amount(effect.amountBaseUnits, label);
  const index = remaining.findIndex(
    (rule) => rule.owner === effect.owner && rule.mint === effect.mint,
  );
  if (index < 0) throw new Error(`Unexpected ${label}.`);
  const rule = remaining[index]!;
  if (
    value < amount(rule.minimumAmountBaseUnits, `${label} minimum`) ||
    value > amount(rule.maximumAmountBaseUnits, `${label} maximum`)
  )
    throw new Error(`${label} is outside its authorized range.`);
  remaining.splice(index, 1);
}

export function buildDisabledUnsignedPackage(
  request: UnsignedBuildRequest,
): C3AuthorizationManifest {
  assertExecutionDisabled();
  if (
    request.manifest.executionCapability !== false ||
    C3_MAINNET_EXECUTION_CAPABILITY !== false
  )
    throw new Error("Mainnet capability must remain disabled.");
  if (
    request.manifest.cluster !== C3_MAINNET.cluster ||
    request.manifest.genesisHash !== C3_MAINNET.genesisHash
  )
    throw new Error("Wrong Mainnet identity.");
  const configurationHash = computeManifestHash(request.manifest);
  if (configurationHash !== request.manifest.immutableConfigurationHash)
    throw new Error("Configuration hash mismatch.");
  const manifestValidation = validateDeploymentManifest(request.manifest);
  if (!manifestValidation.valid)
    throw new Error("Deployment manifest failed strict validation.");
  if (
    !/^c3-[a-f0-9]{32,64}$/.test(request.intentId) ||
    !/^[a-f0-9]{64}$/.test(request.idempotencyKey)
  )
    throw new Error("Intent identity is malformed.");
  if (
    !PUBLIC_KEY.test(request.wallet) ||
    !PUBLIC_KEY.test(request.feePayer) ||
    request.wallet !== request.feePayer
  )
    throw new Error("Connected user must be the fee payer.");
  if (!PUBLIC_KEY.test(request.vault)) throw new Error("Vault is unresolved.");
  if (
    request.nowUnix >= request.expiresAtUnix ||
    request.nowUnix >= request.quoteExpiresAtUnix ||
    request.nowUnix >= request.blockhashExpiresAtUnix
  )
    throw new Error("Quote, intent, or blockhash is stale.");
  if (
    request.quoteObservedAtUnix > request.nowUnix ||
    request.nowUnix - request.quoteObservedAtUnix > 20
  )
    throw new Error("Quote freshness exceeds policy.");
  if (
    !Number.isInteger(request.estimatedTransactionBytes) ||
    request.estimatedTransactionBytes <= 0 ||
    request.estimatedTransactionBytes > 1_232
  )
    throw new Error("Transaction exceeds the 1,232-byte packet limit.");
  const input = amount(request.inputAmountBaseUnits, "input amount");
  if (
    (request.operation === "deposit_intent" ||
      request.operation === "seed_deposit") &&
    input < C3_AMOUNTS.minimumPurchaseUsdcBaseUnits
  )
    throw new Error("Deposit is below 1 USDC.");
  const expectedShares = amount(
    request.expectedShareOutputBaseUnits,
    "expected shares",
  );
  const minimumShares = amount(
    request.minimumShareOutputBaseUnits,
    "minimum shares",
  );
  if (minimumShares > expectedShares)
    throw new Error("Minimum shares exceed expected shares.");
  amount(request.feeBaseUnits, "fee");
  amount(request.bountyBaseUnits, "bounty");
  amount(request.networkAndRentEstimateBaseUnits, "network and rent estimate");

  const programs = request.manifest.programs as Record<string, unknown>;
  const allowedProgramIds = new Set(
    OPERATION_PROGRAM_KEYS[request.operation]
      .map((key) => programs[key])
      .filter((value): value is string => typeof value === "string"),
  );
  if (
    allowedProgramIds.size !== OPERATION_PROGRAM_KEYS[request.operation].length
  )
    throw new Error("Operation requires an unresolved or unapproved program.");
  const expectedSignerSet = new Set(request.expectedSigners);
  const writableSet = new Set(request.expectedWritableAccounts);
  const destinationSet = new Set(request.expectedDestinations);
  const instructionKindSet = new Set(request.allowedInstructionKinds);
  const routeSet = new Set(request.approvedRoutePrograms);
  const closableSet = new Set(request.expectedClosableAccounts);
  if (
    !expectedSignerSet.has(request.wallet) ||
    request.expectedSigners.some((signer) => !PUBLIC_KEY.test(signer))
  )
    throw new Error("Expected signer set is invalid.");
  if (routeSet.size !== request.approvedRoutePrograms.length)
    throw new Error("Route registry contains duplicates.");
  if (
    instructionKindSet.size === 0 ||
    instructionKindSet.size !== request.allowedInstructionKinds.length ||
    request.allowedInstructionKinds.some(
      (kind) => !/^[a-z][a-z0-9_]*$/.test(kind),
    )
  )
    throw new Error("Instruction-kind allowlist is invalid.");
  if (
    closableSet.size !== request.expectedClosableAccounts.length ||
    request.expectedClosableAccounts.some(
      (account) => !PUBLIC_KEY.test(account),
    )
  )
    throw new Error("Closable-account allowlist is invalid.");
  validateEffectRules(request.expectedTokenDebits, "token debit");
  validateEffectRules(request.expectedTokenCredits, "token credit");
  const maximumAuthorizedDebit = request.expectedTokenDebits.reduce(
    (total, rule) => {
      if (rule.owner !== request.wallet || rule.mint !== request.inputMint)
        throw new Error("Token-debit rule is outside the user input boundary.");
      return total + amount(rule.maximumAmountBaseUnits, "token debit maximum");
    },
    0n,
  );
  if (maximumAuthorizedDebit > input)
    throw new Error("Authorized token debits exceed the approved input.");
  if (
    request.expectedTokenCredits.some((rule) => !destinationSet.has(rule.owner))
  )
    throw new Error("Token-credit rule has an unauthorized destination.");
  for (const route of routeSet)
    if (!PUBLIC_KEY.test(route))
      throw new Error("Route registry contains malformed program.");

  const allAccounts: SemanticAccount[] = [];
  const actualSigners = new Set<string>();
  const actualWritableAccounts = new Set<string>();
  const remainingDebits = [...request.expectedTokenDebits];
  const remainingCredits = [...request.expectedTokenCredits];
  for (const instruction of request.instructions) {
    if (!allowedProgramIds.has(instruction.programId))
      throw new Error(`Unknown program for ${request.operation}.`);
    if (!/^[a-f0-9]{64}$/.test(instruction.dataFingerprint))
      throw new Error("Instruction data fingerprint is malformed.");
    if (!instructionKindSet.has(instruction.kind))
      throw new Error("Unknown instruction kind.");
    for (const account of instruction.accounts) {
      if (!PUBLIC_KEY.test(account.address))
        throw new Error("Instruction account is malformed.");
      if (account.signer && !expectedSignerSet.has(account.address))
        throw new Error("Unexpected signer.");
      if (account.writable && !writableSet.has(account.address))
        throw new Error("Unexpected writable account.");
      if (account.signer) actualSigners.add(account.address);
      if (account.writable) actualWritableAccounts.add(account.address);
      allAccounts.push(account);
    }
    if (instruction.tokenDebit) {
      if (
        instruction.tokenDebit.mint !== request.inputMint ||
        instruction.tokenDebit.owner !== request.wallet
      )
        throw new Error("Unexpected token debit.");
      consumeEffectRule(remainingDebits, instruction.tokenDebit, "token debit");
    }
    if (instruction.tokenCredit) {
      if (!destinationSet.has(instruction.tokenCredit.owner))
        throw new Error("Unexpected token destination.");
      consumeEffectRule(
        remainingCredits,
        instruction.tokenCredit,
        "token credit",
      );
    }
    if (instruction.systemTransfer) throw new Error("Unexpected SOL transfer.");
    if (
      instruction.closeAccount &&
      (!instruction.closeAccount.expectedEphemeralWsol ||
        !closableSet.has(instruction.closeAccount.account) ||
        instruction.closeAccount.refundDestination !== request.wallet)
    )
      throw new Error("Unsafe close-account instruction.");
  }
  if (!equalSets(actualSigners, expectedSignerSet))
    throw new Error("Actual signer set does not exactly match authorization.");
  if (!equalSets(actualWritableAccounts, writableSet))
    throw new Error(
      "Actual writable-account set does not exactly match authorization.",
    );
  if (remainingDebits.length > 0 || remainingCredits.length > 0)
    throw new Error("Expected token effects are missing.");
  for (const table of request.lookupTables) {
    if (
      !PUBLIC_KEY.test(table.address) ||
      table.ownerProgram !== C3_MAINNET.addressLookupTableProgram ||
      !table.active ||
      !/^[a-f0-9]{64}$/.test(table.addressesFingerprint) ||
      table.addressesFingerprint !== table.approvedFingerprint
    )
      throw new Error("Unauthorized address lookup table.");
  }
  if (request.instructions.length === 0)
    throw new Error("Unsigned package cannot omit decoded instructions.");
  if (
    request.expectedPostConditions.length === 0 ||
    request.reconciliationRequirements.length < 2
  )
    throw new Error(
      "Post-conditions and independent reconciliation are mandatory.",
    );
  const fingerprint = createHash("sha256")
    .update(
      canonicalize({
        instructions: request.instructions,
        lookupTables: request.lookupTables,
        estimatedTransactionBytes: request.estimatedTransactionBytes,
      }),
    )
    .digest("hex");
  return Object.freeze({
    schemaVersion: "c3-authorization/v1",
    executionCapability: false,
    operation: request.operation,
    intentId: request.intentId,
    idempotencyKey: request.idempotencyKey,
    configurationVersion: request.configurationVersion,
    configurationHash,
    wallet: request.wallet,
    cluster: C3_MAINNET.cluster,
    expiry: request.expiresAtUnix,
    inputAsset: request.inputMint,
    inputAmountBaseUnits: request.inputAmountBaseUnits,
    expectedShareOutputBaseUnits: request.expectedShareOutputBaseUnits,
    minimumShareOutputBaseUnits: request.minimumShareOutputBaseUnits,
    feeBaseUnits: request.feeBaseUnits,
    bountyBaseUnits: request.bountyBaseUnits,
    networkAndRentEstimateBaseUnits: request.networkAndRentEstimateBaseUnits,
    vault: request.vault,
    programs: Object.freeze([...allowedProgramIds].sort()),
    accounts: Object.freeze(allAccounts),
    signers: Object.freeze([...expectedSignerSet].sort()),
    feePayer: request.feePayer,
    allowedInstructions: Object.freeze(
      request.instructions.map(({ programId, kind, dataFingerprint }) => ({
        programId,
        kind,
        dataFingerprint,
      })),
    ),
    allowedRoutes: Object.freeze([...routeSet].sort()),
    expectedDestinations: Object.freeze([...destinationSet].sort()),
    expectedTokenDebits: Object.freeze([...request.expectedTokenDebits]),
    expectedTokenCredits: Object.freeze([...request.expectedTokenCredits]),
    expectedClosableAccounts: Object.freeze([...closableSet].sort()),
    expectedPostConditions: Object.freeze([...request.expectedPostConditions]),
    reconciliationRequirements: Object.freeze([
      ...request.reconciliationRequirements,
    ]),
    unsignedTransactionFingerprint: fingerprint,
  });
}
