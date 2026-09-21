import { createHash } from "node:crypto";

import {
  C3_ALLOCATION,
  C3_FEES,
  C3_MAINNET,
  C3_MAINNET_EXECUTION_CAPABILITY,
  SERVER_CREDENTIAL_NAMES,
} from "./constants.ts";
import { C3_MAINNET_ASSET_REGISTRY } from "./registry.ts";

export const C3_DEPLOYMENT_MANIFEST_VERSION =
  "c3-mainnet-deployment/v1" as const;
export const C3_MANIFEST_STATUSES = [
  "proposed",
  "verified",
  "security_approved",
  "governance_approved",
  "deployment_ready",
  "deployed",
  "paused",
] as const;

export type C3ManifestStatus = (typeof C3_MANIFEST_STATUSES)[number];
export type C3DeploymentManifest = Readonly<
  Record<string, unknown> & {
    schemaVersion: typeof C3_DEPLOYMENT_MANIFEST_VERSION;
    status: C3ManifestStatus;
    cluster: "mainnet-beta";
    genesisHash: string;
    executionCapability: false;
    immutableConfigurationHash: string;
  }
>;

export type ManifestValidation = Readonly<{
  valid: boolean;
  issues: readonly string[];
  missingPublicInputs: readonly string[];
}>;

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "status",
  "cluster",
  "genesisHash",
  "executionCapability",
  "programs",
  "vault",
  "assets",
  "oracles",
  "routes",
  "allocation",
  "fees",
  "pilot",
  "limits",
  "authorities",
  "squads",
  "symmetryAdapter",
  "rpcRegistry",
  "operationPolicies",
  "lifecycleEvidence",
  "credentials",
  "approvals",
  "immutableConfigurationHash",
] as const;

const PLACEHOLDER = /^(todo|tbd|replace|placeholder|changeme|unknown|example)/i;
const PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HASH = /^[a-f0-9]{64}$/;

const STATUS_RANK: Readonly<Record<C3ManifestStatus, number>> = Object.freeze({
  proposed: 0,
  verified: 1,
  security_approved: 2,
  governance_approved: 3,
  deployment_ready: 4,
  deployed: 5,
  paused: 6,
});

function receiptValid(
  value: unknown,
  expectedConfigurationHash: unknown,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return (
    Object.keys(receipt).length === 5 &&
    typeof receipt.kind === "string" &&
    typeof receipt.signature === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(receipt.signature) &&
    receipt.configurationHash === expectedConfigurationHash &&
    Number.isSafeInteger(receipt.slot) &&
    Number(receipt.slot) > 0 &&
    typeof receipt.evidenceHash === "string" &&
    HASH.test(receipt.evidenceHash)
  );
}

