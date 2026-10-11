import type { IndicesKey } from "./evaluation-indices-copy";

/** Only a navigation hint, never an economic state transition or new request. */
export function homeOperation(
  wallet: string | null,
  verified: boolean,
  busy: boolean,
  p: Record<string, unknown> | null,
): IndicesKey | "busy" | null {
  if (!wallet || !verified) return null;
  if (!p) return busy ? "busy" : null;
  if (
    p.wallet !== wallet ||
    p.cluster !== "solana:devnet" ||
    p.simulatedAssets !== true ||
    p.monetaryValue !== false
  )
    return null;
  if (Array.isArray(p.pendingRequests) && p.pendingRequests.length > 0)
    return "recoveryNote";
  if (p.pendingInitialPlan) return "recoveryNote";
  if (p.paused === true && (p.lifecycle === 1 || p.lifecycle === 3))
    return "paused";
  if (p.lifecycle === 1) return "buying";
  if (p.lifecycle === 3)
    return Array.isArray(p.allowedActions) && p.allowedActions.includes("claim")
      ? "claiming"
      : "selling";
  return busy ? "busy" : null;
}
