/** Presentation of the existing authenticated Devnet response. No RPC, mutation,
 * inferred chronology, fabricated legs, or signature-as-success shortcuts. */
export type ActivityKind = "buy" | "sell" | "other";
export type Receipt = {
  signature: string;
  action: string;
  verified: boolean;
  kind: ActivityKind;
  date: string | null;
  input: string | null;
  output: string | null;
};
export type ActivityGroup = {
  kind: ActivityKind;
  receipts: Receipt[];
  state: "completed" | "processing" | "reconciling" | "confirmed";
  date: string | null;
  amount: string | null;
  shares: string | null;
};
export const isActivitySignature = (s: unknown): s is string =>
  typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(s);
export const activityUnits = (s: unknown): string | null =>
  typeof s === "string" && /^(0|[1-9][0-9]{0,19})$/.test(s) ? s : null;
export const activityExplorer = (s: unknown): string | null =>
  isActivitySignature(s)
    ? `https://explorer.solana.com/tx/${s}?cluster=devnet`
    : null;
export function activityScope(
  wallet: string | null,
  p: Record<string, unknown> | null,
): boolean {
  return (
    !!wallet &&
    !!p &&
    p.wallet === wallet &&
    p.cluster === "solana:devnet" &&
    p.simulatedAssets === true &&
    p.monetaryValue === false &&
    Number.isSafeInteger(p.finalizedSlot) &&
    Number(p.finalizedSlot) > 0
  );
}
function date(s: unknown): string | null {
  return typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      s,
    ) &&
    Number.isFinite(Date.parse(s))
    ? s
    : null;
}
function kind(r: Record<string, unknown>): ActivityKind {
  if (
    ["deposit", "issue_shares", "recover_deposit_plan"].includes(
      String(r.action),
    )
  )
    return "buy";
  if (["request_redemption", "claim"].includes(String(r.action))) return "sell";
  // Use an explicit direction only if it is supplied by the service. The current
  // API omits this for keeper receipts; never assign them by array order.
  return r.direction === 1 ? "buy" : r.direction === 2 ? "sell" : "other";
}
export function activityGroups(
  wallet: string | null,
  verified: boolean,
  p: Record<string, unknown> | null,
): ActivityGroup[] {
  if (!verified || !activityScope(wallet, p) || !Array.isArray(p!.activity))
    return [];
  const records = new Map<string, Receipt>();
  for (const item of p!.activity) {
    if (
      !item ||
      typeof item !== "object" ||
      !isActivitySignature(item.signature)
    )
      continue;
    const action =
      typeof item.action === "string" && /^[a-z_]{1,40}$/.test(item.action)
        ? item.action
        : "unknown";
    const r: Receipt = {
      signature: item.signature,
      action,
      verified: item.effects_verified === true,
      kind: kind(item),
      date: date(item.observed_at ?? item.created_at ?? item.submitted_at),
      input:
        item.effects_verified === true
          ? activityUnits(item.input_amount)
          : null,
      output:
        item.effects_verified === true
          ? activityUnits(item.output_amount)
          : null,
    };
    const previous = records.get(r.signature);
    if (previous) {
      // Conflicting duplicate evidence is never promoted to success.
      const same =
        previous.action === r.action &&
        previous.kind === r.kind &&
        previous.input === r.input &&
        previous.output === r.output;
      previous.verified = previous.verified && r.verified && same;
      if (!same) {
        previous.kind = "other";
        previous.action = "unknown";
      }
      if (!previous.verified) {
        previous.input = null;
        previous.output = null;
      }
    } else records.set(r.signature, r);
  }
  const groups: ActivityGroup[] = [];
  for (const k of ["buy", "sell", "other"] as const) {
    const receipts = [...records.values()].filter((r) => r.kind === k);
    if (!receipts.length) continue;
    const proven = (action: string) =>
      receipts.some((r) => r.action === action && r.verified);
    const buyComplete =
      k === "buy" &&
      proven("deposit") &&
      proven("issue_shares") &&
      [2, 3, 4].includes(Number(p!.lifecycle));
    const returned = activityUnits(p!.returned);
    const sellComplete =
      k === "sell" &&
      proven("request_redemption") &&
      proven("claim") &&
      p!.lifecycle === 4 &&
      returned !== null &&
      BigInt(returned) > 0n;
    const unresolved = receipts.some((r) => !r.verified);
    // Other receipts can be individually confirmed; they cannot certify a whole
    // buy/sell cycle without its economic terminal evidence.
    const state = unresolved
      ? "reconciling"
      : buyComplete || sellComplete
        ? "completed"
        : k === "other"
          ? "confirmed"
          : "processing";
    const dated = receipts
      .filter((r) => r.date !== null)
      .sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!));
    const deposit = receipts.find((r) => r.action === "deposit" && r.verified);
    groups.push({
      kind: k,
      receipts,
      state,
      date: dated[0]?.date ?? null,
      amount:
        sellComplete && !unresolved
          ? returned
          : k === "buy"
            ? (deposit?.input ?? activityUnits(p!.deposited))
            : null,
      shares:
        buyComplete && !unresolved
          ? (activityUnits(p!.sharesIssued) ??
            (p!.lifecycle === 2 ? activityUnits(p!.shares) : null))
          : null,
    });
  }
  return groups;
}
