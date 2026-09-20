export type RpcProviderEvidence = Readonly<{
  providerId: string;
  operatorId: string;
  endpoint: string;
  signature: string;
  status: "finalized" | "failed" | "missing";
  slot: number;
  configurationHash: string;
  effectsFingerprint: string;
}>;

export function reconcileWithIndependentProviders(
  primary: RpcProviderEvidence,
  secondary: RpcProviderEvidence,
): Readonly<{
  settled: boolean;
  reason: string;
}> {
  for (const evidence of [primary, secondary]) {
    if (!evidence.endpoint.startsWith("https://"))
      return Object.freeze({
        settled: false,
        reason: "RPC endpoint is not HTTPS",
      });
    if (!evidence.providerId || !evidence.operatorId)
      return Object.freeze({
        settled: false,
        reason: "RPC provider metadata is missing",
      });
    if (evidence.status !== "finalized")
      return Object.freeze({
        settled: false,
        reason: "both providers must independently report finalized",
      });
  }
  if (
    primary.providerId === secondary.providerId ||
    primary.operatorId === secondary.operatorId ||
    new URL(primary.endpoint).host === new URL(secondary.endpoint).host
  )
    return Object.freeze({
      settled: false,
      reason: "RPC providers are not independently operated",
    });
  if (
    primary.signature !== secondary.signature ||
    primary.configurationHash !== secondary.configurationHash ||
    primary.effectsFingerprint !== secondary.effectsFingerprint
  )
    return Object.freeze({
      settled: false,
      reason: "independent evidence disagrees",
    });
  return Object.freeze({
    settled: true,
    reason: "two independent reviewed RPC providers agree on finalized effects",
  });
}

export type IntentState =
  | "quoted"
  | "authorized"
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
    quoted: ["authorized", "cancelled", "expired"],
    authorized: ["intent_submitted", "cancelled", "expired", "manual_review"],
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
    failed_recoverable: ["manual_review"],
    manual_review: [],
    cancelled: [],
    expired: [],
  });

export function assertIntentTransition(
  from: IntentState,
  to: IntentState,
): void {
  if (!TRANSITIONS[from].includes(to))
    throw new Error(`Unsafe C3 intent transition: ${from} -> ${to}.`);
}

export function recoveryPolicy(): Readonly<{
  automaticRetry: false;
  automaticReversal: false;
  preserveSubmittedSignature: true;
}> {
  return Object.freeze({
    automaticRetry: false,
    automaticReversal: false,
    preserveSubmittedSignature: true,
  });
}

export function evaluateTimedRecovery(
  input: Readonly<{
    state: IntentState;
    nowUnix: number;
    intentExpiresAtUnix: number;
    withdrawalStartedAtUnix?: number;
    withdrawalTimeoutSeconds: number;
    submittedSignaturePresent: boolean;
  }>,
): "active" | "expired" | "manual_review" {
  if (
    !Number.isSafeInteger(input.nowUnix) ||
    !Number.isSafeInteger(input.intentExpiresAtUnix) ||
    !Number.isSafeInteger(input.withdrawalTimeoutSeconds) ||
    input.withdrawalTimeoutSeconds <= 0
  )
    throw new Error("Recovery timing input is invalid.");
  if (
    ["quoted", "authorized"].includes(input.state) &&
    input.nowUnix >= input.intentExpiresAtUnix
  )
    return "expired";
  if (
    input.withdrawalStartedAtUnix !== undefined &&
    (!Number.isSafeInteger(input.withdrawalStartedAtUnix) ||
      input.withdrawalStartedAtUnix > input.nowUnix)
  )
    throw new Error("Withdrawal timing evidence is invalid.");
  if (
    input.withdrawalStartedAtUnix !== undefined &&
    input.nowUnix >=
      input.withdrawalStartedAtUnix + input.withdrawalTimeoutSeconds
  )
    return "manual_review";
  if (
    input.submittedSignaturePresent &&
    ["intent_submitted", "keeper_pending", "partially_completed"].includes(
      input.state,
    )
  )
    return "manual_review";
  return "active";
}
