import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  C3_MAINNET,
  canonicalize,
  computeManifestHash,
  findProgramAddress,
  publicKeyBytes,
  ReadOnlySymmetryAdapter,
  validateDeploymentManifest,
  validateSquadsEvidence,
  validateSymmetryDescriptor,
  validateSymmetryVaultState,
  type C3DeploymentManifest,
  type ReviewedSymmetryDescriptor,
  type SquadsDerivationPolicy,
  type SquadsOnChainEvidence,
  type SymmetryVaultState,
} from "../src/index.ts";
import { shareMint, vault, wallet } from "./fixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proposed = JSON.parse(
  await readFile(
    path.join(root, "config/deployment-manifest.proposed.json"),
    "utf8",
  ),
) as C3DeploymentManifest;

test("every post-proposal lifecycle fails closed without state-specific receipts and public evidence", () => {
  for (const status of [
    "verified",
    "security_approved",
    "governance_approved",
    "deployment_ready",
    "deployed",
    "paused",
  ] as const) {
    const candidate = structuredClone(proposed) as Record<string, unknown>;
    candidate.status = status;
    candidate.immutableConfigurationHash = computeManifestHash(candidate);
    const result = validateDeploymentManifest(candidate);
    assert.equal(result.valid, false, `${status} unexpectedly validated`);
    assert.ok(
      result.issues.some((issue) =>
        /receipt|unresolved|evidence|registry|adapter/.test(issue),
      ),
    );
  }
});

const derivationPolicy: SquadsDerivationPolicy = {
  schemaVersion: "c3-squads-derivation/v1",
  programId: C3_MAINNET.jupiterProgram,
  sourceUrl: "https://docs.squads.so/",
  sourceHash: "1".repeat(64),
  multisigSeedPrefixBase64: Buffer.from("multisig").toString("base64"),
  vaultSeedPrefixBase64: Buffer.from("vault").toString("base64"),
  productionReviewed: true,
};
const createKey = C3_MAINNET.cbBtcMint;
const multisigAddress = findProgramAddress(
  [Buffer.from("multisig"), publicKeyBytes(createKey)],
  derivationPolicy.programId,
).address;
const vaultAddress = findProgramAddress(
  [Buffer.from("vault"), publicKeyBytes(multisigAddress), Uint8Array.of(0)],
  derivationPolicy.programId,
).address;
const members = [wallet, C3_MAINNET.portalEthMint, C3_MAINNET.wrappedSolMint];
const policyHash = createHash("sha256")
  .update(canonicalize(derivationPolicy))
  .digest("hex");

function squadsEvidence(
  mutation: Partial<SquadsOnChainEvidence> = {},
): SquadsOnChainEvidence {
  return {
    cluster: "mainnet-beta",
    programId: derivationPolicy.programId,
    multisigAddress,
    multisigAccountOwner: derivationPolicy.programId,
    vaultAddress,
    createKey,
    vaultIndex: 0,
    members: [
      { address: members[0]!, role: "security", permissions: ["vote"] },
      { address: members[1]!, role: "operations", permissions: ["vote"] },
      { address: members[2]!, role: "governance", permissions: ["vote"] },
    ],
    threshold: 2,
    timelockSeconds: 86400,
    spendingLimitUsdcBaseUnits: "10000000",
    allowedDestinations: [vault],
    configurationAuthority: members[0]!,
    emergencyAuthority: members[2]!,
    observedSlot: 1,
    evidenceHash: "2".repeat(64),
    productionEvidence: true,
    ...mutation,
  };
}

const expectedSquads = {
  members,
  multisigAddress,
  vaultAddress,
  timelockSeconds: 86400,
  allowedDestinations: [vault],
  configurationAuthority: members[0]!,
  emergencyAuthority: members[2]!,
  derivationPolicyHash: policyHash,
};

