import { readFileSync } from "node:fs";

export const AUTHORITY_IDS = [
  "protocol_vault_configuration",
  "c3_asset_registry",
  "target_weights",
  "fee_configuration",
  "oracle_configuration",
  "keeper_operational_limits",
  "treasury",
  "emergency_pause",
  "recovery",
  "upgrade_migration",
  "pilot_allowlist",
  "pilot_cap_changes",
  "authority_rotation",
];
export const TIMELOCK_ACTIONS = [
  "emergency_pause",
  "emergency_unpause",
  "routine_configuration",
  "fee_change",
  "target_weight_change",
  "asset_mint_change",
  "oracle_change",
  "keeper_limit_change",
  "treasury_transfer",
  "vault_migration",
  "authority_rotation",
  "upgrade_approval",
];
export const PILOT_LIMITS = [
  "minimumSupervisedPurchase",
  "maximumPerPurchase",
  "maximumPerWallet",
  "maximumAggregateTvl",
  "maximumDailyDeposits",
  "maximumDailyRedemptions",
  "maximumOutstandingIntents",
  "maximumSlippage",
  "maximumRebalanceDeviation",
  "maximumOracleStaleness",
  "maximumIntentLifetime",
  "minimumSolForFees",
  "pauseThreshold",
  "manualReviewThreshold",
  "allowlistedWalletCount",
  "pilotDuration",
  "successfulBuySellCycles",
];
const AUTHORITY_TIMELOCK = {
  protocol_vault_configuration: "routine_configuration",
  c3_asset_registry: "asset_mint_change",
  target_weights: "target_weight_change",
  fee_configuration: "fee_change",
  oracle_configuration: "oracle_change",
  keeper_operational_limits: "keeper_limit_change",
  treasury: "treasury_transfer",
  emergency_pause: "emergency_pause",
  recovery: "emergency_unpause",
  upgrade_migration: "upgrade_approval",
  pilot_allowlist: "routine_configuration",
  pilot_cap_changes: "routine_configuration",
  authority_rotation: "authority_rotation",
};
const TIMELOCK_SECONDS = {
  emergency_pause: 0,
  emergency_unpause: 86400,
  routine_configuration: 86400,
  fee_change: 172800,
  target_weight_change: 604800,
  asset_mint_change: 604800,
  oracle_change: 172800,
  keeper_limit_change: 86400,
  treasury_transfer: 172800,
  vault_migration: 604800,
  authority_rotation: 172800,
  upgrade_approval: 604800,
};
const PILOT_RECOMMENDATIONS = {
  minimumSupervisedPurchase: 1,
  maximumPerPurchase: 1,
  maximumPerWallet: 2,
  maximumAggregateTvl: 3,
  maximumDailyDeposits: 3,
  maximumDailyRedemptions: 3,
  maximumOutstandingIntents: 1,
  maximumSlippage: 100,
  maximumRebalanceDeviation: 100,
  maximumOracleStaleness: 60,
  maximumIntentLifetime: 900,
  minimumSolForFees: "0.02",
  pauseThreshold: "any_unexplained_token_effect_or_unreconciled_intent",
  manualReviewThreshold: "first_uncertain_signature_or_balance_mismatch",
  allowlistedWalletCount: 3,
  pilotDuration: 72,
  successfulBuySellCycles: 3,
};
const PENDING = "pending_project_manager_approval";
const SCHEMA_KEYS = [
  "version",
  "status",
  "cluster",
  "mainnetExecutionEnabled",
  "allocationBps",
  "squads",
  "authorities",
  "timelocks",
  "timelockImplementation",
  "pilot",
  "fees",
  "deployment",
];
const PUBLIC_KEY_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fail(path, reason) {
  throw new Error(`${path}: ${reason}`);
}
function record(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "object required");
  const actual = Object.keys(value).sort();
  if (actual.join("|") !== [...keys].sort().join("|"))
    fail(path, "missing or unexpected fields");
  return value;
}
function equal(value, expected, path) {
  if (value !== expected) fail(path, `must equal ${String(expected)}`);
}
function text(value, path) {
  if (typeof value !== "string" || value.length < 3 || value.length > 300)
    fail(path, "nonempty bounded text required");
}
function list(value, path) {
  if (!Array.isArray(value)) fail(path, "array required");
  return value;
}
function unique(values, path) {
  if (new Set(values).size !== values.length) fail(path, "duplicate values");
}
function setEquals(actual, expected, path) {
  unique(actual, path);
  if ([...actual].sort().join("|") !== [...expected].sort().join("|"))
    fail(path, "incomplete or unknown entries");
}
function safePublicKey(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44)
    return false;
  let n = 0n;
  for (const char of value) {
    const digit = PUBLIC_KEY_ALPHABET.indexOf(char);
    if (digit < 0) return false;
    n = n * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (n > 0n) {
    bytes++;
    n >>= 8n;
  }
  bytes += value.match(/^1*/)[0].length;
  return bytes === 32;
}
function scanForProhibitedFields(value, path = "candidate") {
  if (typeof value === "string") {
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----|\b(?:seed phrase|private key|secret key)\s*[:=]|\b(?:sk|pk)_[A-Za-z0-9]{16,}/i.test(
        value,
      )
    )
      fail(path, "private material in text prohibited");
    return;
  }
  if (Array.isArray(value))
    return value.forEach((item, index) =>
      scanForProhibitedFields(item, `${path}[${index}]`),
    );
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (
      /private|secret|seed|keypair|password|credential|transactionPayload|serializedTransaction/i.test(
        key,
      )
    )
      fail(`${path}.${key}`, "secret or executable payload field prohibited");
    scanForProhibitedFields(nested, `${path}.${key}`);
  }
}

