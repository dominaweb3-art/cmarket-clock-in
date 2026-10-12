import { activityScope } from "./evaluation-activity-state.ts";

type Position = Record<string, unknown>;
/** Only continue the already authorized trial. Never signs, submits an owner
 * packet, renews a plan or starts a second purchase. The hosted service owns
 * its durable service-signature reconciliation and idempotency. */
export function canContinueSettlement(wallet: string, position: Position) {
  return (
    activityScope(wallet, position) &&
    position.settlementReleased === true &&
    position.paused === false &&
    Array.isArray(position.pendingRequests) &&
    position.pendingRequests.length === 0 &&
    !position.pendingInitialPlan &&
    (position.settlementPlan as Record<string, unknown> | null)?.state !==
      "expired" &&
    [1, 3].includes(position.lifecycle as number) &&
    Array.isArray(position.allowedActions) &&
    !position.allowedActions.includes("claim") &&
    !position.allowedActions.includes("issue_shares")
  );
}
export async function continueSettlement(ports: {
  wallet: string;
  initial: Position;
  advance: () => Promise<Position>;
  position: () => Promise<Position>;
  sleep: (milliseconds: number) => Promise<void>;
}) {
  if (!canContinueSettlement(ports.wallet, ports.initial)) return "owner";
  for (let step = 0; step < 48; step++) {
    const result = await ports.advance();
    const current = await ports.position();
    if (!activityScope(ports.wallet, current))
      throw Error("EVAL_POSITION_SCOPE");
    // A stored signature or stopped worker is not a confirmed economic effect.
    if (result.stage === "uncertain") return "uncertain";
    if (result.stage === "failed")
      throw Error("EVAL_FINALIZED_OPERATION_FAILED");
    if (
      result.needsOwnerAction ||
      !canContinueSettlement(ports.wallet, current)
    )
      return "owner";
    await ports.sleep(3000);
  }
  return "uncertain";
}
