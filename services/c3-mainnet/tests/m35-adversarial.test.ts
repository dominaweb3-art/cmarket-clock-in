import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import * as builderModule from "./support/synthetic-builder.ts";
import * as publicModule from "../src/public.ts";
import {
  C3_AMOUNTS,
  C3_MAINNET,
  InMemoryIntentRepository,
  buildDisabledUnsignedPackage,
  canonicalize,
  createAuthorizationContext,
  decodeCanonicalShortVector,
  inspectOfficialRpcEvidence,
  loadAuthorizationRecord,
  mulDivCeil,
  mulDivFloor,
  planAggregatedRebalance,
  type PersistedIntent,
} from "./support/index.ts";
import {
  authorizationFixture,
  fixtureSignature,
  makeV0Message,
  officialStatusFixture,
  officialTransactionFixture,
  wallet,
} from "./fixtures.ts";

test("caller policy validation has no direct or facade export", () => {
  for (const module of [builderModule, publicModule] as Record<
    string,
    unknown
  >[])
    assert.equal(module.validateCanonicalV0Transaction, undefined);
});

test("closed builder rejects destination, signer, program, metadata and instruction substitutions", () => {
  const context = createAuthorizationContext({
    policyIdentifier: "c3.deposit-intent.disabled-validation.v1",
    operation: "deposit_intent",
    wallet,
    inputAmountBaseUnits: "1000000",
    slippageBps: 50,
  });
  const mutations = [
    { destination: C3_MAINNET.cbBtcMint },
    { shareDestination: C3_MAINNET.cbBtcMint },
    { writableReadonlyCount: 2 },
    { extraSigner: C3_MAINNET.cbBtcMint },
    { program: C3_MAINNET.systemProgram },
    { data: Uint8Array.of(9) },
  ];
  for (const mutation of mutations)
    assert.throws(
      () =>
        buildDisabledUnsignedPackage(
          context.intentId,
          makeV0Message(mutation),
          context.issuedAtUnix,
        ),
      `builder accepted ${Object.keys(mutation)[0]}`,
    );
});

test("authorization views are deep copies and caller hashes cannot replace sealed records", () => {
  const issued = authorizationFixture();
  const original = loadAuthorizationRecord(issued.intentId);
  const view = loadAuthorizationRecord(issued.intentId);
  (view.expectedEffects[0] as { amountBaseUnits: string }).amountBaseUnits =
    "1";
  (view.expectedDestinations as string[])[0] = wallet;
  (view.compiledInstructions[0]!.accountIndexes as number[])[0] = 99;
  (view.staticAccounts[0] as { writable: boolean }).writable = false;
  const spread = {
    ...view,
    wallet: C3_MAINNET.wrappedSolMint,
    authorizationHash: "f".repeat(64),
  };
  assert.notDeepEqual(spread, original);
  assert.deepEqual(loadAuthorizationRecord(issued.intentId), original);
  assert.deepEqual(
    loadAuthorizationRecord(JSON.parse(JSON.stringify(issued)).intentId),
    original,
  );
});

