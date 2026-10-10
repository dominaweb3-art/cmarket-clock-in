import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { OpenOwnerJournal } from "../src/open-owner-journal-core.ts";
import {
  EVALUATION,
  evaluationPdas,
  evaluationJournalSql,
  evaluationJournalPool,
} from "../src/evaluation-scope.ts";

test("evaluation PDAs isolate owners and match the Rust hashv seed preimage", () => {
  const a = "FnkzNN99YHhoR6Lu5kfnYj5X4ULLqoKTyi5P5xpBJhAZ";
  const b = "6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC";
  assert.notEqual(
    evaluationPdas(a).vault.toString(),
    evaluationPdas(b).vault.toString(),
  );
  const seed = createHash("sha256")
    .update(
      Buffer.concat([Buffer.from("c3-vault-v1"), new PublicKey(a).toBuffer()]),
    )
    .digest();
  assert.equal(
    evaluationPdas(a).vault.toString(),
    PublicKey.findProgramAddressSync(
      [seed],
      new PublicKey(EVALUATION.program),
    )[0].toString(),
  );
  assert.notEqual(
    evaluationPdas(a).vault.toString(),
    evaluationPdas(a).authority.toString(),
  );
  assert.equal(EVALUATION.mainnetEnabled, false);
  assert.equal(
    EVALUATION.weights.reduce((a, b) => a + b),
    10000,
  );
});
test("actual owner-request binding remains schema-isolated without an auth alias collision", async () => {
  const sessionHash = Buffer.alloc(32, 7);
  const seen: string[] = [];
  const now = new Date();
  const client = {
    release() {},
    async query(sql: string) {
      seen.push(sql);
      assert.ok(!sql.includes("c3_open."));
      if (sql.startsWith("SELECT r.*"))
        return {
          rows: [
            {
              now,
              session_expiry: new Date(+now + 60000),
              expires_at: new Date(+now + 60000),
              expected_db_revision: 2,
              db_revision: 2,
              expected_chain_revision: 1,
              chain_revision: 1,
              session_hash: sessionHash,
            },
          ],
        };
      if (sql.startsWith("SELECT session_hash"))
        return { rows: [{ session_hash: sessionHash }] };
      return { rows: [] };
    },
  };
  const pool = evaluationJournalPool({
    connect: async () => client,
  } as unknown as Pool);
  await new OpenOwnerJournal(
    pool,
    "https://cmarket-nine.vercel.app",
  ).bindRequest("a".repeat(64), "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.ok(
    seen.some(
      (sql) =>
        sql.includes("c3_eval.owner_challenges proof") &&
        sql.includes("proof.audience=$3"),
    ),
  );
  assert.equal(seen.at(-1), "COMMIT");
  for (const schema of ["auth", "storage", "public", "c3"])
    assert.throws(
      () => evaluationJournalSql(`SELECT * FROM ${schema}.owner_challenges`),
      /EVAL_JOURNAL_QUERY_SCOPE/,
    );
});
test("journal relocation has no caller-selected schema or prepared statement escape", () => {
  assert.equal(
    evaluationJournalSql("SELECT * FROM c3_open.intents WHERE intent_id=$1"),
    "SELECT * FROM c3_eval.intents WHERE intent_id=$1",
  );
  assert.equal(evaluationJournalSql("BEGIN"), "BEGIN");
  for (const value of [
    { text: "SELECT * FROM c3_open.intents" },
    "SELECT * FROM c3.intents",
    "SELECT * FROM public.wallets",
    "SELECT * FROM c3_eval.intents",
  ])
    assert.throws(
      () => evaluationJournalSql(value),
      /EVAL_JOURNAL_QUERY_SCOPE/,
    );
});