test("Squads verification derives PDAs and rejects duplicates, wrong threshold/program/owner/PDA/timelock/limits/destinations", () => {
  assert.deepEqual(
    validateSquadsEvidence(squadsEvidence(), derivationPolicy, expectedSquads),
    [],
  );
  const cases = [
    squadsEvidence({
      members: squadsEvidence().members.map((member) => ({
        ...member,
        address: wallet,
      })),
    }),
    squadsEvidence({ threshold: 1 }),
    squadsEvidence({ threshold: 3 }),
    squadsEvidence({ programId: vault }),
    squadsEvidence({ multisigAccountOwner: vault }),
    squadsEvidence({ vaultAddress: multisigAddress }),
    squadsEvidence({ vaultIndex: 1 }),
    squadsEvidence({ timelockSeconds: 0 }),
    squadsEvidence({ spendingLimitUsdcBaseUnits: "0" }),
    squadsEvidence({ allowedDestinations: [shareMint] }),
    squadsEvidence({ productionEvidence: false }),
  ];
  for (const candidate of cases)
    assert.ok(
      validateSquadsEvidence(candidate, derivationPolicy, expectedSquads)
        .length > 0,
    );
});

const descriptor: ReviewedSymmetryDescriptor = {
  schemaVersion: "c3-symmetry-adapter/v1",
  adapterId: "symmetry-reviewed-layout-v1",
  programId: C3_MAINNET.symmetryProgram,
  globalConfig: C3_MAINNET.symmetryGlobalConfig,
  authoritativeSourceUrl: "https://docs.symmetry.fi/",
  authoritativeSourceHash: "3".repeat(64),
  accountLayoutHash: "4".repeat(64),
  instructionLayoutHash: "5".repeat(64),
  sdkDependencySafe: true,
  productionReviewed: true,
};

function symmetryState(
  mutation: Partial<SymmetryVaultState> = {},
): SymmetryVaultState {
  return {
    programId: C3_MAINNET.symmetryProgram,
    globalConfig: C3_MAINNET.symmetryGlobalConfig,
    vault,
    shareMint,
    authority: wallet,
    shareSupplyBaseUnits: "1000000",
    targetBps: { btc: 4000, eth: 3000, sol: 3000 },
    balances: { USDC: "1", cbBTC: "1", PortalETH: "1", WSOL: "1" },
    observedSlot: 1,
    evidenceFingerprint: "6".repeat(64),
    adapterId: descriptor.adapterId,
    productionEvidence: true,
    ...mutation,
  };
}

test("Symmetry boundary rejects placeholder/unsafe adapters and incomplete or mismatched state", async () => {
  assert.deepEqual(validateSymmetryDescriptor(descriptor), []);
  for (const candidate of [
    { ...descriptor, adapterId: "placeholder" },
    { ...descriptor, programId: vault },
    { ...descriptor, sdkDependencySafe: false },
    { ...descriptor, productionReviewed: false },
  ])
    assert.ok(validateSymmetryDescriptor(candidate).length > 0);
  for (const state of [
    symmetryState({ programId: vault }),
    symmetryState({ globalConfig: shareMint }),
    symmetryState({ vault: shareMint }),
    symmetryState({ shareMint: vault }),
    symmetryState({ shareSupplyBaseUnits: "0" }),
    symmetryState({ balances: {} as SymmetryVaultState["balances"] }),
    symmetryState({ balances: { ...symmetryState().balances, cbBTC: "bad" } }),
    symmetryState({ productionEvidence: false }),
  ])
    assert.ok(
      validateSymmetryVaultState(
        state,
        { vault, shareMint, authority: wallet },
        descriptor,
      ).length > 0,
    );

  const adapter = new ReadOnlySymmetryAdapter(
    descriptor,
    { decodeVaultAccount: () => symmetryState() },
    async () => ({
      address: vault,
      ownerProgram: C3_MAINNET.symmetryProgram,
      executable: false,
      lamports: "1",
      dataBase64: "AQ==",
      observedSlot: 1,
      source: "synthetic-test",
    }),
  );
  await assert.rejects(
    () => adapter.readVaultState({ vault, shareMint, authority: wallet }),
    /malformed|wrongly owned/,
  );
});