test("persistence never accepts a caller authorization at create or CAS transition", () => {
  const authorization = authorizationFixture();
  const base: PersistedIntent = {
    schemaVersion: "c3-intent/v2",
    intentId: authorization.intentId,
    idempotencyKey: authorization.idempotencyKey,
    configurationHash: authorization.configurationHash,
    wallet: authorization.wallet,
    operation: authorization.operation,
    inputAmountBaseUnits: authorization.inputAmountBaseUnits,
    state: "draft",
    revision: 1,
    createdAtUnix: authorization.issuedAtUnix,
    updatedAtUnix: authorization.issuedAtUnix,
    expiresAtUnix: authorization.expiresAtUnix,
    recoveryAttempts: 0,
  };
  const repo = new InMemoryIntentRepository();
  assert.throws(
    () =>
      repo.create({
        ...base,
        authorizationHash: authorization.authorizationHash,
      }),
    /Pre-submission/,
  );
  repo.create(base);
  const waiting = repo.transition(
    base.intentId,
    1,
    "draft",
    "awaiting_wallet",
    base.createdAtUnix + 1,
  );
  const forged = structuredClone(authorization) as Record<string, unknown>;
  forged.wallet = C3_MAINNET.wrappedSolMint;
  forged.expectedDestinations = [C3_MAINNET.cbBtcMint];
  forged.expectedEffects = [
    { ...authorization.expectedEffects[0], amountBaseUnits: "1" },
  ];
  const payload = { ...forged };
  delete payload.authorizationHash;
  forged.authorizationHash = createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
  assert.throws(
    () =>
      repo.transition(
        base.intentId,
        waiting.revision,
        "awaiting_wallet",
        "intent_submitted",
        base.createdAtUnix + 2,
        {
          submittedSignature: fixtureSignature,
          authorizationManifest: forged,
        } as Parameters<typeof repo.transition>[5],
      ),
    /immutable field/,
  );
  const submitted = repo.transition(
    base.intentId,
    waiting.revision,
    "awaiting_wallet",
    "intent_submitted",
    base.createdAtUnix + 2,
    {
      submittedSignature: fixtureSignature,
    },
  );
  assert.equal(submitted.authorizationHash, authorization.authorizationHash);
  assert.throws(
    () =>
      repo.transition(
        base.intentId,
        submitted.revision,
        "intent_submitted",
        "keeper_pending",
        base.createdAtUnix + 3,
        {
          authorizationHash: "f".repeat(64),
        } as Parameters<typeof repo.transition>[5],
      ),
    /immutable field/,
  );
});

test("official parser rejects normalized self-certified evidence and malformed raw bytes", () => {
  const auth = authorizationFixture();
  const inspect = (tx: unknown, status: unknown = officialStatusFixture()) =>
    inspectOfficialRpcEvidence(tx, status, fixtureSignature, auth.intentId);
  assert.throws(
    () =>
      inspect({
        canonicalV0MessageHash: auth.canonicalV0MessageHash,
        expectedEffects: auth.expectedEffects,
      }),
    /version-0/,
  );
  assert.throws(
    () =>
      inspect(
        officialTransactionFixture(auth, { transaction: ["AQ==", "base64"] }),
      ),
    /signer count or size/,
  );
  assert.throws(
    () => inspect(officialTransactionFixture(auth, { slot: 11 })),
    /slot or block time/,
  );
  assert.throws(
    () =>
      inspect(officialTransactionFixture(auth), {
        ...officialStatusFixture(),
        confirmationStatus: "confirmed",
      }),
    /not finalized/,
  );
  assert.throws(
    () =>
      inspect(officialTransactionFixture(auth), {
        ...officialStatusFixture(),
        err: { InstructionError: [0, "Custom"] },
      }),
    /not finalized/,
  );
});

test("official parser rejects altered token balances, loaded accounts and hostile inner CPI", () => {
  const auth = authorizationFixture();
  const baseline = officialTransactionFixture(auth);
  const meta = structuredClone(baseline.meta);
  meta.postTokenBalances[0]!.uiTokenAmount.amount = "1";
  assert.throws(
    () =>
      inspectOfficialRpcEvidence(
        { ...baseline, meta },
        officialStatusFixture(),
        fixtureSignature,
        auth.intentId,
      ),
    /token effects differ/,
  );
  const loaded = structuredClone(baseline.meta);
  loaded.loadedAddresses.writable.push(wallet as never);
  assert.throws(
    () =>
      inspectOfficialRpcEvidence(
        { ...baseline, meta: loaded },
        officialStatusFixture(),
        fixtureSignature,
        auth.intentId,
      ),
    /ALT addresses/,
  );
  const hostile = structuredClone(baseline.meta);
  hostile.innerInstructions[0]!.instructions.push({
    programIdIndex: 6,
    accounts: [1],
    data: "2",
  } as never);
  assert.throws(
    () =>
      inspectOfficialRpcEvidence(
        { ...baseline, meta: hostile },
        officialStatusFixture(),
        fixtureSignature,
        auth.intentId,
      ),
    /sealed inner CPI|unapproved program/,
  );
});

