import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluationDispatchDiagnostic } from "../src/evaluation-service-journal.ts";
test("uncertain dispatch exposes a bounded public code, never transport text", () => {
  for (const [message, expected] of [
    ["EVAL_RPC_RATE_LIMIT", "RPC_RATE_LIMIT"],
    ["HTTP 429 secret", "RPC_RATE_LIMIT"],
    ["simulation: custom program error: 0x1770 secret", "PROGRAM_0X_1770"],
    ["Blockhash not found secret", "BLOCKHASH_NOT_FOUND"],
    ["insufficient funds secret", "INSUFFICIENT_FEE_OR_RENT"],
    ["https://private.example/?key=secret", "SEND_OR_PREFLIGHT_UNCERTAIN"],
  ])
    assert.equal(evaluationDispatchDiagnostic(new Error(message)), expected);
  assert.equal(
    evaluationDispatchDiagnostic(null),
    "SEND_OR_PREFLIGHT_UNCERTAIN",
  );
});
test("sale-plan construction uses credited swap outputs without subtracting donations twice", () => {
  const source = readFileSync(
    new URL("../src/evaluation-settlement-service.ts", import.meta.url),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("const acquired ="),
    source.indexOf("const build = evaluationCreatePlan"),
  );
  assert.ok(block.includes('deposit[n + "_after"]'));
  assert.ok(!block.includes('deposit[n + "_before"]'));
});
