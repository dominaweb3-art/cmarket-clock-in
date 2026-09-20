import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDisabledUnsignedPackage,
  C3_MAINNET,
  computeManifestHash,
  redactOperationalError,
  validateDeploymentManifest,
  validateOracleEvidence,
  type C3DeploymentManifest,
  type UnsignedBuildRequest,
} from "../src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(
    path.join(root, "config/deployment-manifest.proposed.json"),
    "utf8",
  ),
) as C3DeploymentManifest;
const wallet = C3_MAINNET.cbBtcMint;
const vault = C3_MAINNET.symmetryGlobalConfig;
const fingerprint = "a".repeat(64);

function request(): UnsignedBuildRequest {
  return {
    operation: "deposit_intent",
    intentId: `c3-${"1".repeat(32)}`,
    idempotencyKey: "2".repeat(64),
    configurationVersion: manifest.schemaVersion,
    manifest,
    wallet,
    feePayer: wallet,
    vault,
    inputMint: C3_MAINNET.usdcMint,
    inputAmountBaseUnits: "1000000",
    expectedShareOutputBaseUnits: "1000000",
    minimumShareOutputBaseUnits: "990000",
    feeBaseUnits: "0",
    bountyBaseUnits: "245000",
    networkAndRentEstimateBaseUnits: "5000",
    expiresAtUnix: 1_100,
    quoteObservedAtUnix: 995,
    quoteExpiresAtUnix: 1_015,
    blockhashExpiresAtUnix: 1_060,
    nowUnix: 1_000,
    expectedSigners: [wallet],
    expectedWritableAccounts: [wallet, vault],
    expectedDestinations: [vault],
    allowedInstructionKinds: ["create_deposit_intent"],
    approvedRoutePrograms: [],
    expectedTokenDebits: [
      {
        owner: wallet,
        mint: C3_MAINNET.usdcMint,
        minimumAmountBaseUnits: "1000000",
        maximumAmountBaseUnits: "1000000",
      },
    ],
    expectedTokenCredits: [
      {
        owner: vault,
        mint: C3_MAINNET.usdcMint,
        minimumAmountBaseUnits: "1000000",
        maximumAmountBaseUnits: "1000000",
      },
    ],
    expectedClosableAccounts: [],
    instructions: [
      {
        programId: C3_MAINNET.symmetryProgram,
        kind: "create_deposit_intent",
        dataFingerprint: fingerprint,
        accounts: [
          {
            address: wallet,
            role: "user_authority",
            signer: true,
            writable: true,
          },
          { address: vault, role: "vault", signer: false, writable: true },
        ],
        tokenDebit: {
          owner: wallet,
          mint: C3_MAINNET.usdcMint,
          amountBaseUnits: "1000000",
        },
        tokenCredit: {
          owner: vault,
          mint: C3_MAINNET.usdcMint,
          amountBaseUnits: "1000000",
        },
      },
    ],
    lookupTables: [],
    estimatedTransactionBytes: 400,
    expectedPostConditions: [
      "vault USDC increases; user receives proportional C3 shares only after reconciliation",
    ],
    reconciliationRequirements: [
      "primary reviewed RPC finalized evidence",
      "independent secondary operator finalized evidence",
    ],
  };
}

test("strict proposed deployment manifest and immutable hash validate", () => {
  const result = validateDeploymentManifest(manifest);
  assert.equal(result.valid, true, result.issues.join("; "));
  assert.equal(
    computeManifestHash(manifest),
    manifest.immutableConfigurationHash,
  );
  assert.ok(result.missingPublicInputs.includes("vault.address"));
  assert.ok(result.missingPublicInputs.includes("squads.memberAddresses[0]"));
});

