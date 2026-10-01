/** Loopback-only local journal viewer. Public read-only metadata; no keys,
 * authorization/transaction routes, mutation or production settlement claims.
 * The journal contains LOCAL simulations, never a real customer position.
 */
import { createServer } from "node:http";
import type { Pool } from "pg";
export function createReadServer(pool: Pool) {
  return createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const wallet = url.searchParams.get("wallet");
      if (
        req.method !== "GET" ||
        url.pathname !== "/v1/c3/status" ||
        !wallet ||
        !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) ||
        [...url.searchParams.keys()].some((k) => k !== "wallet")
      ) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "READ_ONLY_REQUEST_REQUIRED" }));
        return;
      }
      const result = await pool.query<{
        intent_id: string;
        state: string;
        confirmed_legs: number;
      }>(
        `SELECT i.intent_id,i.state,
        (SELECT count(*)::int FROM c3_open.legs l WHERE l.intent_id=i.intent_id AND l.state='confirmed') AS confirmed_legs
        FROM c3_open.intents i WHERE i.wallet=$1 ORDER BY i.created_at DESC LIMIT 30`,
        [wallet],
      );
      res.end(
        JSON.stringify({
          version: "c3-read-only/v1",
          mainnetExecutionEnabled: false,
          wallet,
          evidenceScope: "LOCAL_SIMULATION",
          position: null,
          intents: result.rows.map((r) => ({
            id: r.intent_id,
            state: r.state,
            confirmedLegs: r.confirmed_legs,
          })),
        }),
      );
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "STATUS_UNAVAILABLE" }));
    }
  });
}
