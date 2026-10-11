import type { EvaluationMoneyAction } from "./evaluation-owner-review";
import type { IndicesKey } from "./evaluation-indices-copy";

export type IndicesAction =
  | "wallet"
  | "provision"
  | "refresh"
  | "activity"
  | "advance"
  | EvaluationMoneyAction;
export type IndicesView = {
  title: IndicesKey;
  label: IndicesKey;
  action: IndicesAction;
  recover: boolean;
  renew: boolean;
  initialPlan: boolean;
};
/** Presentation only. Existing reviewed controllers remain the authorizers. */
export function indicesView(
  wallet: string | null,
  verified: boolean,
  busy: boolean,
  p: Record<string, unknown> | null,
): IndicesView {
  const view = (
    title: IndicesKey,
    label: IndicesKey,
    action: IndicesAction,
  ): IndicesView => ({
    title,
    label,
    action,
    recover: false,
    renew: false,
    initialPlan: false,
  });
  if (!wallet) return view("walletHint", "connect", "wallet");
  if (!verified) return view("unverified", "verify", "wallet");
  if (!p)
    return busy
      ? view("processing", "view", "activity")
      : view("missing", "provision", "provision");
  if (
    p.wallet !== wallet ||
    p.cluster !== "solana:devnet" ||
    p.simulatedAssets !== true ||
    p.monetaryValue !== false
  )
    return view("blocked", "refresh", "refresh");
  const pending =
    Array.isArray(p.pendingRequests) && p.pendingRequests.length > 0;
  if (busy || pending || p.pendingInitialPlan)
    return {
      ...view("processing", "view", "activity"),
      recover: pending || !!p.pendingInitialPlan,
      initialPlan: !!p.pendingInitialPlan,
    };
  if (p.settlementReleased !== true)
    return view("blocked", "refresh", "refresh");
  const allows = (a: EvaluationMoneyAction) =>
    Array.isArray(p.allowedActions) && p.allowedActions.includes(a);
  if (allows("claim")) return view("claiming", "claim", "claim");
  if (p.paused === true) return view("paused", "refresh", "refresh");
  if (
    p.lifecycle === 4 &&
    typeof p.returned === "string" &&
    /^(0|[1-9][0-9]{0,19})$/.test(p.returned) &&
    BigInt(p.returned) > 0n
  )
    return view("completed", "receipts", "activity");
  if (allows("deposit")) return view("ready", "buy", "deposit");
  if (allows("issue_shares")) return view("buying", "issue", "issue_shares");
  if (allows("request_redemption"))
    return view("active", "sell", "request_redemption");
  if (p.lifecycle === 1 || p.lifecycle === 3)
    return {
      ...view(p.lifecycle === 1 ? "buying" : "selling", "continue", "advance"),
      renew: allows("renew_plan"),
      initialPlan: allows("recover_deposit_plan"),
    };
  return view("unknown", "refresh", "refresh");
}
