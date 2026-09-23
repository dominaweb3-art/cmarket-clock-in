import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryIntentRepository,
  inspectOfficialRpcEvidence,
  planAggregatedRebalance,
  reconcileFinalizedSignature,
  type PersistedIntent,
} from "./support/index.ts";
import {
  authorizationFixture,
  fixtureSignature,
  officialStatusFixture,
  officialTransactionFixture,
  wallet,
} from "./fixtures.ts";

const authorizations = new Map<
  string,
  ReturnType<typeof authorizationFixture>
>();

function draft(expiryOffsetSeconds = 50): PersistedIntent {
  const authorization = authorizationFixture();
  authorizations.set(authorization.intentId, authorization);
  const createdAtUnix = authorization.issuedAtUnix;
  return {
    schemaVersion: "c3-intent/v2",
    intentId: authorization.intentId,
    idempotencyKey: authorization.idempotencyKey,
    configurationHash: authorization.configurationHash,
    wallet,
    operation: "deposit_intent",
    inputAmountBaseUnits: "1000000",
    state: "draft",
    revision: 1,
    createdAtUnix,
    updatedAtUnix: createdAtUnix,
    expiresAtUnix: createdAtUnix + expiryOffsetSeconds,
    recoveryAttempts: 0,
  };
}

function reachFailed(
  repository: InMemoryIntentRepository,
  record: PersistedIntent,
) {
  const authorization = authorizations.get(record.intentId);
  if (!authorization) throw new Error("Test authorization fixture is missing.");
  const signature = fixtureSignature;
  let current = repository.transition(
    record.intentId,
    1,
    "draft",
    "awaiting_wallet",
    record.createdAtUnix + 1,
  );
  current = repository.transition(
    record.intentId,
    current.revision,
    "awaiting_wallet",
    "intent_submitted",
    record.createdAtUnix + 2,
    { submittedSignature: signature },
  );
  return repository.transition(
    record.intentId,
    current.revision,
    "intent_submitted",
    "failed_recoverable",
    record.createdAtUnix + 3,
  );
}

test("keeper requires internally registered evidence before proposing a rebalance", () => {
  assert.throws(
    () =>
      planAggregatedRebalance({
        oracleEvidenceId: "fabricated-oracle",
        routeEvidenceId: "fabricated-route",
      }),
    /EXTERNAL_CONFIGURATION_MISSING/,
  );
});

test("keeper rejects caller-supplied monetary data and verification booleans", () => {
  assert.throws(
    () =>
      planAggregatedRebalance({
        oracleEvidenceId: "fabricated-oracle",
        routeEvidenceId: "fabricated-route",
        oracleVerified: true,
      } as Parameters<typeof planAggregatedRebalance>[0]),
    /identifiers only/,
  );
});

test("three recovery attempts increment atomically and the fourth is rejected", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  let current = reachFailed(repository, initial);
  const base = initial.createdAtUnix;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    current = repository.transition(
      initial.intentId,
      current.revision,
      "failed_recoverable",
      "keeper_pending",
      base + 3 + attempt * 2 - 1,
    );
    assert.equal(current.recoveryAttempts, attempt);
    current = repository.transition(
      initial.intentId,
      current.revision,
      "keeper_pending",
      "failed_recoverable",
      base + 3 + attempt * 2,
    );
  }
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        current.revision,
        "failed_recoverable",
        "keeper_pending",
        base + 10,
      ),
    /budget is exhausted/,
  );
});

test("recovery cannot exceed the immutable 24-hour window", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft(100_000);
  repository.create(initial);
  const failed = reachFailed(repository, initial);
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        failed.revision,
        "failed_recoverable",
        "keeper_pending",
        initial.createdAtUnix + 86_400,
      ),
    /24 hours/,
  );
});

test("expiry is enforced on read and transition", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft(10);
  repository.create(initial);
  assert.throws(
    () => repository.read(initial.intentId, initial.expiresAtUnix),
    /Expired intent/,
  );
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        1,
        "draft",
        "awaiting_wallet",
        initial.expiresAtUnix,
      ),
    /Expired intent/,
  );
});

test("stale revision and concurrent update are rejected", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  repository.transition(
    initial.intentId,
    1,
    "draft",
    "awaiting_wallet",
    initial.createdAtUnix + 1,
  );
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        1,
        "draft",
        "cancelled",
        initial.createdAtUnix + 2,
      ),
    /compare-and-swap conflict/,
  );
});

test("submitted signatures survive repository restart", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  const failed = reachFailed(repository, initial);
  const restarted = InMemoryIntentRepository.hydrate([failed]);
  assert.equal(
    restarted.read(initial.intentId, initial.createdAtUnix + 4)
      ?.submittedSignature,
    failed.submittedSignature,
  );
});

test("caller-created RPC providers cannot satisfy production quorum", async () => {
  const authorization = authorizationFixture();
  await assert.rejects(
    reconcileFinalizedSignature(
      fixtureSignature,
      authorization.intentId,
      "caller-created-two-provider-registry",
    ),
    /unknown sealed RPC registry identifier/,
  );
});

test("official raw RPC fixture is reconstructed and incomplete mint evidence fails closed", () => {
  const authorization = authorizationFixture();
  assert.throws(
    () =>
      inspectOfficialRpcEvidence(
        officialTransactionFixture(authorization),
        officialStatusFixture(),
        fixtureSignature,
        authorization.intentId,
      ),
    /share supply and SPL mint\/burn evidence are unavailable/,
  );
  assert.throws(
    () =>
      inspectOfficialRpcEvidence(
        {
          ...officialTransactionFixture(authorization),
          transaction: ["AQ==", "base64"],
        },
        officialStatusFixture(),
        fixtureSignature,
        authorization.intentId,
      ),
    /signer count or size/,
  );
});

test("fabricated settlement evidence cannot settle an intent", () => {
  const repository = new InMemoryIntentRepository();
  const initial = draft();
  repository.create(initial);
  const failed = reachFailed(repository, initial);
  const pendingState = repository.transition(
    initial.intentId,
    failed.revision,
    "failed_recoverable",
    "keeper_pending",
    initial.createdAtUnix + 4,
  );
  assert.throws(
    () =>
      repository.transition(
        initial.intentId,
        pendingState.revision,
        "keeper_pending",
        "settled",
        initial.createdAtUnix + 5,
        {
          verifiedSettlement: {
            signature: pendingState.submittedSignature!,
            effectsFingerprint: "f".repeat(64),
          },
        },
      ),
    /not produced by independent reconciliation/,
  );
});
