/** Product-authorized ISOLATED candidate, not Security/governance approval.
 * One lifetime deposit/position, not a pooled NAV-priced vault. Price data has
 * no place in this contract. Public mainnet activation remains separately gated.
 */
export const RESTRICTED_PILOT_CANDIDATE = Object.freeze({
  version: "c3-single-position-realized/v1" as const,
  approval: "ISOLATED_CANDIDATE_ONLY" as const,
  depositUsdcBaseUnits: "1000000",
  shareUnits: "1000000",
  lifetimeDeposits: 1,
  lifetimeRedemptions: 1,
  ownership: "SOLE_ALLOWLISTED_OWNER" as const,
  redemption: "FULL_REALIZED_USDC_ONLY" as const,
  valuation: "INFORMATIONAL_ONLY" as const,
  platformFeeBaseUnits: "0",
  skrEnabled: false,
});
// A separate reviewed release must pin this policy alongside its concrete
// binary/authorities/budget. Neither an environment value nor Product's isolated
// testing decision constitutes production admission.
export type RestrictedPilotApproval = Readonly<{
  version: "c3-single-position-realized/v1";
  policyHash: string;
  binaryHash: string;
  securityApprovalHash: string;
  governanceApprovalHash: string;
}>;
export const APPROVED_RESTRICTED_PILOT_POLICY: RestrictedPilotApproval | null =
  null;

export type RestrictedInventory = Readonly<
  Record<
    "USDC" | "cbBTC" | "PortalETH" | "WSOL",
    Readonly<{
      custodyBaseUnits: string;
      accountedBaseUnits: string;
      excludedReserveBaseUnits: string;
    }>
  >
>;
const u64 = (s: string) => {
  if (
    typeof s !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(s) ||
    BigInt(s) >= 1n << 64n
  )
    throw Error("C3_RESTRICTED_INTEGER");
  return BigInt(s);
};
/** Pure arithmetic, NOT evidence or an authorization. Call only after the
 * shared finalized account/receipt join. Donations are custody minus accounted,
 * never new shares, sale budgets, or withdrawable USDC. Pending reserves remain
 * outside an issued position; ownership cannot come from a journal flag alone.
 */
export function restrictedPositionMath(input: {
  inventory: RestrictedInventory;
  supply: string;
  owned: boolean;
  closed: boolean;
  realizedClaim: string | null;
}) {
  const supply = u64(input.supply);
  if (
    typeof input.owned !== "boolean" ||
    typeof input.closed !== "boolean" ||
    (input.owned && input.closed) ||
    supply !== (input.owned ? 1000000n : 0n)
  )
    throw Error("C3_RESTRICTED_OWNERSHIP");
  const donations = Object.fromEntries(
    (["USDC", "cbBTC", "PortalETH", "WSOL"] as const).map((asset) => {
      const { custodyBaseUnits, accountedBaseUnits, excludedReserveBaseUnits } =
        input.inventory[asset];
      const custody = u64(custodyBaseUnits),
        accounted = u64(accountedBaseUnits),
        reserve = u64(excludedReserveBaseUnits);
      if (
        custody < accounted ||
        reserve !== (input.owned ? 0n : accounted) ||
        (input.closed && accounted !== 0n)
      )
        throw Error("C3_RESTRICTED_BACKING_OR_RESERVES");
      return [asset, (custody - accounted).toString()];
    }),
  );
  let actual: string | null = null;
  if (input.realizedClaim !== null) {
    const claim = u64(input.realizedClaim);
    if (
      claim === 0n ||
      (!input.owned && !input.closed) ||
      (!input.closed &&
        claim !== u64(input.inventory.USDC.accountedBaseUnits)) ||
      (["cbBTC", "PortalETH", "WSOL"] as const).some(
        (a) => u64(input.inventory[a].accountedBaseUnits) !== 0n,
      )
    )
      throw Error("C3_RESTRICTED_REALIZED_CLAIM");
    actual = claim.toString();
  } else if (input.closed) throw Error("C3_RESTRICTED_MISSING_CLAIM_RECEIPT");
  return Object.freeze({
    status: "ARITHMETIC_ONLY_NOT_VERIFIED" as const,
    policyVersion: RESTRICTED_PILOT_CANDIDATE.version,
    shareUnits: supply.toString(),
    ownershipBps: input.owned ? 10000 : 0,
    donations: Object.freeze(donations),
    claimableUsdcBaseUnits: input.closed ? null : actual,
    returnedUsdcBaseUnits: input.closed ? actual : null,
    monetaryNav: null,
    valuation: "INFORMATIONAL_ONLY" as const,
    platformFeeBaseUnits: "0",
  });
}
