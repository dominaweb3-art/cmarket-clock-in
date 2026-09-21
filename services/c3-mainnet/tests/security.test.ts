import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDisabledUnsignedPackage,
  canonicalize,
  computeManifestHash,
  deriveAssociatedTokenAddress,
  deriveTrustedOperationPolicy,
  parseAndVerifyAuthorizationManifest,
  redactOperationalError,
  validateCanonicalV0Transaction,
  validateDeploymentManifest,
  validateOracleEvidence,
  validateTrustedPolicy,
  type C3DeploymentManifest,
  type TrustedOperationPolicy,
} from "../src/index.ts";
import {
  authorizationFixture,
  makeV0Message,
  trustedPolicy,
  userShares,
  userUsdc,
  vault,
  vaultUsdc,
  wallet,
} from "./fixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(
    path.join(root, "config/deployment-manifest.proposed.json"),
    "utf8",
  ),
) as C3DeploymentManifest;

test("strict proposed deployment manifest validates but remains explicitly incomplete", () => {
  const result = validateDeploymentManifest(manifest);
  assert.equal(result.valid, true, result.issues.join("; "));
  assert.equal(
    computeManifestHash(manifest),
    manifest.immutableConfigurationHash,
  );
  assert.ok(result.missingPublicInputs.includes("vault.address"));
  assert.ok(result.missingPublicInputs.includes("symmetryAdapter.adapterId"));
  assert.ok(
    result.missingPublicInputs.includes("operationPolicies.deposit_intent"),
  );
});

test("manifest rejects wrong network, allocation, active fees, capability, duplicate Squads members and placeholders", () => {
  const mutations: Array<(candidate: Record<string, unknown>) => void> = [
    (value) => {
      value.cluster = "devnet";
    },
    (value) => {
      value.genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
    },
    (value) => {
      (value.allocation as Record<string, unknown>).btcBps = 3999;
    },
    (value) => {
      (value.fees as Record<string, unknown>).collectionEnabled = true;
    },
    (value) => {
      value.executionCapability = true;
    },
    (value) => {
      (value.authorities as Record<string, unknown>).governance =
        "TODO-governance";
    },
    (value) => {
      (value.squads as Record<string, unknown>).memberAddresses = [
        wallet,
        wallet,
        wallet,
      ];
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(manifest) as Record<string, unknown>;
    mutate(candidate);
    candidate.immutableConfigurationHash = computeManifestHash(candidate);
    assert.equal(validateDeploymentManifest(candidate).valid, false);
  }
});

test("oracle validation rejects stale, unauthenticated, wrong-feed and excessive-confidence evidence", () => {
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
    receivedTimeUnix: 1000,
  };
  assert.equal(
    validateOracleEvidence(evidence, {
      maximumAgeSeconds: 60,
      maximumConfidenceBps: 200,
    }).priceUsdMicros,
    100_000_000_000n,
  );
  for (const candidate of [
    { ...evidence, publishTimeUnix: 900 },
    { ...evidence, authenticated: false },
    { ...evidence, feedId: "0".repeat(64) },
    { ...evidence, confidenceMantissa: "300000000" },
  ])
    assert.throws(() =>
      validateOracleEvidence(candidate, {
        maximumAgeSeconds: 60,
        maximumConfidenceBps: 200,
      }),
    );
});

test("caller-facing intent cannot supply or override policy and proposed manifest cannot derive one", () => {
  const intent = {
    operation: "deposit_intent" as const,
    intentId: `c3-${"1".repeat(32)}`,
    idempotencyKey: "2".repeat(64),
    wallet,
    inputAmountBaseUnits: "1000000",
    slippageBps: 100,
    nowUnix: 1000,
  };
  assert.deepEqual(Object.keys(intent).sort(), [
    "idempotencyKey",
    "inputAmountBaseUnits",
    "intentId",
    "nowUnix",
    "operation",
    "slippageBps",
    "wallet",
  ]);
  assert.throws(
    () => deriveTrustedOperationPolicy(manifest, intent),
    /incomplete/,
  );
  const callerPolicy = trustedPolicy();
  validateTrustedPolicy(callerPolicy, 1000);
  assert.throws(
    () => buildDisabledUnsignedPackage(intent, callerPolicy, makeV0Message()),
    /trusted policy factory/,
  );
  for (const override of [
    { vault },
    { treasury: vault },
    { feeDestination: vault },
    { expectedEffects: [] },
    { signer: vault },
    { writableAccounts: [vault] },
  ])
    assert.throws(() =>
      buildDisabledUnsignedPackage(
        { ...intent, ...override } as typeof intent,
        callerPolicy,
        makeV0Message(),
      ),
    );
});

