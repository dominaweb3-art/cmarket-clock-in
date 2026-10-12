/** Read-only recovery metadata. Never changes a plan, minimum, signature or inventory. */
import { EvaluationClient } from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import { accountBytes, type OpenAccount } from "./open-state-semantics.ts";
export function evaluationPlanRecovery(
  client: EvaluationClient,
  direction: 1 | 2,
  revision: string,
  chainTime: number,
  raw: OpenAccount | null,
) {
  const intent = client.intent(direction === 1 ? "deposit" : "redemption");
  const address = client.pda("c3-plan-v1", intent);
  if (!raw) return { state: "missing" as const, direction };
  const p = client.coder.accounts.decode(
    "SettlementPlan",
    accountBytes(raw, EVALUATION.program, 901, "SettlementPlan"),
  ) as Record<string, unknown>;
  if (
    !Number.isSafeInteger(chainTime) ||
    chainTime <= 0 ||
    !/^(0|[1-9][0-9]{0,19})$/.test(revision) ||
    p.schema_version !== 2 ||
    String(p.vault) !== String(client.vault) ||
    String(p.wallet) !== String(client.owner) ||
    String(p.intent) !== String(intent) ||
    String(p.share_mint) !== client.config.shareMint ||
    String(p.config_version) !== String(client.config.version) ||
    String(p.amount) !== String(client.amount) ||
    p.direction !== direction ||
    String(p.router_program) !== EVALUATION.router ||
    String(p.revision) !== revision ||
    ![0, 1, 3, 7].includes(p.executed_bitmap as number) ||
    String(p.max_slippage_bps) !== "100" ||
    !/^[1-9][0-9]{0,18}$/.test(String(p.expires_at))
  )
    throw Error("EVAL_RECOVERY_PLAN_EVIDENCE");
  return {
    state:
      p.executed_bitmap === 7
        ? ("settled" as const)
        : BigInt(chainTime) >= BigInt(String(p.expires_at))
          ? ("expired" as const)
          : ("ready" as const),
    direction,
    address: String(address),
    revision,
    executedBitmap: p.executed_bitmap,
    expiresAt: String(p.expires_at),
    observedChainTime: String(chainTime),
  };
}
