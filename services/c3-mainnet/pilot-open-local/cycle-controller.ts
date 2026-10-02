/** Test-only loopback control. One ephemeral LOCAL cloned cycle; no user keys,
 * public wallet actions, production endpoint, arbitrary command or retry. */
import { createServer } from "node:http";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
export type CycleView = Readonly<{
  stage: string;
  confirmedLegs: number;
  sharesIssued: string;
  sharesBurned: string;
  usdcReturned: string;
}>;
export function createCycleController(view: () => CycleView) {
  const runId = randomUUID(),
    token = randomBytes(32).toString("hex");
  let state: "ready" | "running" | "passed" | "blocked" = "ready";
  let release: () => void = () => undefined;
  const started = new Promise<void>((r) => {
    release = r;
  });
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (
        req.headers.origin ||
        req.url !== "/v1/c3/local-cycle" ||
        !["127.0.0.1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress ?? "",
        )
      )
        throw Error("LOCAL_ONLY");
      if (req.method === "GET") {
        res.end(
          JSON.stringify({
            version: "c3-clone-cycle/v1",
            scope: "LOCAL_CLONED_JUPITER",
            mainnetExecutionEnabled: false,
            userPosition: null,
            runId,
            token,
            state,
            ...view(),
          }),
        );
        return;
      }
      if (
        req.method !== "POST" ||
        req.headers["content-type"] !== "application/json"
      )
        throw Error("METHOD");
      let raw = "";
      for await (const chunk of req) {
        raw += chunk.toString();
        if (raw.length > 256) throw Error("BODY_LIMIT");
      }
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (
        Object.keys(value).sort().join(",") !== "runId,token" ||
        value.runId !== runId ||
        typeof value.token !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.token) ||
        !timingSafeEqual(
          Buffer.from(value.token, "hex"),
          Buffer.from(token, "hex"),
        )
      )
        throw Error("INVALID_RUN");
      // Synchronous transition before releasing async work. Repeated presses
      // return the same state, never spawn a second intent or rerun a failure.
      if (state === "ready") {
        state = "running";
        release();
      }
      res.statusCode = 202;
      res.end(JSON.stringify({ runId, state }));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "LOCAL_CYCLE_REQUEST_REJECTED" }));
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return {
    server,
    started,
    finish: (pass: boolean) => {
      state = pass ? "passed" : "blocked";
    },
  };
}
