/** C3 pilot lifecycle definition; no method here authorizes chain execution. */
export type PilotKind = "deposit" | "redemption";
export type PilotState =
  | "draft"
  | "awaiting_wallet"
  | "deposit_tx_1_approved"
  | "deposit_tx_1_submitted"
  | "deposit_tx_1_confirmed"
  | "deposit_tx_2_awaiting_wallet"
  | "deposit_tx_2_approved"
  | "deposit_tx_2_submitted"
  | "intent_submitted"
  | "vault_processing"
  | "shares_issued"
  | "active"
  | "redemption_draft"
  | "redemption_awaiting_wallet"
  | "redemption_approved"
  | "redemption_submitted"
  | "shares_locked_or_burned"
  | "rebalance_pending"
  | "usdc_claimable"
  | "claim_awaiting_wallet"
  | "claim_approved"
  | "claim_submitted"
  | "usdc_received"
  | "completed"
  | "cancelled"
  | "expired"
  | "failed_recoverable"
  | "manual_review"
  | "partially_completed";

const DEPOSIT: Readonly<Record<PilotState, readonly PilotState[]>> =
  Object.freeze({
    draft: ["awaiting_wallet", "cancelled", "expired"],
    awaiting_wallet: [
      "deposit_tx_1_approved",
      "cancelled",
      "expired",
      "manual_review",
    ],
    deposit_tx_1_approved: ["deposit_tx_1_submitted", "manual_review"],
    deposit_tx_1_submitted: [
      "deposit_tx_1_confirmed",
      "manual_review",
      "partially_completed",
    ],
    deposit_tx_1_confirmed: ["deposit_tx_2_awaiting_wallet", "manual_review"],
    deposit_tx_2_awaiting_wallet: [
      "deposit_tx_2_approved",
      "manual_review",
      "partially_completed",
    ],
    deposit_tx_2_approved: ["deposit_tx_2_submitted", "manual_review"],
    deposit_tx_2_submitted: [
      "intent_submitted",
      "manual_review",
      "partially_completed",
    ],
    intent_submitted: [
      "vault_processing",
      "manual_review",
      "partially_completed",
    ],
    vault_processing: ["shares_issued", "manual_review", "partially_completed"],
    shares_issued: ["active", "manual_review"],
    active: [],
    redemption_draft: [],
    redemption_awaiting_wallet: [],
    redemption_approved: [],
    redemption_submitted: [],
    shares_locked_or_burned: [],
    rebalance_pending: [],
    usdc_claimable: [],
    claim_awaiting_wallet: [],
    claim_approved: [],
    claim_submitted: [],
    usdc_received: [],
    completed: [],
    cancelled: [],
    expired: [],
    failed_recoverable: ["manual_review"],
    manual_review: [],
    partially_completed: ["manual_review"],
  });

const REDEMPTION: Readonly<Record<PilotState, readonly PilotState[]>> =
  Object.freeze({
    draft: [],
    awaiting_wallet: [],
    deposit_tx_1_approved: [],
    deposit_tx_1_submitted: [],
    deposit_tx_1_confirmed: [],
    deposit_tx_2_awaiting_wallet: [],
    deposit_tx_2_approved: [],
    deposit_tx_2_submitted: [],
    intent_submitted: [],
    vault_processing: [],
    shares_issued: [],
    active: [],
    redemption_draft: ["redemption_awaiting_wallet", "cancelled", "expired"],
    redemption_awaiting_wallet: [
      "redemption_approved",
      "cancelled",
      "expired",
      "manual_review",
    ],
    redemption_approved: ["redemption_submitted", "manual_review"],
    redemption_submitted: [
      "shares_locked_or_burned",
      "manual_review",
      "partially_completed",
    ],
    shares_locked_or_burned: [
      "rebalance_pending",
      "manual_review",
      "partially_completed",
    ],
    rebalance_pending: [
      "usdc_claimable",
      "manual_review",
      "partially_completed",
    ],
    usdc_claimable: [
      "claim_awaiting_wallet",
      "usdc_received",
      "manual_review",
      "partially_completed",
    ],
    claim_awaiting_wallet: ["claim_approved", "manual_review"],
    claim_approved: ["claim_submitted", "manual_review"],
    claim_submitted: ["usdc_received", "manual_review", "partially_completed"],
    usdc_received: ["completed", "manual_review"],
    completed: [],
    cancelled: [],
    expired: [],
    failed_recoverable: ["manual_review"],
    manual_review: [],
    partially_completed: ["manual_review"],
  });

export type PilotTransition = Readonly<{
  kind: PilotKind;
  from: PilotState;
  to: PilotState;
  idempotencyKey: string;
  authorizationFingerprint?: string;
  signature?: string;
  finalizedEvidenceHash?: string;
  manualReviewReason?: string;
}>;

const HASH = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const APPROVED = new Set<PilotState>([
  "deposit_tx_1_approved",
  "deposit_tx_2_approved",
  "redemption_approved",
  "claim_approved",
]);
const SUBMITTED = new Set<PilotState>([
  "deposit_tx_1_submitted",
  "deposit_tx_2_submitted",
  "redemption_submitted",
  "claim_submitted",
]);
const RECONCILED = new Set<PilotState>([
  "deposit_tx_1_confirmed",
  "intent_submitted",
  "vault_processing",
  "shares_issued",
  "active",
  "shares_locked_or_burned",
  "rebalance_pending",
  "usdc_claimable",
  "usdc_received",
  "completed",
]);

/** A schema-level plan. Only an independently reviewed reconciler may supply evidence in production. */
export function assertPilotTransition(transition: PilotTransition): void {
  const allowed = (transition.kind === "deposit" ? DEPOSIT : REDEMPTION)[
    transition.from
  ];
  if (
    !allowed?.includes(transition.to) ||
    !HASH.test(transition.idempotencyKey)
  )
    throw new Error("C3_PILOT_INVALID_TRANSITION");
  if (
    APPROVED.has(transition.to) &&
    !HASH.test(transition.authorizationFingerprint ?? "")
  )
    throw new Error("C3_PILOT_AUTHORIZATION_REQUIRED");
  if (
    SUBMITTED.has(transition.to) &&
    (!HASH.test(transition.authorizationFingerprint ?? "") ||
      !SIGNATURE.test(transition.signature ?? ""))
  )
    throw new Error("C3_PILOT_SIGNATURE_REQUIRED");
  if (
    RECONCILED.has(transition.to) &&
    !HASH.test(transition.finalizedEvidenceHash ?? "")
  )
    throw new Error("C3_PILOT_INDEPENDENT_EVIDENCE_REQUIRED");
  if (
    transition.to === "manual_review" &&
    (!transition.manualReviewReason ||
      transition.manualReviewReason.length > 128)
  )
    throw new Error("C3_PILOT_MANUAL_REVIEW_REASON_REQUIRED");
  if (
    ["cancelled", "expired"].includes(transition.to) &&
    ![
      "draft",
      "awaiting_wallet",
      "redemption_draft",
      "redemption_awaiting_wallet",
    ].includes(transition.from)
  )
    throw new Error("C3_PILOT_CANNOT_CANCEL_SUBMITTED_INTENT");
}

/** These transitions must never be accepted from a caller-supplied evidence hash alone. */
export function requiresIndependentReconciliation(state: PilotState): boolean {
  return (
    RECONCILED.has(state) ||
    ["partially_completed", "failed_recoverable"].includes(state)
  );
}
