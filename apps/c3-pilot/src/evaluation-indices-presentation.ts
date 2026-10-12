/** Read-only presentation helpers. Never a source of monetary authorization. */
import type { Language } from "./locales.ts";
import { activityScope, activityUnits } from "./evaluation-activity-state.ts";
import { EVALUATION_ROUND_LIMIT } from "./evaluation-purchase.ts";
import type { IndicesView } from "./evaluation-indices-state.ts";

export function localizedUnits(value: unknown, language: Language): string {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,29})$/.test(value))
    return "—";
  const n = BigInt(value),
    absolute = n < 0n ? -n : n;
  const comma = language === "es" || language === "pt-BR";
  const whole = (absolute / 1_000_000n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, comma ? "." : ",");
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return (
    (n < 0n ? "−" : "") +
    whole +
    (fraction ? (comma ? "," : ".") + fraction : "")
  );
}
export function positionSummary(
  wallet: string | null,
  verified: boolean,
  p: Record<string, unknown> | null,
) {
  if (!verified || !activityScope(wallet, p)) return null;
  const deposited = activityUnits(p!.deposited),
    shares = activityUnits(p!.shares);
  if (deposited === "0" && shares === "0" && p!.lifecycle === 0)
    return { empty: true } as const;
  if (
    !deposited ||
    BigInt(deposited) < 1_000_000n ||
    BigInt(deposited) > 1_000_000_000_000n ||
    ![1, 2, 3, 4].includes(p!.lifecycle as number) ||
    (p!.lifecycle === 4 &&
      (shares !== "0" ||
        !activityUnits(p!.returned) ||
        BigInt(p!.returned as string) <= 0n))
  )
    return null;
  return {
    empty: false,
    deposited,
    shares:
      p!.lifecycle === 1 ||
      shares === null ||
      (p!.lifecycle === 2 && shares === "0")
        ? null
        : shares,
    received: p!.lifecycle === 4 ? activityUnits(p!.returned) : null,
    claimable:
      Array.isArray(p!.allowedActions) && p!.allowedActions.includes("claim")
        ? activityUnits(p!.claimable)
        : null,
  } as const;
}
export function presentationLimits(
  wallet: string | null,
  verified: boolean,
  p: Record<string, unknown> | null,
) {
  if (!verified || !activityScope(wallet, p)) return null;
  const minimum = activityUnits(p!.minimumPurchase),
    maximum = activityUnits(p!.maximumPurchase),
    available = activityUnits(p!.availableUsdc),
    round = activityUnits(p!.round);
  if (
    !minimum ||
    !maximum ||
    !available ||
    !round ||
    BigInt(minimum) < 1_000_000n ||
    BigInt(maximum) < BigInt(minimum) ||
    BigInt(maximum) > 1_000_000_000_000n ||
    BigInt(round) < 1n ||
    BigInt(round) > EVALUATION_ROUND_LIMIT
  )
    return null;
  return {
    minimum,
    maximum,
    available,
    round,
    rounds: EVALUATION_ROUND_LIMIT.toString(),
  };
}
export function presentationAction(
  state: IndicesView,
  busy: boolean,
  validAmount: boolean,
  limits: ReturnType<typeof presentationLimits>,
) {
  if (
    state.title === "completed" &&
    limits &&
    BigInt(limits.round) < EVALUATION_ROUND_LIMIT
  )
    return { action: "new_purchase" as const, disabled: busy };
  return {
    action: state.action,
    disabled:
      (busy && state.action !== "activity") ||
      (state.action === "deposit" && !validAmount) ||
      (["deposit", "issue_shares", "request_redemption", "claim"].includes(
        state.action,
      ) &&
        !limits),
  };
}
