/** Server-side authenticated owner preparation, submission and reconciliation.
 * The direct TLS entry is separate; approval precedes durable-state access. */
import type { Pool } from "pg";
import {
  OpenOwnerJournal,
  submitProductionOwnerPacket,
} from "./open-owner-journal.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { closeExpiredProductionOwnerRequest } from "./open-owner-expiry.ts";
import { readFile } from "node:fs/promises";
import {
  prepareOwnerFromDurableState,
  readOwnerPosition,
  productionOwnerRpc,
} from "./open-owner-service.ts";
import { reconcileProductionOwnerEconomics } from "./open-owner-effects.ts";
import { reconcileProductionOwnerRenewal } from "./open-owner-renewal.ts";
import { verifyOpenOwnerSchema } from "./open-owner-schema.ts";
import type {
  OpenCompilerPolicy,
  OpenOwnerAction,
} from "./open-owner-compiler.ts";
import {
  approvedOwnerCompilerPolicy,
  assertProductionEnrollment,
} from "./open-owner-trust.ts";
const bytes = (v: unknown, length?: number) => {
  if (
    typeof v !== "string" ||
    v.length > 2000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(v)
  )
    throw Error("C3_OWNER_HTTP_ENCODING");
  const b = Buffer.from(v, "base64");
  if (
    b.toString("base64") !== v ||
    (length !== undefined && b.length !== length)
  )
    throw Error("C3_OWNER_HTTP_ENCODING");
  return b;
};
/** No general route/callback override: monetary preparation/effect reconciliation
 * uses the source-reviewed compiler and independently checked evidence. */
