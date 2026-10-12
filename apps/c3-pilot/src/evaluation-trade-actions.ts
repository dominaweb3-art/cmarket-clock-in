import { activityScope } from "./evaluation-activity-state.ts";
import { indicesView, type IndicesAction } from "./evaluation-indices-state.ts";
import { EVALUATION_ROUND_LIMIT } from "./evaluation-purchase.ts";
type Position = Record<string, unknown>;
export type TradeMode = "buy" | "sell";
/** Button visibility is not authorization. All wallet actions still pass server inspection. */
export function tradeAction(
  mode: TradeMode,
  wallet: string | null,
  verified: boolean,
  p: Position | null,
): IndicesAction | "recover" | null {
  if (!wallet || !verified) return "wallet";
  if (!p) return mode === "buy" ? "provision" : "refresh";
  if (!activityScope(wallet, p) || p.settlementReleased !== true)
    return "refresh";
  const view = indicesView(wallet, verified, false, p);
  if (view.recover) return "recover";
  if (p.paused && view.action !== "claim") return null;
  if (mode === "buy" && p.lifecycle === 4 && view.title === "completed") {
    return typeof p.round === "string" &&
      /^[1-9][0-9]*$/.test(p.round) &&
      BigInt(p.round) < EVALUATION_ROUND_LIMIT
      ? "new_purchase"
      : null;
  }
  if (
    (mode === "buy" && [2, 3].includes(p.lifecycle as number)) ||
    (mode === "sell" && p.lifecycle !== 2 && p.lifecycle !== 3)
  )
    return null;
  if (
    (mode === "buy" && p.lifecycle === 1) ||
    (mode === "sell" && p.lifecycle === 3)
  ) {
    const plan = p.settlementPlan as Position | null;
    if (view.action === "advance" && plan?.state === "expired" && view.renew)
      return "renew_plan";
    if (view.action === "advance" && !plan) return "refresh"; // Old/absent backend metadata cannot authorize expiry recovery.
  }
  return view.action;
}
type Request = (body: Readonly<Record<string, unknown>>) => Promise<Position>;
/** Explicit recovery: query the original signature and prove blockhash expiry
 * server-side before retiring an unexecuted request. Never invokes a wallet/send. */
export async function recoverOwnerRequest(pending: Position, request: Request) {
  if (typeof pending.request_id !== "string")
    throw Error("EVAL_RECOVERY_REQUEST_SHAPE");
  let result: Position = { status: "uncertain" };
  if (pending.signature) {
    result = await request({
      operation: "reconcile",
      requestId: pending.request_id,
    });
    if (
      ["effects_verified", "already_reconciled"].includes(String(result.status))
    )
      return result;
    if (!["uncertain", "failed_finalized"].includes(String(result.status)))
      return result;
  }
  try {
    return await request({
      operation: "close_expired",
      requestId: pending.request_id,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (
      [
        "EVAL_OWNER_EXPIRY_BARRIER_NOT_FINALIZED",
        "EVAL_OWNER_UNCERTAIN_RECONCILE_FIRST",
      ].includes(code)
    )
      return result;
    throw error;
  }
}
