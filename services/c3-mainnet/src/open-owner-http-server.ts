/** Direct TLS listener. No trusted proxy header, dynamic CORS origin, body log,
 * transaction cache or automatic reconciliation/signing loop. */
import { createServer, type ServerOptions } from "node:https";
import type { Pool } from "pg";
import { handleProductionOwnerProtocol } from "./open-owner-auth-http.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { verifyOpenOwnerSchema } from "./open-owner-schema.ts";
export async function createProductionOwnerHttpsServer(
  pool: Pool,
  origin: string,
  tls: ServerOptions,
) {
  requireOpenProductionPolicy(); // no DB/TLS/listener side effect before approval
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    !tls.key ||
    !tls.cert
  )
    throw Error("C3_OWNER_HTTPS_CONFIGURATION_REQUIRED");
  await verifyOpenOwnerSchema(pool);
  const server = createServer(
    { ...tls, minVersion: "TLSv1.3" },
    async (req, res) => {
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      try {
        if (
          req.headers.host !== url.host ||
          req.headers.origin ||
          req.headers["transfer-encoding"] ||
          !req.url?.startsWith("/v1/c3/owner/")
        )
          throw Error("C3_OWNER_HTTP_REJECTED");
        if (!["POST", "GET"].includes(req.method ?? ""))
          throw Error("C3_OWNER_HTTP_METHOD");
        const parts: Buffer[] = [];
        let size = 0;
        for await (const part of req) {
          size += part.length;
          if (size > 8192) throw Error("C3_OWNER_BODY_LIMIT");
          parts.push(Buffer.from(part));
        }
        if (req.method === "GET" && size) throw Error("C3_OWNER_HTTP_METHOD");
        if (
          req.method === "POST" &&
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
            String(req.headers["content-type"]),
          )
        )
          throw Error("C3_OWNER_HTTP_CONTENT_TYPE");
        const body = size ? JSON.parse(Buffer.concat(parts).toString()) : {};
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw Error("C3_OWNER_HTTP_SHAPE");
        const mutation =
          /\/(?:challenge|session|prepare|bind|recovery-bind|submit|close-expired|reconcile)$/.test(
            req.url,
          );
        if (mutation !== (req.method === "POST"))
          throw Error("C3_OWNER_HTTP_METHOD");
        const result = await handleProductionOwnerProtocol(
          pool,
          origin,
          req.url,
          body,
          req.headers.authorization,
        );
        res.end(JSON.stringify(result));
      } catch (e) {
        const code =
          e instanceof Error && /^C3_[A-Z0-9_]+$/.test(e.message)
            ? e.message
            : "C3_OWNER_SERVICE_UNAVAILABLE";
        res.statusCode =
          code.includes("AUTH") || code.includes("SESSION") ? 401 : 409;
        res.end(JSON.stringify({ code })); // never expose raw errors, tokens, SQL or URLs
      }
    },
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 24;
  return server;
}
