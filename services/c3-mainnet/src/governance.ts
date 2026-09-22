import { C3_MAINNET } from "./constants.ts";
import { publicKeyBytes } from "./solana.ts";

export const SQUADS_V4_REGISTRY_ID = "squads-v4-official-64af7330";

export type SquadsRegistryEntry = Readonly<{
  registryId: string;
  programId: string;
  sourceUrl: string;
  auditedCommit: string;
  accountLayoutReviewComplete: false;
  instructionReviewComplete: false;
  enabled: false;
}>;

const SQUADS_REGISTRY: ReadonlyMap<string, SquadsRegistryEntry> = new Map([
  [
    SQUADS_V4_REGISTRY_ID,
    Object.freeze({
      registryId: SQUADS_V4_REGISTRY_ID,
      programId: C3_MAINNET.squadsV4Program,
      sourceUrl: "https://github.com/Squads-Protocol/v4",
      auditedCommit: "64af7330413d5c85cbbccfd8c27a05d45b6e666f",
      accountLayoutReviewComplete: false,
      instructionReviewComplete: false,
      enabled: false,
    }),
  ],
]);

export type SquadsOnChainEvidence = Readonly<{
  cluster: "mainnet-beta";
  programId: string;
  programExecutable: boolean;
  multisigAddress: string;
  multisigAccountOwner: string;
  vaultAddress: string;
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
}>;

export function squadsRegistryStatus(): Readonly<{
  registryId: string;
  officialProgramId: string;
  sourceUrl: string;
  auditedCommit: string;
  enabled: false;
  reason: string;
}> {
  const entry = SQUADS_REGISTRY.get(SQUADS_V4_REGISTRY_ID)!;
  return Object.freeze({
    registryId: entry.registryId,
    officialProgramId: entry.programId,
    sourceUrl: entry.sourceUrl,
    auditedCommit: entry.auditedCommit,
    enabled: false,
    reason:
      "Official account layouts, discriminators, and the C Market deployment are not independently verified.",
  });
}

export function validateSquadsEvidence(
  registryId: string,
  evidence: SquadsOnChainEvidence,
): readonly string[] {
  const issues: string[] = [];
  const registry = SQUADS_REGISTRY.get(registryId);
  if (!registry) return Object.freeze(["Unknown Squads registry identifier."]);
  if (!registry.enabled)
    issues.push(
      "Official Squads registry is disabled until layouts, discriminators, and deployment evidence are independently verified.",
    );
  if (
    evidence.programId !== registry.programId ||
    evidence.multisigAccountOwner !== registry.programId ||
    !evidence.programExecutable
  )
    issues.push(
      "Squads program identity, owner, or executable status mismatch.",
    );
  try {
    for (const address of [
      evidence.programId,
      evidence.multisigAddress,
      evidence.vaultAddress,
      evidence.configurationAuthority,
      evidence.emergencyAuthority,
      ...evidence.members.map((member) => member.address),
    ])
      publicKeyBytes(address);
  } catch {
    issues.push("Squads evidence contains a malformed public key.");
  }
  const members = evidence.members.map((member) => member.address);
  if (members.length !== 3 || new Set(members).size !== 3)
    issues.push("Squads evidence does not contain three unique members.");
  if (evidence.threshold !== 2)
    issues.push("Squads threshold must be exactly 2-of-3.");
  if (evidence.timelockSeconds <= 0) issues.push("Squads timelock is missing.");
  if (evidence.multisigAddress === evidence.vaultAddress)
    issues.push("Squads multisig and vault identities must be distinct.");
  if (!/^[1-9]\d*$/.test(evidence.spendingLimitUsdcBaseUnits))
    issues.push("Squads spending limit is missing or invalid.");
  if (
    evidence.allowedDestinations.length === 0 ||
    new Set(evidence.allowedDestinations).size !==
      evidence.allowedDestinations.length
  )
    issues.push("Squads destination allowlist is missing or duplicated.");
  if (evidence.configurationAuthority === evidence.emergencyAuthority)
    issues.push(
      "Squads configuration and emergency authorities are not separated.",
    );
  if (
    !Number.isSafeInteger(evidence.observedSlot) ||
    evidence.observedSlot <= 0
  )
    issues.push("Squads observation slot is invalid.");
  return Object.freeze(issues);
}