test("official parser rejects malformed metadata, mismatched time, ownership and lamports", () => {
  const auth = authorizationFixture();
  const baseline = officialTransactionFixture(auth);
  const inspect = (tx: unknown) =>
    inspectOfficialRpcEvidence(
      tx,
      officialStatusFixture(),
      fixtureSignature,
      auth.intentId,
    );
  for (const mutation of [
    { blockTime: auth.expiresAtUnix + 1 },
    { meta: { ...baseline.meta, err: { InstructionError: [0, "Custom"] } } },
    { meta: { ...baseline.meta, logMessages: null } },
    { meta: { ...baseline.meta, innerInstructions: null } },
    { meta: { ...baseline.meta, fee: 1 } },
    { meta: { ...baseline.meta, postBalances: [995_000, 1, 0, 0, 0, 0, 0] } },
    {
      meta: {
        ...baseline.meta,
        postTokenBalances: baseline.meta.postTokenBalances.map((row, index) =>
          index === 0 ? { ...row, owner: C3_MAINNET.cbBtcMint } : row,
        ),
      },
    },
    {
      meta: {
        ...baseline.meta,
        postTokenBalances: baseline.meta.postTokenBalances.map((row, index) =>
          index === 0
            ? { ...row, uiTokenAmount: { ...row.uiTokenAmount, decimals: 9 } }
            : row,
        ),
      },
    },
  ])
    assert.throws(() => inspect({ ...baseline, ...mutation }));
});

test("keeper cannot treat boolean claims or fabricated evidence identifiers as authority", () => {
  const input = {
    oracleEvidenceId: "fabricated",
    routeEvidenceId: "fabricated",
    oracleVerified: true,
    routeRegistryVerified: true,
  };
  assert.throws(() => planAggregatedRebalance(input), /identifiers only/);
  assert.throws(
    () =>
      planAggregatedRebalance({
        oracleEvidenceId: "fabricated",
        routeEvidenceId: "fabricated",
      }),
    /EXTERNAL_CONFIGURATION_MISSING/,
  );
});

test("u64/u128 monetary boundaries fail closed without rounding overflow", () => {
  const max = C3_AMOUNTS.u64Max;
  assert.equal(mulDivFloor(max, 1n, 1n), max);
  assert.equal(mulDivCeil(1n, 1n, 2n), 1n);
  for (const bad of [-1n, max + 1n, (1n << 128n) + 1n])
    assert.throws(() => mulDivFloor(bad, 1n, 1n), /unsigned 64-bit range/);
  assert.throws(() => mulDivFloor(max, max, 1n), /unsigned 64-bit range/);
  assert.throws(() => mulDivCeil(max, max, 1n), /unsigned 64-bit range/);
  assert.throws(() => mulDivFloor(1n, 1n, 0n), /divisor/);
});

test("strict ShortU16 accepts canonical boundaries and rejects every overflow form", () => {
  const good: [number[], number][] = [
    [[0], 0],
    [[127], 127],
    [[128, 1], 128],
    [[255, 127], 16_383],
    [[128, 128, 1], 16_384],
    [[255, 255, 3], 65_535],
  ];
  for (const [bytes, value] of good)
    assert.equal(decodeCanonicalShortVector(Uint8Array.from(bytes)), value);
  const bad = [
    [128, 128, 4],
    [255, 255, 127],
    [128, 0],
    [128],
    [255, 255, 128],
    [128, 128, 8],
    [128, 128, 1, 0],
  ];
  for (const bytes of bad)
    assert.throws(() => decodeCanonicalShortVector(Uint8Array.from(bytes)));
});
