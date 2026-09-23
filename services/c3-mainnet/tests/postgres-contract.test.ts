import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  C3_AMOUNTS,
  C3_MAINNET_EXECUTION_CAPABILITY,
} from "../src/constants.ts";
import {
  PostgresC3Repository,
  validateNewDurableIntent,
} from "../src/postgres.ts";

const schema = readFileSync(
  new URL("../migrations/0001_c3_state.sql", import.meta.url),
  "utf8",
);

test("versioned SQL declares every required durable state table and immutable guard", () => {
  for (const table of [
    "c3_intents",
    "c3_authorizations",
    "c3_idempotency_keys",
    "c3_evidence",
    "c3_rpc_observations",
    "c3_reconciled_snapshots",
    "c3_manifest_events",
    "c3_recovery_attempts",
    "c3_outbox_events",
    "c3_audit_log",
  ])
    assert.match(schema, new RegExp(`CREATE TABLE ${table}\\b`));
  assert.match(schema, /CREATE TRIGGER c3_authorizations_immutable/);
  assert.match(schema, /CREATE TRIGGER c3_intent_guard/);
  assert.match(schema, /CREATE TRIGGER c3_intent_no_delete/);
  assert.match(schema, /BEGIN ISOLATION LEVEL SERIALIZABLE|c3_outbox_events/);
  assert.equal(C3_MAINNET_EXECUTION_CAPABILITY, false);
});

test("server-only factory fails closed without or with malformed configuration", () => {
  const original = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    assert.throws(
      () => PostgresC3Repository.fromServerEnvironment(),
      /missing/,
    );
    process.env.DATABASE_URL = "invalid";
    assert.throws(
      () => PostgresC3Repository.fromServerEnvironment(),
      /malformed/,
    );
    process.env.DATABASE_URL = "postgresql://example.invalid/c3";
    assert.throws(() => PostgresC3Repository.fromServerEnvironment(), /TLS/);
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});

test("u64 intent bounds and canonical identity are checked before persistence", () => {
  const intent = {
    intentId: `c3-${"a".repeat(32)}`,
    idempotencyKey: "b".repeat(64),
    configurationVersion: "candidate/v1",
    configurationHash: "c".repeat(64),
    wallet: "11111111111111111111111111111111",
    operation: "deposit_intent",
    inputAmountBaseUnits: C3_AMOUNTS.u64Max,
    expiresAt: new Date(Date.now() + 60_000),
  } as const;
  assert.doesNotThrow(() => validateNewDurableIntent(intent));
  for (const amount of [-1n, 0n, C3_AMOUNTS.u64Max + 1n])
    assert.throws(() =>
      validateNewDurableIntent({ ...intent, inputAmountBaseUnits: amount }),
    );
  assert.throws(() =>
    validateNewDurableIntent({ ...intent, wallet: "not-a-wallet" }),
  );
});
