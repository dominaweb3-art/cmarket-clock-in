import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as production from "../src/index.ts";
import {
  C3_MAINNET,
  C3_MAINNET_EXECUTION_CAPABILITY,
  InMemoryManifestRepository,
  buildDisabledUnsignedPackage,
  canonicalize,
  computeManifestHash,
  createAuthorizationContext,
  decodeCanonicalShortVector,
  decodeVersionedMessage,
  operationPolicyRegistryStatus,
  parseAndVerifyAuthorizationManifest,
  validateDeploymentManifest,
  type C3AuthorizationManifest,
  type C3DeploymentManifest,
} from "../src/index.ts";
import {
  authorizationFixture,
  makeV0Message,
  userShares,
  vault,
  wallet,
} from "./fixtures.ts";

function rehash(manifest: C3AuthorizationManifest): string {
  const payload = { ...manifest } as Record<string, unknown>;
  delete payload.authorizationHash;
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function maliciousCanonical(
  manifest: C3AuthorizationManifest,
  mutation: Record<string, unknown>,
): string {
  const changed = { ...structuredClone(manifest), ...mutation } as Record<
    string,
    unknown
  >;
  changed.authorizationHash = rehash(changed as C3AuthorizationManifest);
  return canonicalize(changed);
}

test("Mainnet capability is an immutable false constant", () => {
  assert.equal(C3_MAINNET_EXECUTION_CAPABILITY, false);
  assert.equal(operationPolicyRegistryStatus().executionCapability, false);
});

test("caller cannot submit a self-certified operation policy", () => {
  assert.throws(
    () =>
      createAuthorizationContext({
        policyIdentifier: "c3.deposit-intent.disabled-validation.v1",
        operation: "deposit_intent",
        wallet,
        inputAmountBaseUnits: "1000000",
        slippageBps: 50,
        destination: vault,
      } as Parameters<typeof createAuthorizationContext>[0]),
    /unauthorized field/,
  );
  assert.throws(
    () =>
      createAuthorizationContext({
        policyIdentifier: "caller-policy",
        operation: "deposit_intent",
        wallet,
        inputAmountBaseUnits: "1000000",
        slippageBps: 50,
      }),
    /Unknown server operation policy/,
  );
});

test("coordinated malicious destination and instruction are rejected", () => {
  const context = createAuthorizationContext({
    policyIdentifier: "c3.deposit-intent.disabled-validation.v1",
    operation: "deposit_intent",
    wallet,
    inputAmountBaseUnits: "1000000",
    slippageBps: 50,
  });
  assert.throws(
    () =>
      buildDisabledUnsignedPackage(
        context.intentId,
        makeV0Message({
          destination: C3_MAINNET.cbBtcMint,
          data: Uint8Array.of(9),
        }),
        context.issuedAtUnix,
      ),
    /instructions differ from the sealed policy/,
  );
});

test("valid authorization is externally bound to trusted storage", () => {
  const manifest = authorizationFixture();
  assert.deepEqual(
    parseAndVerifyAuthorizationManifest(
      canonicalize(manifest),
      manifest.intentId,
      manifest.issuedAtUnix,
    ),
    manifest,
  );
});

test("wallet mutation with attacker-recalculated hash is rejected", () => {
  const manifest = authorizationFixture();
  assert.throws(
    () =>
      parseAndVerifyAuthorizationManifest(
        maliciousCanonical(manifest, { wallet: C3_MAINNET.wrappedSolMint }),
        manifest.intentId,
        manifest.issuedAtUnix,
      ),
    /does not match trusted storage/,
  );
});

test("every immutable authorization context field rejects recomputed hashes", () => {
  const manifest = authorizationFixture();
  const mutations: Record<string, unknown>[] = [
    { intentId: `c3-${"a".repeat(48)}` },
    { idempotencyKey: "b".repeat(64) },
    { policyIdentifier: "caller-policy" },
    { policyVersion: "999" },
    { configurationVersion: "caller-config" },
    { vaultIdentifier: "caller-vault" },
    { cluster: "devnet" },
    { operation: "redemption_intent" },
    { wallet: C3_MAINNET.wrappedSolMint },
    { inputAmountBaseUnits: "2000000" },
    { slippageBps: 99 },
    { nonce: "c".repeat(64) },
    { issuedAtUnix: 999 },
    { expiresAtUnix: 1_049 },
    { recentBlockhash: C3_MAINNET.cbBtcMint },
    {
      canonicalV0MessageBase64: makeV0Message({
        blockhash: C3_MAINNET.cbBtcMint,
      }),
    },
    { staticAccounts: [] },
    { loadedAccounts: [{ address: userShares }] },
  ];
  for (const mutation of mutations)
    assert.throws(
      () =>
        parseAndVerifyAuthorizationManifest(
          maliciousCanonical(manifest, mutation),
          manifest.intentId,
          manifest.issuedAtUnix,
        ),
      /does not match trusted storage/,
      `mutation was not rejected: ${Object.keys(mutation)[0]}`,
    );
});

test("authorization context expires before build or verification", () => {
  const context = createAuthorizationContext({
    policyIdentifier: "c3.deposit-intent.disabled-validation.v1",
    operation: "deposit_intent",
    wallet,
    inputAmountBaseUnits: "1000000",
    slippageBps: 50,
  });
  assert.throws(
    () =>
      buildDisabledUnsignedPackage(
        context.intentId,
        makeV0Message(),
        context.expiresAtUnix,
      ),
    /context is expired/,
  );
});

test("canonical shortvec accepts boundaries", () => {
  assert.equal(decodeCanonicalShortVector(Uint8Array.of(0)), 0);
  assert.equal(decodeCanonicalShortVector(Uint8Array.of(127)), 127);
  assert.equal(decodeCanonicalShortVector(Uint8Array.of(0x80, 0x01)), 128);
});

test("shortvec rejects redundant, truncated, overflow, and trailing encodings", () => {
  assert.throws(
    () => decodeCanonicalShortVector(Uint8Array.of(0x80, 0x00)),
    /Non-canonical/,
  );
  assert.throws(
    () => decodeCanonicalShortVector(Uint8Array.of(0x80)),
    /Truncated/,
  );
  assert.throws(
    () => decodeCanonicalShortVector(Uint8Array.of(0xff, 0xff, 0xff)),
    /excessive, or overflowing/,
  );
  assert.throws(
    () => decodeCanonicalShortVector(Uint8Array.of(0, 0)),
    /trailing bytes/,
  );
});

test("non-canonical Solana message shortvec alternate encoding is rejected", () => {
  const original = Uint8Array.from(Buffer.from(makeV0Message(), "base64"));
  const altered = Uint8Array.from([
    ...original.slice(0, 4),
    original[4]! | 0x80,
    0,
    ...original.slice(5),
  ]);
  assert.throws(
    () => decodeVersionedMessage(Buffer.from(altered).toString("base64"), []),
    /Non-canonical short vector/,
  );
});

test("fabricated manifest approvals cannot advance lifecycle", () => {
  const path = new URL(
    "../config/deployment-manifest.proposed.json",
    import.meta.url,
  );
  const proposed = JSON.parse(
    readFileSync(path, "utf8"),
  ) as C3DeploymentManifest;
  assert.equal(validateDeploymentManifest(proposed).valid, true);
  const fabricated = structuredClone(proposed) as Record<string, unknown>;
  fabricated.status = "verified";
  const approvals = fabricated.approvals as Record<string, unknown>;
  for (const key of Object.keys(approvals)) approvals[key] = true;
  fabricated.immutableConfigurationHash = computeManifestHash(fabricated);
  assert.equal(validateDeploymentManifest(fabricated).valid, false);
  const repository = new InMemoryManifestRepository();
  const manifestId = `c3-manifest-${"1".repeat(16)}`;
  repository.createProposed(manifestId, proposed);
  assert.throws(
    () =>
      repository.transition(manifestId, 1, fabricated as C3DeploymentManifest, [
        "fabricated-security-receipt",
      ]),
    /does not bind the previous|lifecycle state is invalid|trusted evidence/,
  );
});

test("test-only trust factories are absent from the production entrypoint", () => {
  const names = production as Record<string, unknown>;
  for (const forbidden of [
    "deriveTrustedOperationPolicy",
    "validateTrustedPolicy",
    "ReviewedRpcRegistry",
    "ReviewedRpcProvider",
    "ReadOnlySymmetryAdapter",
    "validateSymmetryDescriptor",
    "assertManifestLifecycleTransition",
  ])
    assert.equal(names[forbidden], undefined, `${forbidden} leaked publicly`);
});
