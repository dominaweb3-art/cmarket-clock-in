/** LOCAL QA control only. No wallet, transaction serialization or RPC. */
const LOCAL = "http://127.0.0.1:8787";
export type LocalCycle = Readonly<{
  version: "c3-clone-cycle/v1";
  scope: "LOCAL_CLONED_JUPITER";
  mainnetExecutionEnabled: false;
  userPosition: null;
  runId: string;
  token: string;
  state: "ready" | "running" | "passed" | "blocked";
  stage: string;
  confirmedLegs: number;
  sharesIssued: string;
  sharesBurned: string;
  usdcReturned: string;
}>;
export function parseLocalCycle(raw: unknown): LocalCycle {
  if (!raw || typeof raw !== "object") throw Error("LOCAL_CYCLE_INVALID");
  const r = raw as Record<string, unknown>;
  if (
    r.version !== "c3-clone-cycle/v1" ||
    r.scope !== "LOCAL_CLONED_JUPITER" ||
    r.mainnetExecutionEnabled !== false ||
    r.userPosition !== null ||
    typeof r.runId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(r.runId) ||
    typeof r.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.token) ||
    !["ready", "running", "passed", "blocked"].includes(String(r.state)) ||
    typeof r.stage !== "string" ||
    !/^[a-z0-9-]{1,80}$/.test(r.stage) ||
    !Number.isInteger(r.confirmedLegs) ||
    Number(r.confirmedLegs) < 0 ||
    Number(r.confirmedLegs) > 6 ||
    ![r.sharesIssued, r.sharesBurned, r.usdcReturned].every(
      (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v),
    )
  )
    throw Error("LOCAL_CYCLE_INVALID");
  if (
    r.state === "passed" &&
    (r.confirmedLegs !== 6 ||
      r.sharesIssued !== "1000000" ||
      r.sharesBurned !== "1000000" ||
      r.usdcReturned === "0")
  )
    throw Error("LOCAL_CYCLE_FALSE_SUCCESS");
  return Object.freeze({ ...r }) as LocalCycle;
}
export async function readLocalCycle(
  endpoint: string,
  signal: AbortSignal,
): Promise<LocalCycle> {
  if (endpoint !== LOCAL) throw Error("LOCAL_CYCLE_LOOPBACK_REQUIRED");
  const response = await fetch(LOCAL + "/v1/c3/local-cycle", {
    method: "GET",
    signal,
    redirect: "error",
  });
  if (!response.ok) throw Error("LOCAL_CYCLE_UNAVAILABLE");
  const body = await response.text();
  if (body.length > 4096) throw Error("LOCAL_CYCLE_BODY_LIMIT");
  return parseLocalCycle(JSON.parse(body));
}
export async function startLocalCycle(
  endpoint: string,
  run: LocalCycle,
  signal: AbortSignal,
): Promise<void> {
  if (endpoint !== LOCAL || parseLocalCycle(run).state !== "ready")
    throw Error("LOCAL_CYCLE_NOT_READY");
  const response = await fetch(LOCAL + "/v1/c3/local-cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId: run.runId, token: run.token }),
    signal,
    redirect: "error",
  });
  if (response.status !== 202) throw Error("LOCAL_CYCLE_REJECTED");
}
