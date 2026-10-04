/** Source-approved compiler scope and immutable PostgreSQL enrollment. Never
 * accept a policy, mint or approval supplied by an HTTP caller or legacy row. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { OpenProductionPolicy } from "./open-production-policy.ts";
import type { OpenCompilerPolicy } from "./open-owner-compiler.ts";
import { canonicalize } from "./manifest.ts";
export function approvedOwnerCompilerPolicy(
  p: OpenProductionPolicy,
): OpenCompilerPolicy {
  return {
    version: "c3-owner-compiler/v1",
    program: p.programId,
    vault: p.vault,
    wallet: p.wallet,
    shareMint: p.shareMint,
    governance: p.governance,
    keeper: p.keeper,
    maxSlippageBps: p.maxSlippageBps,
    idlHash: p.idlHash,
    configurationHash: p.configurationHash,
    registryRevision: p.registryRevision,
    quotePolicyRevision: p.quotePolicyRevision,
  };
}
export async function assertProductionEnrollment(
  pool: Pool,
  p: OpenProductionPolicy,
  id: string,
  kind: "intent" | "request" | "quote",
) {
  const row = (
    await pool.query(
      `SELECT i.wallet,i.vault,i.share_mint,i.configuration_hash,e.policy_hash FROM c3_open.intents i JOIN c3_open.production_enrollments e USING(intent_id) ${kind === "request" ? "JOIN c3_open.owner_requests r USING(intent_id)" : kind === "quote" ? "JOIN c3_open.quote_authorizations q USING(intent_id)" : ""} WHERE ${kind === "request" ? "r.request_id" : kind === "quote" ? "q.quote_id" : "i.intent_id"}=$1`,
      [kind === "quote" ? Buffer.from(id, "hex") : id],
    )
  ).rows[0];
  const expected = createHash("sha256")
    .update(canonicalize(approvedOwnerCompilerPolicy(p)))
    .digest("hex");
  if (
    !row ||
    row.wallet !== p.wallet ||
    row.vault !== p.vault ||
    row.share_mint !== p.shareMint ||
    row.configuration_hash !== p.configurationHash ||
    row.policy_hash !== expected
  )
    throw Error("C3_OWNER_PRODUCTION_ENROLLMENT_REQUIRED");
}