export async function handleProductionOwnerProtocol(
  pool: Pool,
  origin: string,
  path: string,
  body: Record<string, unknown>,
  authorization: string | undefined,
  fetcher: typeof fetch = fetch,
) {
  const policy = requireOpenProductionPolicy(),
    journal = new OpenOwnerJournal(pool, origin);
  const fields = Object.keys(body).sort().join(",");
  if (
    path === "/v1/c3/owner/challenge" &&
    fields === "intentId" &&
    typeof body.intentId === "string"
  ) {
    await assertProductionEnrollment(pool, policy, body.intentId, "intent");
    const row = (
      await pool.query(
        "SELECT wallet,vault,configuration_hash FROM c3_open.intents WHERE intent_id=$1",
        [body.intentId],
      )
    ).rows[0];
    if (
      !row ||
      row.wallet !== policy.wallet ||
      row.vault !== policy.vault ||
      row.configuration_hash !== policy.configurationHash
    )
      throw Error("C3_OWNER_HTTP_SCOPE");
    return journal.challenge(body.intentId);
  }
  if (
    path === "/v1/c3/owner/session" &&
    fields === "challengeId,message,signature" &&
    typeof body.challengeId === "string"
  )
    return {
      token: await journal.authenticate(
        body.challengeId,
        bytes(body.message),
        bytes(body.signature, 64),
      ),
    };
  if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization))
    throw Error("C3_OWNER_HTTP_AUTH_REQUIRED");
  const token = authorization.slice(7);
  const url = new URL(path, origin);
  if (url.origin !== origin) throw Error("C3_OWNER_HTTP_ROUTE_UNAVAILABLE");
  const scopeId =
    typeof body.intentId === "string"
      ? body.intentId
      : typeof body.requestId === "string"
        ? body.requestId
        : (url.searchParams.get("intentId") ??
          url.searchParams.get("requestId"));
  if (scopeId)
    await assertProductionEnrollment(
      pool,
      policy,
      scopeId,
      typeof body.intentId === "string" || url.searchParams.has("intentId")
        ? "intent"
        : "request",
    );
  if (
    url.pathname === "/v1/c3/owner/prepare" &&
    fields === "action,intentId" &&
    typeof body.intentId === "string" &&
    typeof body.action === "string" &&
    [
      "deposit",
      "issue_shares",
      "request_redemption",
      "claim",
      "renew_plan",
    ].includes(body.action)
  ) {
    await journal.authorizeIntent(token, body.intentId);
    await verifyOpenOwnerSchema(pool);
    const row = (
      await pool.query(
        "SELECT share_mint FROM c3_open.intents WHERE intent_id=$1",
        [body.intentId],
      )
    ).rows[0];
    if (!row || row.share_mint !== policy.shareMint)
      throw Error("C3_OWNER_HTTP_SCOPE");
    const compilerPolicy: OpenCompilerPolicy =
      approvedOwnerCompilerPolicy(policy);
    const idl = await readFile(
      new URL("../resources/c3_pilot_vault.json", import.meta.url),
    );
    const prepared = await prepareOwnerFromDurableState(
      pool,
      compilerPolicy,
      idl,
      body.intentId,
      body.action as OpenOwnerAction,
      productionOwnerRpc(fetcher),
    );
    await journal.bindRequest(token, prepared.requestId);
    return prepared;
  }
  if (
    url.pathname === "/v1/c3/owner/position" &&
    fields === "" &&
    [...url.searchParams.keys()].join(",") === "intentId"
  ) {
    const intentId = url.searchParams.get("intentId")!;
    await journal.authorizeIntent(token, intentId);
    const row = (
      await pool.query(
        "SELECT share_mint FROM c3_open.intents WHERE intent_id=$1",
        [intentId],
      )
    ).rows[0];
    if (!row || row.share_mint !== policy.shareMint)
      throw Error("C3_OWNER_HTTP_SCOPE");
    return readOwnerPosition(
      pool,
      approvedOwnerCompilerPolicy(policy),
      intentId,
      productionOwnerRpc(fetcher),
    );
  }
  if (
    url.pathname === "/v1/c3/owner/reconcile" &&
    fields === "requestId" &&
    typeof body.requestId === "string"
  ) {
    await journal.authorizeRequest(token, body.requestId);
    const r = (
      await pool.query(
        "SELECT action FROM c3_open.owner_requests WHERE request_id=$1",
        [body.requestId],
      )
    ).rows[0];
    if (!r) throw Error("C3_OWNER_HTTP_SCOPE");
    return r.action === "renew_plan"
      ? reconcileProductionOwnerRenewal(pool, body.requestId, fetcher)
      : reconcileProductionOwnerEconomics(pool, body.requestId, fetcher);
  }
  if (
    url.pathname === "/v1/c3/owner/status" &&
    fields === "" &&
    [...url.searchParams.keys()].join(",") === "requestId"
  ) {
    const requestId = url.searchParams.get("requestId")!;
    await journal.authorizeRequest(token, requestId);
    const r = (
      await pool.query(
        `SELECT r.message_hash,s.signature,COALESCE(e.evidence_hash,g.evidence_hash) AS evidence_hash,o.evidence_hash AS closed_hash
      FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_submissions s USING(request_id)
      LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id)
      WHERE r.request_id=$1`,
        [requestId],
      )
    ).rows[0];
    if (!r) throw Error("C3_OWNER_HTTP_SCOPE");
    const state = r.evidence_hash
      ? "finalized"
      : r.closed_hash
        ? "closed_unexecuted"
        : r.signature
          ? "signed"
          : "uncertain";
    return {
      requestId,
      messageHash: r.message_hash.toString("hex"),
      signature: r.signature ?? null,
      state,
      ...(r.evidence_hash || r.closed_hash
        ? {
            economicEvidenceHash: (r.evidence_hash ?? r.closed_hash).toString(
              "hex",
            ),
            evidenceScope: "MAINNET_INDEPENDENT_RPC",
          }
        : {}),
    };
  }
  if (
    path === "/v1/c3/owner/recovery-bind" &&
    fields === "requestId" &&
    typeof body.requestId === "string"
  ) {
    await journal.bindRecovery(token, body.requestId);
    return { requestId: body.requestId };
  }
  if (
    path === "/v1/c3/owner/close-expired" &&
    fields === "cancelled,requestId" &&
    typeof body.requestId === "string" &&
    typeof body.cancelled === "boolean"
  ) {
    await journal.authorizeRequest(token, body.requestId);
    return closeExpiredProductionOwnerRequest(
      pool,
      body.requestId,
      body.cancelled,
      fetcher,
    );
  }
  if (
    path === "/v1/c3/owner/bind" &&
    fields === "requestId" &&
    typeof body.requestId === "string"
  ) {
    await journal.bindRequest(token, body.requestId);
    return { requestId: body.requestId };
  }
  if (
    path === "/v1/c3/owner/submit" &&
    fields === "packet,requestId" &&
    typeof body.requestId === "string"
  )
    return submitProductionOwnerPacket(
      pool,
      origin,
      token,
      body.requestId,
      bytes(body.packet),
      fetcher,
    );
  throw Error("C3_OWNER_HTTP_ROUTE_UNAVAILABLE");
}
