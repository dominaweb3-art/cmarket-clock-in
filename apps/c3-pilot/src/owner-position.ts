/** Strict wire model: targets/journal counts never substitute share balance or
 * NAV. Clone evidence is permitted ONLY by isolated test callers. */
export type OwnerNav = Readonly<{
  status: "VERIFIED";
  contextSlot: number;
  priceContextSlot: number;
  netUsdE12: string;
  sharePriceUsdE12: string | null;
}>;
export type OwnerPosition = Readonly<{
  wallet: string;
  shareMint: string;
  shareUnits: string;
  shareDecimals: 6;
  slot: number;
  scope: "LOCAL_CLONE" | "MAINNET_INDEPENDENT_RPC";
  nav: OwnerNav | null;
  restrictedPosition: RestrictedPosition | null;
}>;
export type RestrictedPosition = Readonly<{
  status: "RECONCILED_SINGLE_POSITION";
  policyVersion: "c3-single-position-realized/v1";
  contextSlot: number;
  shareUnits: string;
  ownershipBps: 0 | 10000;
  claimableUsdcBaseUnits: string | null;
  returnedUsdcBaseUnits: string | null;
  monetaryNav: null;
  valuation: "INFORMATIONAL_ONLY";
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
    typeof r.shareUnits !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(r.shareUnits) ||
    BigInt(r.shareUnits) > (1n << 64n) - 1n
  )
    throw Error("C3_OWNER_POSITION_UNVERIFIED");
  let nav: OwnerNav | null = null;
  let restrictedPosition: RestrictedPosition | null = null;
  if (r.restrictedPosition !== null && r.restrictedPosition !== undefined) {
    const p = r.restrictedPosition;
    const amount = (v: unknown) =>
      typeof v === "string" &&
      /^[1-9][0-9]{0,19}$/.test(v) &&
      BigInt(v) < 1n << 64n;
    if (
      !p ||
      typeof p !== "object" ||
      Array.isArray(p) ||
      Object.keys(p).sort().join() !==
        "claimableUsdcBaseUnits,contextSlot,monetaryNav,ownershipBps,policyVersion,returnedUsdcBaseUnits,shareUnits,status,valuation" ||
      p.status !== "RECONCILED_SINGLE_POSITION" ||
      p.policyVersion !== "c3-single-position-realized/v1" ||
      !Number.isSafeInteger(p.contextSlot) ||
      p.contextSlot < r.slot ||
      p.shareUnits !== r.shareUnits ||
      !["0", "1000000"].includes(p.shareUnits) ||
      p.ownershipBps !== (p.shareUnits === "1000000" ? 10000 : 0) ||
      p.monetaryNav !== null ||
      p.valuation !== "INFORMATIONAL_ONLY" ||
      !(
        p.claimableUsdcBaseUnits === null ||
        (amount(p.claimableUsdcBaseUnits) && p.shareUnits === "1000000")
      ) ||
      !(
        p.returnedUsdcBaseUnits === null ||
        (amount(p.returnedUsdcBaseUnits) && p.shareUnits === "0")
      ) ||
      (p.claimableUsdcBaseUnits !== null && p.returnedUsdcBaseUnits !== null)
    )
      throw Error("C3_OWNER_POSITION_UNVERIFIED");
    restrictedPosition = Object.freeze({ ...p });
  }
  if (r.nav !== null) {
    const n = r.nav;
    const price = (value: unknown) =>
      typeof value === "string" &&
      /^(0|[1-9][0-9]{0,38})$/.test(value) &&
      BigInt(value) <= (1n << 128n) - 1n;
    if (
      !n ||
      typeof n !== "object" ||
      Array.isArray(n) ||
      Object.keys(n).sort().join() !==
        "contextSlot,netUsdE12,priceContextSlot,sharePriceUsdE12,status" ||
      scope !== "MAINNET_INDEPENDENT_RPC" ||
      n.status !== "VERIFIED" ||
      !Number.isSafeInteger(n.contextSlot) ||
      n.contextSlot < r.slot ||
      !Number.isSafeInteger(n.priceContextSlot) ||
      n.priceContextSlot <= 0 ||
      n.priceContextSlot > n.contextSlot ||
      !price(n.netUsdE12) ||
      !(n.sharePriceUsdE12 === null || price(n.sharePriceUsdE12))
    )
      throw Error("C3_OWNER_POSITION_UNVERIFIED");
    nav = Object.freeze({ ...n });
  }
  return Object.freeze({
    wallet: r.wallet,
    shareMint: r.shareMint,
    shareUnits: r.shareUnits,
    shareDecimals: 6,
    slot: r.slot,
    scope: r.scope,
    nav,
    restrictedPosition,
  });
}
