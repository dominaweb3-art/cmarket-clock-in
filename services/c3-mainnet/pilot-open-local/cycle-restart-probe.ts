/** Separate process, existing disposable PG only. No signing or submission. */
import assert from "node:assert/strict";
import pg from "pg";
import { OpenLocalSettlementRepository } from "./orchestrator.ts";
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.match(url.pathname, /^\/c3_test_[a-f0-9]{12}$/);
assert.equal(url.pathname.slice(1), process.env.C3_DISPOSABLE_TEST_DATABASE);
const [id, ordinalText, signature] = process.argv.slice(2);
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
assert.match(ordinalText ?? "", /^[0-5]$/);
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
try {
  const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool);
  const state = await db.read(id!),
    leg = await db.readLeg(id!, Number(ordinalText));
  assert.equal(leg.signature, signature);
  assert.ok(state);
  console.log(
    JSON.stringify({
      pid: process.pid,
      state: state.state,
      dbRevision: state.dbRevision.toString(),
      chainRevision: state.chainRevision.toString(),
      signaturePreserved: true,
    }),
  );
} finally {
  await pool.end();
}