test("manifest rejects wrong cluster, Devnet identity, allocation, HTTP, active fees, capability bypass, and placeholders", () => {
  const mutations: Array<(candidate: Record<string, unknown>) => void> = [
    (value) => {
      value.cluster = "devnet";
    },
    (value) => {
      value.genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
    },
    (value) => {
      (value.allocation as Record<string, unknown>).btcBps = 3_999;
    },
    (value) => {
      (value.oracles as Record<string, unknown>).endpoint =
        "http://oracle.invalid";
    },
    (value) => {
      (value.fees as Record<string, unknown>).collectionEnabled = true;
    },
    (value) => {
      value.executionCapability = true;
    },
    (value) => {
      (value.pilot as Record<string, unknown>).publicAccessEnabled = true;
    },
    (value) => {
      (value.pilot as Record<string, unknown>).allowlistRoot = "bypass";
    },
    (value) => {
      (value.authorities as Record<string, unknown>).governance =
        "TODO-governance";
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(manifest) as Record<string, unknown>;
    mutate(candidate);
    candidate.immutableConfigurationHash = computeManifestHash(candidate);
    assert.equal(validateDeploymentManifest(candidate).valid, false);
  }
});

test("oracle validation rejects stale, malformed, unauthenticated, wrong feed, and excessive confidence evidence", () => {
  const evidence = {
    asset: "cbBTC" as const,
    feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    source: "pyth-core" as const,
    network: "mainnet-beta" as const,
    authenticated: true,
    priceMantissa: "10000000000",
    confidenceMantissa: "1000000",
    exponent: -5,
    publishTimeUnix: 995,
    receivedTimeUnix: 1_000,
  };
  assert.equal(
    validateOracleEvidence(evidence, {
      maximumAgeSeconds: 60,
      maximumConfidenceBps: 200,
    }).priceUsdMicros,
    100_000_000_000n,
  );
  assert.throws(() =>
    validateOracleEvidence(
      { ...evidence, publishTimeUnix: 900 },
      { maximumAgeSeconds: 60, maximumConfidenceBps: 200 },
    ),
  );
  assert.throws(() =>
    validateOracleEvidence(
      { ...evidence, authenticated: false },
      { maximumAgeSeconds: 60, maximumConfidenceBps: 200 },
    ),
  );
  assert.throws(() =>
    validateOracleEvidence(
      { ...evidence, feedId: "0".repeat(64) },
      { maximumAgeSeconds: 60, maximumConfidenceBps: 200 },
    ),
  );
  assert.throws(() =>
    validateOracleEvidence(
      { ...evidence, confidenceMantissa: "300000000" },
      { maximumAgeSeconds: 60, maximumConfidenceBps: 200 },
    ),
  );
  assert.throws(() =>
    validateOracleEvidence(
      { ...evidence, priceMantissa: "null" },
      { maximumAgeSeconds: 60, maximumConfidenceBps: 200 },
    ),
  );
});

test("disabled builder produces only a fingerprinted unsigned authorization package", () => {
  const result = buildDisabledUnsignedPackage(request());
  assert.equal(result.executionCapability, false);
  assert.equal(result.inputAmountBaseUnits, "1000000");
  assert.equal(result.expectedDestinations.length, 1);
  assert.match(result.unsignedTransactionFingerprint, /^[a-f0-9]{64}$/);
});

test("builder rejects wrong mint, unknown program/instruction, writable account, signer, destination and token debit", () => {
  const mutations: Array<(candidate: UnsignedBuildRequest) => void> = [
    (value) => {
      (value as { inputMint: string }).inputMint = C3_MAINNET.cbBtcMint;
    },
    (value) => {
      (value.instructions[0] as { programId: string }).programId =
        C3_MAINNET.jupiterProgram;
    },
    (value) => {
      (value.instructions[0] as { kind: string }).kind = "unknown";
    },
    (value) => {
      (value.instructions[0]!.accounts[1] as { address: string }).address =
        C3_MAINNET.portalEthMint;
    },
    (value) => {
      (value.instructions[0]!.accounts[1] as { signer: boolean }).signer = true;
    },
    (value) => {
      (value.instructions[0]!.tokenCredit as { owner: string }).owner =
        C3_MAINNET.portalEthMint;
    },
    (value) => {
      (
        value.instructions[0]!.tokenDebit as { amountBaseUnits: string }
      ).amountBaseUnits = "1000001";
    },
    (value) => {
      (value.instructions[0]!.tokenCredit as { mint: string }).mint =
        C3_MAINNET.cbBtcMint;
    },
    (value) => {
      (value as unknown as { expectedSigners: string[] }).expectedSigners.push(
        vault,
      );
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(request());
    mutate(candidate);
    assert.throws(() => buildDisabledUnsignedPackage(candidate));
  }
});

test("builder rejects stale evidence, below-minimum, float-like input, SOL transfer, unsafe close, hostile ALT and oversized transaction", () => {
  const mutations: Array<(candidate: UnsignedBuildRequest) => void> = [
    (value) => {
      (value as { quoteExpiresAtUnix: number }).quoteExpiresAtUnix = 999;
    },
    (value) => {
      (value as { inputAmountBaseUnits: string }).inputAmountBaseUnits =
        "999999";
    },
    (value) => {
      (value as { inputAmountBaseUnits: string }).inputAmountBaseUnits = "1.5";
    },
    (value) => {
      (value.instructions[0] as { systemTransfer?: unknown }).systemTransfer = {
        source: wallet,
        destination: vault,
        lamports: "1",
      };
    },
    (value) => {
      (value.instructions[0] as { closeAccount?: unknown }).closeAccount = {
        account: vault,
        refundDestination: wallet,
        expectedEphemeralWsol: true,
      };
    },
    (value) => {
      (value as unknown as { lookupTables: unknown[] }).lookupTables = [
        {
          address: vault,
          ownerProgram: C3_MAINNET.addressLookupTableProgram,
          active: true,
          addressesFingerprint: "a".repeat(64),
          approvedFingerprint: "b".repeat(64),
        },
      ];
    },
    (value) => {
      (
        value as { estimatedTransactionBytes: number }
      ).estimatedTransactionBytes = 1_233;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(request());
    mutate(candidate);
    assert.throws(() => buildDisabledUnsignedPackage(candidate));
  }
});

test("secret-bearing errors are redacted", () => {
  const redacted = redactOperationalError(
    new Error(
      'Bearer abc123 x-api-key="secret456" https://user:pass@example.com',
    ),
  );
  assert.doesNotMatch(redacted.message, /abc123|secret456|user:pass/);
  assert.match(redacted.message, /REDACTED/);
});