export function validateGovernanceCandidate(candidate) {
  scanForProhibitedFields(candidate);
  record(candidate, "candidate", SCHEMA_KEYS);
  equal(candidate.version, "c3-governance-candidate-v1", "version");
  equal(candidate.status, "candidate_disabled", "status");
  equal(candidate.cluster, "mainnet-beta", "cluster");
  equal(candidate.mainnetExecutionEnabled, false, "mainnetExecutionEnabled");
  record(candidate.allocationBps, "allocationBps", ["BTC", "ETH", "SOL"]);
  for (const [asset, basisPoints] of Object.entries({
    BTC: 4000,
    ETH: 3000,
    SOL: 3000,
  }))
    equal(
      candidate.allocationBps[asset],
      basisPoints,
      `allocationBps.${asset}`,
    );
  if (
    Object.values(candidate.allocationBps).reduce(
      (sum, value) => sum + value,
      0,
    ) !== 10000
  )
    fail("allocationBps", "must total 10000");

  const squads = record(candidate.squads, "squads", [
    "officialProgramIdForReviewOnly",
    "reviewedRepositoryCommit",
    "multisigAddress",
    "vaultAddress",
    "treasuryAddress",
    "configurationAuthority",
    "spendingLimitsEnabled",
    "members",
    "threshold",
    "deploymentStatus",
  ]);
  equal(
    squads.officialProgramIdForReviewOnly,
    "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf",
    "squads.officialProgramIdForReviewOnly",
  );
  if (!/^[a-f0-9]{40}$/.test(squads.reviewedRepositoryCommit))
    fail("squads.reviewedRepositoryCommit", "full source commit required");
  for (const key of ["multisigAddress", "vaultAddress", "treasuryAddress"])
    equal(squads[key], null, `squads.${key}`);
  equal(
    squads.configurationAuthority,
    "autonomous_multisig_proposed",
    "squads.configurationAuthority",
  );
  equal(squads.spendingLimitsEnabled, false, "squads.spendingLimitsEnabled");
  equal(squads.threshold, 2, "squads.threshold");
  equal(squads.deploymentStatus, "unconfigured", "squads.deploymentStatus");
  const members = list(squads.members, "squads.members");
  if (members.length !== 3)
    fail("squads.members", "exactly three members required");
  members.forEach((member, index) => {
    record(member, `squads.members[${index}]`, ["role", "status", "address"]);
    equal(member.role, `member_${index + 1}`, `squads.members[${index}].role`);
    if (member.status === "unconfigured")
      equal(member.address, null, `squads.members[${index}].address`);
    else if (member.status === "configured") {
      if (!safePublicKey(member.address))
        fail(
          `squads.members[${index}].address`,
          "valid 32-byte public key required",
        );
    } else fail(`squads.members[${index}].status`, "unknown status");
  });
  const addresses = members
    .filter((member) => member.status === "configured")
    .map((member) => member.address);
  if (addresses.length !== 0 && addresses.length !== 3)
    fail(
      "squads.members",
      "all three valid public addresses required before configuration",
    );
  unique(addresses, "squads.members.address");

  const authorities = list(candidate.authorities, "authorities");
  setEquals(
    authorities.map((entry) => entry.id),
    AUTHORITY_IDS,
    "authorities",
  );
  authorities.forEach((entry) => {
    const path = `authorities.${entry.id}`;
    record(entry, path, [
      "id",
      "responsibility",
      "proposedSquadsControlledAccount",
      "threshold",
      "timelockClass",
      "permittedDestinations",
      "prohibitedActions",
      "evidenceRequired",
      "symmetryMappingStatus",
      "deploymentStatus",
    ]);
    text(entry.responsibility, `${path}.responsibility`);
    equal(
      entry.proposedSquadsControlledAccount,
      "unconfigured",
      `${path}.proposedSquadsControlledAccount`,
    );
    equal(entry.threshold, 2, `${path}.threshold`);
    if (!TIMELOCK_ACTIONS.includes(entry.timelockClass))
      fail(`${path}.timelockClass`, "unknown timelock class");
    equal(
      entry.timelockClass,
      AUTHORITY_TIMELOCK[entry.id],
      `${path}.timelockClass`,
    );
    if (
      list(entry.permittedDestinations, `${path}.permittedDestinations`)
        .length !== 0
    )
      fail(
        `${path}.permittedDestinations`,
        "destinations require future approval",
      );
    for (const key of ["prohibitedActions", "evidenceRequired"]) {
      const entries = list(entry[key], `${path}.${key}`);
      if (entries.length === 0) fail(`${path}.${key}`, "must not be empty");
      entries.forEach((item) => text(item, `${path}.${key}`));
    }
    equal(
      entry.symmetryMappingStatus,
      "unverified",
      `${path}.symmetryMappingStatus`,
    );
    equal(entry.deploymentStatus, "unconfigured", `${path}.deploymentStatus`);
  });
  equal(
    candidate.timelockImplementation,
    "unverified_global_lock_cannot_enforce_per_action_matrix",
    "timelockImplementation",
  );
  const timelocks = list(candidate.timelocks, "timelocks");
  setEquals(
    timelocks.map((entry) => entry.action),
    TIMELOCK_ACTIONS,
    "timelocks",
  );
  timelocks.forEach((entry) => {
    const path = `timelocks.${entry.action}`;
    record(entry, path, [
      "action",
      "candidateDelaySeconds",
      "rationale",
      "status",
    ]);
    if (
      !Number.isSafeInteger(entry.candidateDelaySeconds) ||
      entry.candidateDelaySeconds < 0
    )
      fail(
        `${path}.candidateDelaySeconds`,
        "safe nonnegative integer required",
      );
    equal(
      entry.candidateDelaySeconds,
      TIMELOCK_SECONDS[entry.action],
      `${path}.candidateDelaySeconds`,
    );
    if (entry.action === "emergency_pause" && entry.candidateDelaySeconds !== 0)
      fail(path, "candidate immediate pause required");
    if (
      entry.action === "emergency_unpause" &&
      entry.candidateDelaySeconds === 0
    )
      fail(path, "unpause must have nonzero delay");
    text(entry.rationale, `${path}.rationale`);
    equal(entry.status, PENDING, `${path}.status`);
  });
  const pilot = record(candidate.pilot, "pilot", [
    "status",
    "allowlistedWallets",
    "limits",
  ]);
  equal(pilot.status, "candidate_disabled", "pilot.status");
  if (list(pilot.allowlistedWallets, "pilot.allowlistedWallets").length !== 0)
    fail("pilot.allowlistedWallets", "pilot allowlist must remain empty");
  const limits = record(pilot.limits, "pilot.limits", PILOT_LIMITS);
  for (const [id, entry] of Object.entries(limits)) {
    const path = `pilot.limits.${id}`;
    record(entry, path, [
      "recommendation",
      "unit",
      "rationale",
      "riskReduced",
      "status",
    ]);
    if (
      !(
        typeof entry.recommendation === "string" &&
        entry.recommendation.length > 0
      ) &&
      !(
        typeof entry.recommendation === "number" &&
        Number.isFinite(entry.recommendation) &&
        entry.recommendation > 0
      )
    )
      fail(
        `${path}.recommendation`,
        "positive bounded recommendation required",
      );
    equal(
      entry.recommendation,
      PILOT_RECOMMENDATIONS[id],
      `${path}.recommendation`,
    );
    text(entry.unit, `${path}.unit`);
    text(entry.rationale, `${path}.rationale`);
    text(entry.riskReduced, `${path}.riskReduced`);
    equal(entry.status, PENDING, `${path}.status`);
  }
  equal(
    limits.minimumSupervisedPurchase.recommendation,
    1,
    "pilot.limits.minimumSupervisedPurchase",
  );
  if (limits.maximumPerPurchase.recommendation < 1)
    fail("pilot.limits.maximumPerPurchase", "below pilot minimum");
  const fees = record(candidate.fees, "fees", [
    "version",
    "status",
    "buyBps",
    "sellBps",
    "verifiedSkrDiscountPercent",
    "discountedBps",
    "collectionEnabled",
    "skrDiscountEnabled",
    "historicalObsoleteProposals",
    "approvalReferences",
  ]);
  equal(fees.version, "c3-fees/product-candidate-v1", "fees.version");
  equal(fees.status, "candidate_disabled", "fees.status");
  for (const [key, value] of Object.entries({
    buyBps: 15,
    sellBps: 15,
    verifiedSkrDiscountPercent: 50,
    discountedBps: 7.5,
    collectionEnabled: false,
    skrDiscountEnabled: false,
  }))
    equal(fees[key], value, `fees.${key}`);
  setEquals(
    list(fees.historicalObsoleteProposals, "fees.historicalObsoleteProposals"),
    ["60_bps_deposit", "10_bps_withdrawal"],
    "fees.historicalObsoleteProposals",
  );
  const approvals = record(fees.approvalReferences, "fees.approvalReferences", [
    "projectManager",
    "security",
    "squads",
  ]);
  for (const value of Object.values(approvals))
    equal(value, null, "fees.approvalReferences");
  const deployment = record(candidate.deployment, "deployment", [
    "status",
    "approved",
    "vaultAddress",
    "shareMintAddress",
    "symmetryAuthorityMapping",
    "symmetryTechnicalResponse",
    "timelockApprovalReference",
    "pilotLimitApprovalReference",
    "feeApprovalReference",
    "securityApprovalReference",
    "projectManagerApprovalReference",
    "squadsCreationSignature",
    "vaultDeploymentSignature",
  ]);
  equal(deployment.status, "unconfigured", "deployment.status");
  equal(deployment.approved, false, "deployment.approved");
  for (const key of [
    "vaultAddress",
    "shareMintAddress",
    "timelockApprovalReference",
    "pilotLimitApprovalReference",
    "feeApprovalReference",
    "securityApprovalReference",
    "projectManagerApprovalReference",
    "squadsCreationSignature",
    "vaultDeploymentSignature",
  ])
    equal(deployment[key], null, `deployment.${key}`);
  equal(
    deployment.symmetryAuthorityMapping,
    "unverified",
    "deployment.symmetryAuthorityMapping",
  );
  equal(
    deployment.symmetryTechnicalResponse,
    "pending",
    "deployment.symmetryTechnicalResponse",
  );
  return true;
}

