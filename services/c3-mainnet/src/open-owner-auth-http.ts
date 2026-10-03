/** Server-side owner authentication bridge. Hosting/TLS termination is separate;
 * source approval is checked BEFORE touching durable state. No keys loaded. */
import type { Pool } from "pg";
import {
  OpenOwnerJournal,
  submitProductionOwnerPacket,
} from "./open-owner-journal.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { closeExpiredProductionOwnerRequest } from "./open-owner-expiry.ts";
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
 * must use their source-reviewed compiler; this handles only auth/bind/submission. */
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
  if (
    url.pathname === "/v1/c3/owner/status" &&
    fields === "" &&
    [...url.searchParams.keys()].join(",") === "requestId"
  ) {
    const requestId = url.searchParams.get("requestId")!;
    await journal.authorizeRequest(token, requestId);
    const r = (
      await pool.query(
        `SELECT r.message_hash,s.signature,e.evidence_hash,o.evidence_hash AS closed_hash
      FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_submissions s USING(request_id)
      LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id)
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
