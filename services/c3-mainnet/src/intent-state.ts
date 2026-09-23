/** Stateless lifecycle rules shared by the durable production repository. */
export type IntentState =
  | "draft"
  | "awaiting_wallet"
  | "intent_submitted"
  | "keeper_pending"
  | "partially_completed"
  | "settled"
  | "failed_recoverable"
  | "manual_review"
  | "cancelled"
  | "expired";

const TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> =
  Object.freeze({
    draft: ["awaiting_wallet", "cancelled", "expired"],
    awaiting_wallet: [
      "intent_submitted",
      "cancelled",
      "expired",
      "manual_review",
    ],
    intent_submitted: [
      "keeper_pending",
      "partially_completed",
      "failed_recoverable",
      "manual_review",
    ],
    keeper_pending: [
      "partially_completed",
      "settled",
      "failed_recoverable",
      "manual_review",
      "expired",
    ],
    partially_completed: ["keeper_pending", "settled", "manual_review"],
    settled: [],
    failed_recoverable: ["keeper_pending", "manual_review"],
    manual_review: [],
    cancelled: [],
    expired: [],
  });

export const C3_INTENT_STATES = Object.freeze(
  Object.keys(TRANSITIONS) as IntentState[],
);

export function assertIntentTransition(
  from: IntentState,
  to: IntentState,
): void {
  if (!TRANSITIONS[from]?.includes(to))
    throw new Error(`Unsafe C3 intent transition: ${from} -> ${to}.`);
}