export function missingReadinessInputs(candidate) {
  validateGovernanceCandidate(candidate);
  const missing = [];
  if (candidate.squads.members.some((member) => member.status !== "configured"))
    missing.push("three distinct member public addresses");
  if (!candidate.deployment.projectManagerApprovalReference)
    missing.push("Project Manager approval");
  if (!candidate.deployment.securityApprovalReference)
    missing.push("Security approval");
  if (candidate.deployment.symmetryAuthorityMapping !== "verified")
    missing.push("official Symmetry authority mapping");
  if (!candidate.deployment.squadsCreationSignature)
    missing.push("verified Squads deployment");
  if (
    !candidate.deployment.timelockApprovalReference ||
    candidate.timelockImplementation.startsWith("unverified")
  )
    missing.push("approved and enforceable timelocks");
  if (!candidate.deployment.pilotLimitApprovalReference)
    missing.push("approved pilot limits");
  if (!candidate.deployment.feeApprovalReference)
    missing.push("approved fee policy");
  if (
    !candidate.deployment.vaultAddress ||
    !candidate.deployment.shareMintAddress
  )
    missing.push("vault and share mint");
  if (!candidate.deployment.vaultDeploymentSignature)
    missing.push("deployment evidence");
  return missing;
}

export function loadCandidate() {
  return JSON.parse(
    readFileSync(
      new URL(
        "../../../config/c3/c3-governance-candidate.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}
