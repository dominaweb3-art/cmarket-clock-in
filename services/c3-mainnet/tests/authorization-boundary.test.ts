import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { verifyDurableAuthorization } from "../src/authorization.ts";
import { canonicalize } from "../src/manifest.ts";
import { authorizationFixture } from "./fixtures.ts";

function binding(record: ReturnType<typeof authorizationFixture>) {
  return {
    intentId: record.intentId,
    idempotencyKey: record.idempotencyKey,
    configurationHash: record.configurationHash,
    wallet: record.wallet,
    operation: record.operation,
    inputAmountBaseUnits: record.inputAmountBaseUnits,
  };
}

test("pure production authorization verifier accepts a canonical test fixture", () => {
  const record = authorizationFixture();
  const verified = verifyDurableAuthorization(
    canonicalize(record),
    record.authorizationHash,
    binding(record),
  );
  assert.equal(verified.authorizationHash, record.authorizationHash);
  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.expectedEffects));
  assert.ok(Object.isFrozen((verified.expectedEffects as unknown[])[0]));
});

test("pure verifier rejects malformed, substituted and noncanonical records", () => {
  const record = authorizationFixture();
  const expected = binding(record);
  const canonical = canonicalize(record);
  assert.throws(() =>
    verifyDurableAuthorization("{}", record.authorizationHash, expected),
  );
  assert.throws(() =>
    verifyDurableAuthorization(
      canonical + " ",
      record.authorizationHash,
      expected,
    ),
  );
  assert.throws(() =>
    verifyDurableAuthorization(canonical, "f".repeat(64), expected),
  );
  assert.throws(() =>
    verifyDurableAuthorization(canonical, record.authorizationHash, {
      ...expected,
      wallet: record.vault,
    }),
  );
  const payload = { ...record } as Record<string, unknown>;
  delete payload.authorizationHash;
  const wrongNetwork = { ...payload, cluster: "devnet" };
  const wrongHash = createHash("sha256")
    .update(canonicalize(wrongNetwork))
    .digest("hex");
  assert.throws(() =>
    verifyDurableAuthorization(
      canonicalize({ ...wrongNetwork, authorizationHash: wrongHash }),
      wrongHash,
      expected,
    ),
  );
});
