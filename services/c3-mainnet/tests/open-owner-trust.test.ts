import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { OpenProductionPolicy } from "../src/open-production-policy.ts";
import {
  approvedOwnerCompilerPolicy,
  assertProductionEnrollment,
} from "../src/open-owner-trust.ts";
import { canonicalize } from "../src/manifest.ts";
import { verifiedGenerationDeadline } from "../src/open-production-signer.ts";
import { compilerFixture } from "./open-owner-compiler.test.ts";
test("production scope rejects legacy enrollment, substituted mint and policy revision", async () => {
  const f = compilerFixture(),
    p = {
      ...f.policy,
      programId: f.policy.program,
    } as unknown as OpenProductionPolicy;
  const policyHash = createHash("sha256")
    .update(canonicalize(approvedOwnerCompilerPolicy(p)))
    .digest("hex");
  const row = {
    wallet: p.wallet,
    vault: p.vault,
    share_mint: p.shareMint,
    configuration_hash: p.configurationHash,
    policy_hash: policyHash,
  };
  for (const defect of [
    "",
    "missing",
    "mint",
    "revision",
    "wallet",
    "vault",
    "config",
  ]) {
    const r = { ...row };
    if (defect === "mint") r.share_mint = f.policy.governance;
    if (defect === "revision") r.policy_hash = "b".repeat(64);
    if (defect === "wallet") r.wallet = f.policy.keeper;
    if (defect === "vault") r.vault = f.policy.governance;
    if (defect === "config") r.configuration_hash = "b".repeat(64);
    const pool = {
      query: async (sql: string) => {
        assert.ok(sql.includes("production_enrollments"));
        return { rows: defect === "missing" ? [] : [r] };
      },
    } as unknown as Pool;
    if (defect)
      await assert.rejects(
        () => assertProductionEnrollment(pool, p, f.context.intentId, "intent"),
        /ENROLLMENT_REQUIRED/,
      );
    else
      await assertProductionEnrollment(pool, p, f.context.intentId, "intent");
  }
});
test("isolated quote signer accepts only its current owner-finalized generation deadline", () => {
  const r = {
    generation: "1",
    latest_generation: "1",
    generation_expiry: new Date(150000),
    intent_expiry: new Date(90000),
    plan_expiry: "150",
    db_now: new Date(100000),
    expires_at: new Date(120000),
  };
  assert.equal(verifiedGenerationDeadline(r).getTime(), 150000);
  for (const mutation of [
    { generation: "0", latest_generation: "0" },
    { latest_generation: "2" },
    { generation_expiry: null },
    { expires_at: new Date(150001) },
    { plan_expiry: "119" },
    { generation: "-1" },
    { generation_expiry: new Date(100000) },
  ])
    assert.throws(
      () => verifiedGenerationDeadline({ ...r, ...mutation }),
      /SIGNER_REJECTED/,
    );
});
