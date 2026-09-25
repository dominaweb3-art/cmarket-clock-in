/** Disabled C3/Symmetry vertical-slice contract. Research only: never imported from src/public.ts. */
export const INTEGRATION_BLOCKER = "C3_SYMMETRY_PRODUCTION_POLICY_NOT_APPROVED";
export const C3_TARGET_BPS = Object.freeze({ btc: 4000, eth: 3000, sol: 3000 });
export function checkedResearchAmount(value: bigint, bits: 64 | 128): bigint {
  if (
    typeof value !== "bigint" ||
    value < 0n ||
    value > (1n << BigInt(bits)) - 1n
  )
    throw new Error(INTEGRATION_BLOCKER);
  return value;
}
export type EvidenceClass =
  "VERIFIED" | "CONSISTENT_BUT_UNVERIFIED" | "UNKNOWN" | "CONTRADICTED";
export type C3Stage =
  | "draft"
  | "awaiting_wallet"
  | "intent_submitted"
  | "vault_processing"
  | "shares_issued"
  | "active"
  | "redemption_requested"
  | "shares_locked_or_burned"
  | "rebalance_pending"
  | "usdc_claimable"
  | "usdc_received"
  | "cancelled"
  | "expired"
  | "failed_recoverable"
  | "manual_review"
  | "partially_completed";

export type ChainEvidence = Readonly<{
  classification: EvidenceClass;
  signatures: readonly string[];
  explorerUrls: readonly string[];
  finalizedAt: number | null;
}>;
export type VaultSummary = Readonly<{
  targetBps: typeof C3_TARGET_BPS;
  currentBps: Readonly<{ btc: number; eth: number; sol: number }> | null;
  navUsdcBaseUnits: bigint | null;
  sharePriceUsdcBaseUnits: bigint | null;
  shareSupplyBaseUnits: bigint | null;
  observedAt: number | null;
  evidence: ChainEvidence;
}>;
export type Position = Readonly<{
  wallet: string;
  shareBalanceBaseUnits: bigint | null;
  vault: VaultSummary;
}>;
export type Quote = Readonly<{
  inputBaseUnits: bigint;
  estimatedOutputBaseUnits: bigint | null;
  minOutputBaseUnits: bigint | null;
  feeBaseUnits: bigint | null;
  bountyBaseUnits: bigint | null;
  slippageBps: number | null;
  expiresAt: number | null;
  evidence: ChainEvidence;
}>;
export type IntentView = Readonly<{
  intentId: string;
  wallet: string;
  stage: C3Stage;
  idempotencyKey: string;
  createdAt: number;
  expiresAt: number;
  lastUpdatedAt: number;
  signatures: readonly string[];
  evidence: ChainEvidence;
}>;
export interface C3SymmetryIntegration {
  getVaultSummary(): Promise<VaultSummary>;
  getUserC3Position(wallet: string): Promise<Position>;
  quoteDepositUsdc(amountBaseUnits: bigint): Promise<Quote>;
  buildDepositIntent(wallet: string, amountBaseUnits: bigint): Promise<never>;
  getIntentStatus(intentId: string): Promise<IntentView>;
  quoteRedeemToUsdc(sharesBaseUnits: bigint): Promise<Quote>;
  buildRedeemToUsdcIntent(
    wallet: string,
    sharesBaseUnits: bigint,
  ): Promise<never>;
  getClaimStatus(intentId: string): Promise<IntentView>;
  reconcileIntent(intentId: string): Promise<IntentView>;
}

function blocked(): never {
  throw new Error(INTEGRATION_BLOCKER);
}
export class DisabledC3SymmetryIntegration implements C3SymmetryIntegration {
  getVaultSummary(): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  getUserC3Position(_wallet: string): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  quoteDepositUsdc(_amountBaseUnits: bigint): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  buildDepositIntent(
    _wallet: string,
    _amountBaseUnits: bigint,
  ): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  getIntentStatus(_intentId: string): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  quoteRedeemToUsdc(_sharesBaseUnits: bigint): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  buildRedeemToUsdcIntent(
    _wallet: string,
    _sharesBaseUnits: bigint,
  ): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  getClaimStatus(_intentId: string): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
  reconcileIntent(_intentId: string): Promise<never> {
    return Promise.reject(new Error(INTEGRATION_BLOCKER));
  }
}

export type ResearchTransition = Readonly<{
  from: C3Stage;
  to: C3Stage;
  actor: "user" | "wallet" | "keeper" | "reconciler";
  idempotencyKey: string;
  intentExpiresAt: number;
  observedAt: number;
  walletApproved: boolean;
  finalizedSignature: string | null;
  evidence: EvidenceClass;
  explicitResume: boolean;
}>;
const NEXT: Readonly<Record<C3Stage, readonly C3Stage[]>> = {
  draft: ["awaiting_wallet", "cancelled"],
  awaiting_wallet: [
    "intent_submitted",
    "cancelled",
    "expired",
    "manual_review",
  ],
  intent_submitted: ["vault_processing", "failed_recoverable", "manual_review"],
  vault_processing: [
    "shares_issued",
    "partially_completed",
    "failed_recoverable",
    "manual_review",
  ],
  shares_issued: ["active", "manual_review"],
  active: ["redemption_requested"],
  redemption_requested: [
    "shares_locked_or_burned",
    "cancelled",
    "expired",
    "manual_review",
  ],
  shares_locked_or_burned: [
    "rebalance_pending",
    "partially_completed",
    "manual_review",
  ],
  rebalance_pending: ["usdc_claimable", "partially_completed", "manual_review"],
  usdc_claimable: ["usdc_received", "manual_review"],
  usdc_received: [],
  cancelled: [],
  expired: [],
  failed_recoverable: ["manual_review"],
  manual_review: [],
  partially_completed: ["manual_review"],
};
/** A design invariant, not an on-chain reconciler. No transition invokes a wallet. */
export function assessResearchTransition(
  input: ResearchTransition,
  priorKeys: ReadonlySet<string>,
): C3Stage {
  const allowed = NEXT[input.from];
  if (!allowed || !allowed.includes(input.to)) blocked();
  if (!input.idempotencyKey || priorKeys.has(input.idempotencyKey)) blocked();
  if (
    !Number.isSafeInteger(input.observedAt) ||
    !Number.isSafeInteger(input.intentExpiresAt)
  )
    blocked();
  if (
    input.observedAt > input.intentExpiresAt &&
    input.to !== "expired" &&
    input.to !== "manual_review"
  )
    blocked();
  if (input.from === "failed_recoverable" && !input.explicitResume) blocked();
  if (
    input.to === "intent_submitted" &&
    (!input.walletApproved || input.actor !== "wallet")
  )
    blocked();
  if (
    [
      "vault_processing",
      "shares_issued",
      "active",
      "shares_locked_or_burned",
      "rebalance_pending",
      "usdc_claimable",
      "usdc_received",
    ].includes(input.to)
  ) {
    if (!input.finalizedSignature || input.evidence !== "VERIFIED") blocked();
  }
  if (input.to === "usdc_received" && input.actor !== "reconciler") blocked();
  return input.to;
}
