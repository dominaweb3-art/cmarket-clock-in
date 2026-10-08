import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  EVALUATION,
  evaluationPdas,
  evaluationJournalSql,
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