test("canonical v0 validation rejects coordinated destination, vault, signer, writable, program, instruction and ATA mutations", () => {
  const policy = trustedPolicy();
  const decoded = validateCanonicalV0Transaction(policy, makeV0Message());
  assert.equal(decoded.staticAccounts[0]?.address, wallet);
  assert.equal(decoded.instructions.length, 1);
  const arbitrary = deriveAssociatedTokenAddress(vault, policy.shareMint);
  const hostileMessages = [
    makeV0Message({ destination: vaultUsdc }),
    makeV0Message({ shareDestination: userUsdc }),
    makeV0Message({ vault: arbitrary }),
    makeV0Message({ program: policy.inputMint }),
    makeV0Message({ data: Uint8Array.of(1, 2, 3, 5) }),
    makeV0Message({ writableReadonlyCount: 2 }),
    makeV0Message({ extraSigner: userShares }),
  ];
  for (const message of hostileMessages)
    assert.throws(() => validateCanonicalV0Transaction(policy, message));

  const fakePolicy = structuredClone(policy) as TrustedOperationPolicy;
  (fakePolicy.instructions[0]!.accountAddresses as string[])[2] = arbitrary;
  assert.throws(() =>
    buildDisabledUnsignedPackage(
      {
        operation: "deposit_intent",
        intentId: `c3-${"1".repeat(32)}`,
        idempotencyKey: "2".repeat(64),
        wallet,
        inputAmountBaseUnits: "1000000",
        slippageBps: 100,
        nowUnix: 1000,
      },
      fakePolicy,
      makeV0Message({ vault: arbitrary }),
    ),
  );
});

test("authorization hash binds every critical field, order, blockhash and exact instruction bytes", () => {
  const authorization = authorizationFixture();
  const canonical = canonicalize(authorization);
  assert.equal(
    parseAndVerifyAuthorizationManifest(canonical, 1000).authorizationHash,
    authorization.authorizationHash,
  );
  const mutations: Array<(candidate: Record<string, unknown>) => void> = [
    (value) => {
      value.wallet = vault;
    },
    (value) => {
      value.cluster = "devnet";
    },
    (value) => {
      value.operation = "redemption_intent";
    },
    (value) => {
      value.inputAmountBaseUnits = "1000001";
    },
    (value) => {
      value.recentBlockhash = wallet;
    },
    (value) => {
      value.configurationVersion = "other";
    },
    (value) => {
      value.intentId = `c3-${"f".repeat(32)}`;
    },
    (value) => {
      value.staticAccounts = [...(value.staticAccounts as unknown[])].reverse();
    },
    (value) => {
      const instructions = structuredClone(value.compiledInstructions) as Array<
        Record<string, unknown>
      >;
      instructions[0]!.dataBase64 = "AQIDBQ==";
      value.compiledInstructions = instructions;
    },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(authorization) as unknown as Record<
      string,
      unknown
    >;
    mutate(candidate);
    assert.throws(() =>
      parseAndVerifyAuthorizationManifest(canonicalize(candidate), 1000),
    );
  }
  const omitted = structuredClone(authorization) as unknown as Record<
    string,
    unknown
  >;
  delete omitted.vault;
  assert.throws(() =>
    parseAndVerifyAuthorizationManifest(canonicalize(omitted), 1000),
  );
  assert.throws(() =>
    parseAndVerifyAuthorizationManifest(JSON.stringify(authorization), 1000),
  );
  assert.throws(
    () => parseAndVerifyAuthorizationManifest(canonical, 1010),
    /expired/,
  );
  const duplicate = canonical.replace(
    '{"allowedPrograms"',
    '{"wallet":"duplicate","allowedPrograms"',
  );
  assert.throws(() => parseAndVerifyAuthorizationManifest(duplicate, 1000));
});

test("secret-bearing operational errors are redacted", () => {
  const redacted = redactOperationalError(
    new Error(
      'Bearer abc123 x-api-key="secret456" https://user:pass@example.com',
    ),
  );
  assert.doesNotMatch(redacted.message, /abc123|secret456|user:pass/);
  assert.match(redacted.message, /REDACTED/);
});
