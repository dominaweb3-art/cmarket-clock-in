/** Read-only backend boundary. No transaction endpoints or arbitrary RPC URLs. */
export type PilotStatus = Readonly<{
  version: "c3-read-only/v1";
  mainnetExecutionEnabled: false;
  wallet: string;
  evidenceScope: "LOCAL_SIMULATION";
  position: null;
  intents: readonly Readonly<{
    id: string;
    state: string;
    confirmedLegs: number;
  }>[];
}>;
export function parseStatus(raw: unknown, wallet: string): PilotStatus {
  if (!raw || typeof raw !== "object")
    throw new Error("INVALID_BACKEND_STATUS");
  const r = raw as Record<string, unknown>;
  if (
    r.version !== "c3-read-only/v1" ||
    r.mainnetExecutionEnabled !== false ||
    r.wallet !== wallet ||
    r.evidenceScope !== "LOCAL_SIMULATION" ||
    r.position !== null ||
    !Array.isArray(r.intents) ||
    r.intents.length > 30
  )
    throw new Error("UNREVIEWED_BACKEND_STATUS");
  const states = [
    "draft",
    "funded",
    "buying",
    "active",
    "redemption_requested",
    "selling",
    "claimable",
    "redeemed",
    "expired",
    "cancelled",
    "failed_recoverable",
    "partially_completed",
    "reconciliation_required",
    "manual_review",
    "paused",
  ];
  const intents = r.intents.map((value: unknown) => {
    if (!value || typeof value !== "object")
      throw new Error("INVALID_BACKEND_INTENT");
    const i = value as Record<string, unknown>;
    if (
      typeof i.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(i.id) ||
      typeof i.state !== "string" ||
      !states.includes(i.state) ||
      !Number.isInteger(i.confirmedLegs) ||
      Number(i.confirmedLegs) < 0 ||
      Number(i.confirmedLegs) > 6
    )
      throw new Error("INVALID_BACKEND_INTENT");
    return Object.freeze({
      id: i.id,
      state: i.state,
      confirmedLegs: Number(i.confirmedLegs),
    });
  });
  return Object.freeze({
    version: "c3-read-only/v1",
    mainnetExecutionEnabled: false,
    wallet,
    evidenceScope: "LOCAL_SIMULATION",
    position: null,
    intents: Object.freeze(intents),
  });
}
export function readOnlyEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1" &&
        url.port === "8787"
      )
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export async function loadStatus(
  endpoint: string,
  wallet: string,
  signal: AbortSignal,
): Promise<PilotStatus> {
  if (
    readOnlyEndpoint(endpoint) !== endpoint ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)
  )
    throw new Error("INVALID_BACKEND_REQUEST");
  const response = await fetch(
    `${endpoint}/v1/c3/status?wallet=${encodeURIComponent(wallet)}`,
    { method: "GET", signal, redirect: "error" },
  );
  if (!response.ok) throw new Error("BACKEND_UNAVAILABLE");
  const text = await response.text();
  if (text.length > 32000) throw new Error("BACKEND_RESPONSE_TOO_LARGE");
  return parseStatus(JSON.parse(text), wallet);
}
export const READ_ONLY_BACKEND = readOnlyEndpoint(
  process.env.EXPO_PUBLIC_C3_READ_ONLY_BACKEND_URL,
);