export function assertManifestLifecycleTransition(
  previous: C3DeploymentManifest,
  next: C3DeploymentManifest,
): void {
  const from = STATUS_RANK[previous.status];
  const to = STATUS_RANK[next.status];
  const allowedPauseResume =
    previous.status === "paused" && next.status === "deployed";
  if (
    (!allowedPauseResume && to !== from + 1) ||
    next.executionCapability !== false
  )
    throw new Error(
      `Unsafe manifest lifecycle transition: ${previous.status} -> ${next.status}.`,
    );
  const previousHash = computeManifestHash(previous);
  const evidence = (next as Record<string, unknown>).lifecycleEvidence as
    Record<string, unknown> | undefined;
  if (evidence?.previousManifestHash !== previousHash)
    throw new Error(
      "Manifest lifecycle does not bind the previous immutable configuration.",
    );
  const validation = validateDeploymentManifest(next);
  if (!validation.valid)
    throw new Error("Next manifest lifecycle state is invalid.");
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function computeManifestHash(
  manifest: Readonly<Record<string, unknown>>,
): string {
  const clone = { ...manifest };
  delete clone.immutableConfigurationHash;
  return createHash("sha256").update(canonicalize(clone)).digest("hex");
}

export function computeManifestCoreHash(
  manifest: Readonly<Record<string, unknown>>,
): string {
  const clone = { ...manifest };
  delete clone.immutableConfigurationHash;
  delete clone.lifecycleEvidence;
  return createHash("sha256").update(canonicalize(clone)).digest("hex");
}

function object(
  value: unknown,
  label: string,
  issues: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${label} must be an object`);
    return {};
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  issues: string[],
): void {
  for (const key of keys)
    if (!(key in record)) issues.push(`${label}.${key} is missing`);
  for (const key of Object.keys(record))
    if (!keys.includes(key)) issues.push(`${label}.${key} is not allowed`);
}

function publicKeyOrMissing(
  value: unknown,
  label: string,
  issues: string[],
  missing: string[],
): void {
  if (value === null) {
    missing.push(label);
    return;
  }
  if (
    typeof value !== "string" ||
    PLACEHOLDER.test(value) ||
    !PUBLIC_KEY.test(value)
  )
    issues.push(`${label} is not a valid public key`);
}

function positiveIntegerString(
  value: unknown,
  label: string,
  issues: string[],
): void {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
    issues.push(`${label} must be a positive integer string`);
}

export function validateDeploymentManifest(value: unknown): ManifestValidation {
  const issues: string[] = [];
  const missingPublicInputs: string[] = [];
  const root = object(value, "manifest", issues);
  exactKeys(root, TOP_LEVEL_KEYS, "manifest", issues);
  if (root.schemaVersion !== C3_DEPLOYMENT_MANIFEST_VERSION)
    issues.push("manifest.schemaVersion is unsupported");
  if (!C3_MANIFEST_STATUSES.includes(root.status as C3ManifestStatus))
    issues.push("manifest.status is unsupported");
  if (
    root.cluster !== C3_MAINNET.cluster ||
    root.genesisHash !== C3_MAINNET.genesisHash
  )
    issues.push("manifest must bind exact Solana Mainnet genesis");
  if (
    root.executionCapability !== C3_MAINNET_EXECUTION_CAPABILITY ||
    root.executionCapability !== false
  )
    issues.push("Mainnet execution capability must be immutable false");

  const programs = object(root.programs, "programs", issues);
  exactKeys(
    programs,
    [
      "symmetry",
      "symmetryGlobalConfig",
      "system",
      "token",
      "associatedToken",
      "jupiter",
      "computeBudget",
      "addressLookupTable",
      "squads",
    ],
    "programs",
    issues,
  );
  const expectedPrograms = {
    symmetry: C3_MAINNET.symmetryProgram,
    symmetryGlobalConfig: C3_MAINNET.symmetryGlobalConfig,
    system: C3_MAINNET.systemProgram,
    token: C3_MAINNET.tokenProgram,
    associatedToken: C3_MAINNET.associatedTokenProgram,
    jupiter: C3_MAINNET.jupiterProgram,
    computeBudget: C3_MAINNET.computeBudgetProgram,
    addressLookupTable: C3_MAINNET.addressLookupTableProgram,
  };
  for (const [key, expected] of Object.entries(expectedPrograms))
    if (programs[key] !== expected)
      issues.push(`programs.${key} is not approved`);
  publicKeyOrMissing(
    programs.squads,
    "programs.squads",
    issues,
    missingPublicInputs,
  );

  const vault = object(root.vault, "vault", issues);
  exactKeys(
    vault,
    [
      "address",
      "addressDerivation",
      "shareMint",
      "shareMintDerivation",
      "shareDecimals",
    ],
    "vault",
    issues,
  );
  publicKeyOrMissing(
    vault.address,
    "vault.address",
    issues,
    missingPublicInputs,
  );
  publicKeyOrMissing(
    vault.shareMint,
    "vault.shareMint",
    issues,
    missingPublicInputs,
  );
  if (vault.shareDecimals !== 6) issues.push("vault.shareDecimals must be 6");
  const addressDerivation = object(
    vault.addressDerivation,
    "vault.addressDerivation",
    issues,
  );
  const mintDerivation = object(
    vault.shareMintDerivation,
    "vault.shareMintDerivation",
    issues,
  );
  if (
    canonicalize(addressDerivation) !==
    canonicalize({
      program: C3_MAINNET.symmetryProgram,
      seeds: ["basket", "share_mint"],
    })
  )
    issues.push("vault address derivation is not approved");
  if (
    canonicalize(mintDerivation) !==
    canonicalize({
      program: C3_MAINNET.symmetryProgram,
      seeds: ["mint", "vault_id_u64"],
    })
  )
    issues.push("share mint derivation is not approved");

  const assets = object(root.assets, "assets", issues);
  exactKeys(assets, Object.keys(C3_MAINNET_ASSET_REGISTRY), "assets", issues);
  for (const asset of Object.values(C3_MAINNET_ASSET_REGISTRY)) {
    const configured = object(assets[asset.id], `assets.${asset.id}`, issues);
    exactKeys(
      configured,
      ["mint", "decimals", "tokenProgram", "status", "evidenceFingerprint"],
      `assets.${asset.id}`,
      issues,
    );
    if (
      configured.mint !== asset.mint ||
      configured.decimals !== asset.decimals ||
      configured.tokenProgram !== asset.tokenProgram
    )
      issues.push(
        `assets.${asset.id} does not match the reviewed candidate registry`,
      );
    if (configured.status !== "candidate" && configured.status !== "verified")
      issues.push(`assets.${asset.id}.status is invalid`);
    if (
      configured.status === "verified" &&
      (typeof configured.evidenceFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(configured.evidenceFingerprint))
    )
      issues.push(
        `assets.${asset.id} verified status lacks evidence fingerprint`,
      );
  }

  const oracles = object(root.oracles, "oracles", issues);
  exactKeys(
    oracles,
    [
      "provider",
      "endpoint",
      "maximumAgeSeconds",
      "maximumConfidenceBps",
      "feeds",
    ],
    "oracles",
    issues,
  );
  if (
    oracles.provider !== "pyth-core" ||
    typeof oracles.endpoint !== "string" ||
    !oracles.endpoint.startsWith("https://")
  )
    issues.push("oracles must use authenticated Pyth HTTPS");
  if (
    !Number.isInteger(oracles.maximumAgeSeconds) ||
    Number(oracles.maximumAgeSeconds) <= 0
  )
    issues.push("oracle freshness limit is invalid");
  const feeds = object(oracles.feeds, "oracles.feeds", issues);
  for (const asset of Object.values(C3_MAINNET_ASSET_REGISTRY))
    if (feeds[asset.id] !== asset.oracleFeedId)
      issues.push(`oracles.feeds.${asset.id} mismatch`);

  const routes = object(root.routes, "routes", issues);
  exactKeys(
    routes,
    [
      "buildEndpoint",
      "jupiterProgram",
      "approvedRoutePrograms",
      "registryStatus",
    ],
    "routes",
    issues,
  );
  if (
    typeof routes.buildEndpoint !== "string" ||
    !routes.buildEndpoint.startsWith("https://")
  )
    issues.push("Jupiter build endpoint must use HTTPS");
  if (routes.jupiterProgram !== C3_MAINNET.jupiterProgram)
    issues.push("Jupiter program mismatch");
  if (
    !Array.isArray(routes.approvedRoutePrograms) ||
    routes.approvedRoutePrograms.some(
      (item) => typeof item !== "string" || !PUBLIC_KEY.test(item),
    )
  )
    issues.push("route-program registry is malformed");
  if (
    routes.registryStatus !== "proposed" &&
    routes.registryStatus !== "verified"
  )
    issues.push("route registry status is invalid");

  const allocation = object(root.allocation, "allocation", issues);
  exactKeys(
    allocation,
    ["btcBps", "ethBps", "solBps", "totalBps"],
    "allocation",
    issues,
  );
  if (
    allocation.btcBps !== C3_ALLOCATION.btcBps ||
    allocation.ethBps !== C3_ALLOCATION.ethBps ||
    allocation.solBps !== C3_ALLOCATION.solBps ||
    allocation.totalBps !== 10_000
  )
    issues.push("allocation must be immutable 4000/3000/3000");

  const fees = object(root.fees, "fees", issues);
  exactKeys(
    fees,
    [
      "version",
      "buyRateUnitsPer100000",
      "sellRateUnitsPer100000",
      "skrRateUnitsPer100000",
      "collectionEnabled",
      "skrDiscountEnabled",
    ],
    "fees",
    issues,
  );
  if (
    fees.buyRateUnitsPer100000 !== Number(C3_FEES.buyRateUnits) ||
    fees.sellRateUnitsPer100000 !== Number(C3_FEES.sellRateUnits) ||
    fees.skrRateUnitsPer100000 !== Number(C3_FEES.skrDiscountedRateUnits)
  )
    issues.push("fee candidate mismatch");
  if (fees.collectionEnabled !== false || fees.skrDiscountEnabled !== false)
    issues.push("fees and SKR discount must remain disabled");

  const pilot = object(root.pilot, "pilot", issues);
  exactKeys(
    pilot,
    [
      "minimumPurchaseUsdcBaseUnits",
      "allowlistRoot",
      "allowlistVersion",
      "publicAccessEnabled",
    ],
    "pilot",
    issues,
  );
  if (
    pilot.minimumPurchaseUsdcBaseUnits !== "1000000" ||
    pilot.publicAccessEnabled !== false
  )
    issues.push("pilot minimum/public-access policy mismatch");
  if (pilot.allowlistRoot === null)
    missingPublicInputs.push("pilot.allowlistRoot");
  else if (
    typeof pilot.allowlistRoot !== "string" ||
    !/^[a-f0-9]{64}$/.test(pilot.allowlistRoot)
  )
    issues.push("pilot allowlist root is malformed");

  const limits = object(root.limits, "limits", issues);
  const limitKeys = [
    "maximumPilotTvlUsdcBaseUnits",
    "maximumPerWalletUsdcBaseUnits",
    "maximumPurchaseUsdcBaseUnits",
    "maximumDailyInflowUsdcBaseUnits",
    "maximumDailyOutflowUsdcBaseUnits",
    "keeperAggregationThresholdUsdcBaseUnits",
    "driftThresholdBps",
    "maximumSlippageBps",
    "maximumPriceImpactBps",
    "oracleFreshnessSeconds",
    "quoteExpirySeconds",
    "transactionExpirySeconds",
    "withdrawalTimeoutSeconds",
    "timelockSeconds",
    "effectiveCostWarningBps",
  ];
  exactKeys(limits, limitKeys, "limits", issues);
  for (const key of limitKeys.slice(0, 6))
    positiveIntegerString(limits[key], `limits.${key}`, issues);
  for (const key of limitKeys.slice(6))
    if (!Number.isInteger(limits[key]) || Number(limits[key]) <= 0)
      issues.push(`limits.${key} must be a positive integer`);

  const authorities = object(root.authorities, "authorities", issues);
  const authorityKeys = [
    "governance",
    "treasuryVault",
    "configuration",
    "emergencyPause",
    "fee",
    "keeper",
  ];
  exactKeys(authorities, authorityKeys, "authorities", issues);
  for (const key of authorityKeys)
    publicKeyOrMissing(
      authorities[key],
      `authorities.${key}`,
      issues,
      missingPublicInputs,
    );
  const assigned = authorityKeys
    .map((key) => authorities[key])
    .filter((item): item is string => typeof item === "string");
  if (new Set(assigned).size !== assigned.length)
    issues.push("authority separation is violated");

  const squads = object(root.squads, "squads", issues);
  exactKeys(
    squads,
    [
      "memberAddresses",
      "threshold",
      "timelockSeconds",
      "spendingLimitsConfigured",
      "destinationAllowlistConfigured",
      "multisigAddress",
      "vaultAddress",
      "roleAssignments",
      "derivationPolicyHash",
      "onchainEvidenceHash",
      "allowedDestinations",
    ],
    "squads",
    issues,
  );
  if (
    !Array.isArray(squads.memberAddresses) ||
    squads.memberAddresses.length !== 3
  )
    issues.push("Squads requires exactly three member inputs");
  else
    squads.memberAddresses.forEach((member, index) =>
      publicKeyOrMissing(
        member,
        `squads.memberAddresses[${index}]`,
        issues,
        missingPublicInputs,
      ),
    );
  if (Array.isArray(squads.memberAddresses)) {
    const realMembers = squads.memberAddresses.filter(
      (member): member is string => typeof member === "string",
    );
    if (new Set(realMembers).size !== realMembers.length)
      issues.push("Squads members must be distinct");
    if (realMembers.includes("11111111111111111111111111111111"))
      issues.push("Squads cannot use the default public key");
  }
  if (
    squads.threshold !== 2 ||
    squads.timelockSeconds !== limits.timelockSeconds
  )
    issues.push("Squads must be 2-of-3 with the manifest timelock");

  for (const key of ["multisigAddress", "vaultAddress"])
    publicKeyOrMissing(
      squads[key],
      `squads.${key}`,
      issues,
      missingPublicInputs,
    );
  if (
    typeof squads.multisigAddress === "string" &&
    squads.multisigAddress === squads.vaultAddress
  )
    issues.push("Squads multisig and Vault addresses must differ");
  if (squads.roleAssignments === null)
    missingPublicInputs.push("squads.roleAssignments");
  else {
    const roles = object(
      squads.roleAssignments,
      "squads.roleAssignments",
      issues,
    );
    exactKeys(
      roles,
      ["security", "operations", "governance"],
      "squads.roleAssignments",
      issues,
    );
    if (new Set(Object.values(roles)).size !== 3)
      issues.push("Squads role assignments must be distinct");
  }
  for (const key of ["derivationPolicyHash", "onchainEvidenceHash"])
    if (squads[key] === null) missingPublicInputs.push(`squads.${key}`);
    else if (
      typeof squads[key] !== "string" ||
      !HASH.test(squads[key] as string)
    )
      issues.push(`squads.${key} is malformed`);
  if (!Array.isArray(squads.allowedDestinations))
    issues.push("squads.allowedDestinations must be an array");
  else if (
    squads.allowedDestinations.some(
      (destination) =>
        typeof destination !== "string" || !PUBLIC_KEY.test(destination),
    )
  )
    issues.push("squads.allowedDestinations is malformed");

  const symmetryAdapter = object(
    root.symmetryAdapter,
    "symmetryAdapter",
    issues,
  );
  exactKeys(
    symmetryAdapter,
    [
      "adapterId",
      "authoritativeSourceUrl",
      "authoritativeSourceHash",
      "accountLayoutHash",
      "instructionLayoutHash",
      "productionReviewed",
      "dependencySafe",
    ],
    "symmetryAdapter",
    issues,
  );
  for (const key of [
    "adapterId",
    "authoritativeSourceUrl",
    "authoritativeSourceHash",
    "accountLayoutHash",
    "instructionLayoutHash",
  ]) {
    if (symmetryAdapter[key] === null)
      missingPublicInputs.push(`symmetryAdapter.${key}`);
  }
  if (
    symmetryAdapter.authoritativeSourceUrl !== null &&
    (typeof symmetryAdapter.authoritativeSourceUrl !== "string" ||
      !symmetryAdapter.authoritativeSourceUrl.startsWith("https://"))
  )
    issues.push("Symmetry authoritative source must be HTTPS");
  for (const key of [
    "authoritativeSourceHash",
    "accountLayoutHash",
    "instructionLayoutHash",
  ])
    if (
      symmetryAdapter[key] !== null &&
      (typeof symmetryAdapter[key] !== "string" ||
        !HASH.test(symmetryAdapter[key] as string))
    )
      issues.push(`symmetryAdapter.${key} is malformed`);

  const rpcRegistry = object(root.rpcRegistry, "rpcRegistry", issues);
  exactKeys(
    rpcRegistry,
    ["status", "providerEvidenceHashes"],
    "rpcRegistry",
    issues,
  );
  if (!["proposed", "verified"].includes(String(rpcRegistry.status)))
    issues.push("RPC registry status is invalid");
  if (
    !Array.isArray(rpcRegistry.providerEvidenceHashes) ||
    rpcRegistry.providerEvidenceHashes.some(
      (hash) => typeof hash !== "string" || !HASH.test(hash),
    )
  )
    issues.push("RPC provider evidence hashes are malformed");

  const operationPolicies = object(
    root.operationPolicies,
    "operationPolicies",
    issues,
  );
  const operationKeys = [
    "seed_deposit",
    "deposit_intent",
    "rebalance_intent",
    "redemption_intent",
    "usdc_withdrawal",
    "emergency_pause",
  ];
  exactKeys(operationPolicies, operationKeys, "operationPolicies", issues);
  for (const key of operationKeys)
    if (operationPolicies[key] === null)
      missingPublicInputs.push(`operationPolicies.${key}`);

  const lifecycle = object(root.lifecycleEvidence, "lifecycleEvidence", issues);
  exactKeys(
    lifecycle,
    [
      "verificationReceipt",
      "securityApprovalReceipt",
      "governanceApprovalReceipt",
      "deploymentReadyReceipt",
      "deploymentReceipts",
      "deploymentSlot",
      "pauseReceipt",
      "previousManifestHash",
    ],
    "lifecycleEvidence",
    issues,
  );
  const status = root.status as C3ManifestStatus;
  const coreHash = computeManifestCoreHash(root);
  const requireReceipt = (minimum: C3ManifestStatus, key: string) => {
    if (
      STATUS_RANK[status] >= STATUS_RANK[minimum] &&
      !receiptValid(lifecycle[key], coreHash)
    )
      issues.push(
        `lifecycleEvidence.${key} is required and must be independently verifiable`,
      );
  };
  requireReceipt("verified", "verificationReceipt");
  requireReceipt("security_approved", "securityApprovalReceipt");
  requireReceipt("governance_approved", "governanceApprovalReceipt");
  requireReceipt("deployment_ready", "deploymentReadyReceipt");
  if (STATUS_RANK[status] >= STATUS_RANK.deployed) {
    if (
      !Array.isArray(lifecycle.deploymentReceipts) ||
      lifecycle.deploymentReceipts.length === 0 ||
      lifecycle.deploymentReceipts.some(
        (receipt) => !receiptValid(receipt, coreHash),
      )
    )
      issues.push("deployed manifest requires finalized deployment receipts");
    if (
      !Number.isSafeInteger(lifecycle.deploymentSlot) ||
      Number(lifecycle.deploymentSlot) <= 0
    )
      issues.push("deployed manifest requires a deployment slot");
  }
  if (status === "paused" && !receiptValid(lifecycle.pauseReceipt, coreHash))
    issues.push(
      "paused manifest requires independently verifiable pause evidence",
    );

  const credentials = object(root.credentials, "credentials", issues);
  exactKeys(
    credentials,
    [
      "jupiterVariable",
      "pythVariable",
      "rpcPrimaryVariable",
      "rpcSecondaryVariable",
      "rpcPrimaryOperatorVariable",
      "rpcSecondaryOperatorVariable",
    ],
    "credentials",
    issues,
  );
  const expectedCredentials = {
    jupiterVariable: SERVER_CREDENTIAL_NAMES.jupiter,
    pythVariable: SERVER_CREDENTIAL_NAMES.pyth,
    rpcPrimaryVariable: SERVER_CREDENTIAL_NAMES.rpcPrimaryUrl,
    rpcSecondaryVariable: SERVER_CREDENTIAL_NAMES.rpcSecondaryUrl,
    rpcPrimaryOperatorVariable: SERVER_CREDENTIAL_NAMES.rpcPrimaryOperator,
    rpcSecondaryOperatorVariable: SERVER_CREDENTIAL_NAMES.rpcSecondaryOperator,
  };
  for (const [key, expected] of Object.entries(expectedCredentials))
    if (credentials[key] !== expected)
      issues.push(`credentials.${key} mismatch`);

  const approvals = object(root.approvals, "approvals", issues);
  exactKeys(
    approvals,
    [
      "securityApproved",
      "governanceApproved",
      "seedCapitalReviewed",
      "assetEvidenceApproved",
      "routeRegistryApproved",
      "oracleEvidenceApproved",
    ],
    "approvals",
    issues,
  );
  if (
    fees.collectionEnabled === true &&
    (approvals.securityApproved !== true ||
      approvals.governanceApproved !== true)
  )
    issues.push(
      "fees cannot activate without Security and Governance approval",
    );
  if (
    root.status !== "proposed" &&
    Object.values(approvals).some((approved) => approved !== true)
  )
    issues.push("non-proposed manifest lacks required approval evidence");
  if (root.status !== "proposed" && missingPublicInputs.length > 0)
    issues.push("non-proposed manifest has unresolved mandatory public inputs");
  if (
    STATUS_RANK[root.status as C3ManifestStatus] >= STATUS_RANK.deployment_ready
  ) {
    if (
      routes.registryStatus !== "verified" ||
      rpcRegistry.status !== "verified"
    )
      issues.push(
        "deployment readiness requires verified route and RPC registries",
      );
    if (
      symmetryAdapter.productionReviewed !== true ||
      symmetryAdapter.dependencySafe !== true
    )
      issues.push(
        "deployment readiness requires a concrete reviewed Symmetry adapter",
      );
    if (
      !Array.isArray(rpcRegistry.providerEvidenceHashes) ||
      rpcRegistry.providerEvidenceHashes.length !== 2 ||
      new Set(rpcRegistry.providerEvidenceHashes).size !== 2
    )
      issues.push(
        "deployment readiness requires two independent RPC evidence records",
      );
    if (
      !Object.values(assets).every(
        (asset) =>
          typeof asset === "object" &&
          asset !== null &&
          (asset as Record<string, unknown>).status === "verified",
      )
    )
      issues.push("deployment readiness requires verified asset evidence");
  }

  if (
    typeof root.immutableConfigurationHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.immutableConfigurationHash)
  )
    issues.push("immutable configuration hash is malformed");
  else if (root.immutableConfigurationHash !== computeManifestHash(root))
    issues.push("immutable configuration hash mismatch");
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    missingPublicInputs: Object.freeze([...new Set(missingPublicInputs)]),
  });
}
