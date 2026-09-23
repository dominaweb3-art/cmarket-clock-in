import assert from "node:assert/strict";
import test from "node:test";

import {
  C3_MAINNET,
  SQUADS_V4_REGISTRY_ID,
  readSymmetryVaultState,
  squadsRegistryStatus,
  symmetryAdapterRegistryStatus,
  validateSquadsEvidence,
  type SquadsOnChainEvidence,
} from "./support/index.ts";
import { vault, wallet } from "./fixtures.ts";

const expected = {
  members: [wallet, C3_MAINNET.usdcMint, C3_MAINNET.wrappedSolMint],
  multisigAddress: C3_MAINNET.symmetryGlobalConfig,
  vaultAddress: C3_MAINNET.cbBtcMint,
  timelockSeconds: 3_600,
  allowedDestinations: [vault],
  configurationAuthority: C3_MAINNET.portalEthMint,
  emergencyAuthority: C3_MAINNET.wrappedSolMint,
};

function evidence(
  programId: string = C3_MAINNET.squadsV4Program,
): SquadsOnChainEvidence {
  return {
    cluster: "mainnet-beta",
    programId,
    programExecutable: true,
    multisigAddress: expected.multisigAddress,
    multisigAccountOwner: programId,
    vaultAddress: expected.vaultAddress,
    members: [
      { address: wallet, role: "security", permissions: ["vote"] },
      {
        address: C3_MAINNET.usdcMint,
        role: "operations",
        permissions: ["vote"],
      },
      {
        address: C3_MAINNET.wrappedSolMint,
        role: "governance",
        permissions: ["vote"],
      },
    ],
    threshold: 2,
    timelockSeconds: expected.timelockSeconds,
    spendingLimitUsdcBaseUnits: "10000000",
    allowedDestinations: expected.allowedDestinations,
    configurationAuthority: expected.configurationAuthority,
    emergencyAuthority: expected.emergencyAuthority,
    observedSlot: 1,
  };
}

test("official Squads registry is pinned but fails closed", () => {
  const status = squadsRegistryStatus();
  assert.equal(status.officialProgramId, C3_MAINNET.squadsV4Program);
  assert.equal(status.enabled, false);
  assert.match(status.sourceUrl, /Squads-Protocol\/v4/);
  assert.match(status.auditedCommit, /^[a-f0-9]{40}$/);
  assert.match(
    validateSquadsEvidence(SQUADS_V4_REGISTRY_ID, evidence()).join(" "),
    /registry is disabled/,
  );
});

test("Jupiter cannot be self-certified as Squads", () => {
  const issues = validateSquadsEvidence(
    SQUADS_V4_REGISTRY_ID,
    evidence(C3_MAINNET.jupiterProgram),
  );
  assert.ok(
    issues.some((issue) =>
      /program identity, owner, or executable/.test(issue),
    ),
  );
});

test("unknown Squads registry identifiers are rejected", () => {
  assert.deepEqual(validateSquadsEvidence("caller-registry", evidence()), [
    "Unknown Squads registry identifier.",
  ]);
});

test("Symmetry production adapter registry stays empty and closed", async () => {
  const status = symmetryAdapterRegistryStatus();
  assert.equal(status.productionReady, false);
  assert.deepEqual(status.enabledAdapterIds, []);
  await assert.rejects(
    readSymmetryVaultState("caller-decoder-production"),
    /Unknown or disabled Symmetry adapter/,
  );
});
