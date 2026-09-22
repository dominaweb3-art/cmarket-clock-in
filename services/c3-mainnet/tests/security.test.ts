import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as production from "../src/index.ts";
import {
  C3_MAINNET,
  C3_MAINNET_EXECUTION_CAPABILITY,
  InMemoryManifestRepository,
  buildDisabledUnsignedPackage,
  computeManifestHash,
  createAuthorizationContext,
  decodeCanonicalShortVector,
  decodeVersionedMessage,
  operationPolicyRegistryStatus,
  loadAuthorizationRecord,
  validateDeploymentManifest,
  type C3DeploymentManifest,
} from "../src/index.ts";
import {
  authorizationFixture,
  makeV0Message,
  vault,
  wallet,
} from "./fixtures.ts";

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
  assert.deepEqual(loadAuthorizationRecord(manifest.intentId), manifest);
});

test("returned authorization mutations cannot alter trusted storage", () => {
  const manifest = authorizationFixture();
  const original = loadAuthorizationRecord(manifest.intentId);
  (manifest as { wallet: string }).wallet = C3_MAINNET.wrappedSolMint;
  (manifest.expectedEffects[0] as { amountBaseUnits: string }).amountBaseUnits =
    "1";
  (manifest.expectedDestinations as string[])[0] = C3_MAINNET.cbBtcMint;
  assert.deepEqual(loadAuthorizationRecord(manifest.intentId), original);
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
    /third byte|excessive, or overflowing/,
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
    "validateCanonicalV0Transaction",
    "parseAndVerifyAuthorizationManifest",
    "inspectSanitizedRpcFixture",
  ])
    assert.equal(names[forbidden], undefined, `${forbidden} leaked publicly`);
});
