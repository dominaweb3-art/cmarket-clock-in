import { createHash } from "node:crypto";

import { canonicalize } from "./manifest.ts";
import { findProgramAddress, publicKeyBytes } from "./solana.ts";

export type SquadsDerivationPolicy = Readonly<{
  schemaVersion: "c3-squads-derivation/v1";
  programId: string;
  sourceUrl: string;
  sourceHash: string;
  multisigSeedPrefixBase64: string;
  vaultSeedPrefixBase64: string;
  productionReviewed: boolean;
}>;

export type SquadsOnChainEvidence = Readonly<{
  cluster: "mainnet-beta";
  programId: string;
  multisigAddress: string;
  multisigAccountOwner: string;
  vaultAddress: string;
  createKey: string;
  vaultIndex: number;
  members: readonly Readonly<{
    address: string;
    role: "security" | "operations" | "governance";
    permissions: readonly string[];
  }>[];
  threshold: number;
  timelockSeconds: number;
  spendingLimitUsdcBaseUnits: string;
  allowedDestinations: readonly string[];
  configurationAuthority: string;
  emergencyAuthority: string;
  observedSlot: number;
  evidenceHash: string;
  productionEvidence: boolean;
}>;

const DEFAULT_KEY = "11111111111111111111111111111111";
const HASH = /^[a-f0-9]{64}$/;

export function validateSquadsEvidence(
  evidence: SquadsOnChainEvidence,
  policy: SquadsDerivationPolicy,
  expected: Readonly<{
    members: readonly string[];
    multisigAddress: string;
    vaultAddress: string;
    timelockSeconds: number;
    allowedDestinations: readonly string[];
    configurationAuthority: string;
    emergencyAuthority: string;
    derivationPolicyHash: string;
  }>,
): readonly string[] {
  const issues: string[] = [];
  const policyHash = createHash("sha256")
    .update(canonicalize(policy))
    .digest("hex");
  if (
    policy.schemaVersion !== "c3-squads-derivation/v1" ||
    !policy.productionReviewed ||
    !policy.sourceUrl.startsWith("https://") ||
    !HASH.test(policy.sourceHash) ||
    policyHash !== expected.derivationPolicyHash
  )
    issues.push(
      "Squads derivation policy is not independently reviewed and bound.",
    );
  try {
    for (const address of [
      policy.programId,
      evidence.programId,
      evidence.multisigAddress,
      evidence.vaultAddress,
      evidence.createKey,
      evidence.configurationAuthority,
      evidence.emergencyAuthority,
      ...evidence.members.map((member) => member.address),
    ]) {
      publicKeyBytes(address);
      if (address === DEFAULT_KEY)
        issues.push("Squads evidence contains the default public key.");
    }
  } catch {
    issues.push("Squads evidence contains a malformed public key.");
  }
  const members = evidence.members.map((member) => member.address);
  if (members.length !== 3 || new Set(members).size !== 3)
    issues.push("Squads requires exactly three distinct members.");
  if (new Set(evidence.members.map((member) => member.role)).size !== 3)
    issues.push("Squads members require distinct assigned roles.");
  if (
    canonicalize([...members].sort()) !==
    canonicalize([...expected.members].sort())
  )
    issues.push("Squads members differ from approved configuration.");
  if (evidence.threshold !== 2)
    issues.push("Squads threshold must be exactly 2-of-3.");
  if (
    evidence.timelockSeconds !== expected.timelockSeconds ||
    evidence.timelockSeconds <= 0
  )
    issues.push("Squads timelock does not match approved policy.");
  if (
    evidence.programId !== policy.programId ||
    evidence.multisigAccountOwner !== policy.programId
  )
    issues.push("Squads program or account owner is not approved.");
  if (evidence.multisigAddress === evidence.vaultAddress)
    issues.push(
      "Squads multisig configuration address cannot be its asset Vault.",
    );
  if (
    members.includes(evidence.vaultAddress) ||
    members.includes(evidence.multisigAddress)
  )
    issues.push(
      "Member and governance account identities must remain separated.",
    );
  if (
    !Number.isInteger(evidence.vaultIndex) ||
    evidence.vaultIndex < 0 ||
    evidence.vaultIndex > 255
  )
    issues.push("Squads Vault index is invalid.");
  try {
    const multisig = findProgramAddress(
      [
        Buffer.from(policy.multisigSeedPrefixBase64, "base64"),
        publicKeyBytes(evidence.createKey),
      ],
      policy.programId,
    ).address;
    const vault = findProgramAddress(
      [
        Buffer.from(policy.vaultSeedPrefixBase64, "base64"),
        publicKeyBytes(multisig),
        Uint8Array.of(evidence.vaultIndex),
      ],
      policy.programId,
    ).address;
    if (
      multisig !== evidence.multisigAddress ||
      multisig !== expected.multisigAddress
    )
      issues.push("Squads multisig PDA derivation mismatch.");
    if (vault !== evidence.vaultAddress || vault !== expected.vaultAddress)
      issues.push("Squads Vault PDA derivation mismatch.");
  } catch {
    issues.push("Squads PDA derivation evidence is invalid.");
  }
  if (!/^[1-9]\d*$/.test(evidence.spendingLimitUsdcBaseUnits))
    issues.push("Squads spending limit is missing or invalid.");
  if (
    new Set(evidence.allowedDestinations).size !==
      evidence.allowedDestinations.length ||
    canonicalize([...evidence.allowedDestinations].sort()) !==
      canonicalize([...expected.allowedDestinations].sort())
  )
    issues.push("Squads destination allowlist is missing or unapproved.");
  if (
    evidence.configurationAuthority !== expected.configurationAuthority ||
    evidence.emergencyAuthority !== expected.emergencyAuthority
  )
    issues.push("Squads configuration or emergency authority mismatch.");
  if (
    !Number.isSafeInteger(evidence.observedSlot) ||
    evidence.observedSlot <= 0 ||
    !HASH.test(evidence.evidenceHash) ||
    !evidence.productionEvidence
  )
    issues.push("Squads on-chain production evidence is incomplete.");
  return Object.freeze(issues);
}
