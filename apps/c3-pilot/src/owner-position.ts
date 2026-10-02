/** Strict wire model: targets/journal counts never substitute share balance or
 * NAV. Clone evidence is permitted ONLY by isolated test callers. */
export type OwnerPosition = Readonly<{
  wallet: string;
  shareMint: string;
  shareUnits: string;
  shareDecimals: 6;
  slot: number;
  scope: "LOCAL_CLONE" | "MAINNET_INDEPENDENT_RPC";
  nav: null;
}>;
export function parseOwnerPosition(
  value: unknown,
  wallet: string,
  shareMint: string,
  scope: OwnerPosition["scope"] = "MAINNET_INDEPENDENT_RPC",
): OwnerPosition {
  const r = value as OwnerPosition;
  if (
    !r ||
    typeof r !== "object" ||
    Array.isArray(r) ||
    r.wallet !== wallet ||
    r.shareMint !== shareMint ||
    r.scope !== scope ||
    r.shareDecimals !== 6 ||
    !Number.isSafeInteger(r.slot) ||
    r.slot <= 0 ||
    r.nav !== null ||
    typeof r.shareUnits !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(r.shareUnits) ||
    BigInt(r.shareUnits) > (1n << 64n) - 1n
  )
    throw Error("C3_OWNER_POSITION_UNVERIFIED");
  return Object.freeze({
    wallet: r.wallet,
    shareMint: r.shareMint,
    shareUnits: r.shareUnits,
    shareDecimals: 6,
    slot: r.slot,
    scope: r.scope,
    nav: null,
  });
}
