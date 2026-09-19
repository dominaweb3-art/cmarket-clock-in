export const C3_FEE_RATE_DENOMINATOR = 100_000n

export const C3_FEE_POLICY = Object.freeze({
  version: 'c3-fees/product-candidate-v1',
  status: 'product_approved_security_and_squads_pending',
  productApproved: true,
  securityApproved: false,
  squadsGovernanceApproved: false,
  collectionEnabled: false,
  skrDiscountEnabled: false,
  buyRateUnits: 150n,
  sellRateUnits: 150n,
  verifiedSkrRateUnits: 75n,
  rateDenominator: C3_FEE_RATE_DENOMINATOR,
  obsoleteProposals: Object.freeze([
    Object.freeze({ operation: 'deposit', basisPoints: 60, status: 'obsolete' }),
    Object.freeze({ operation: 'withdraw', basisPoints: 10, status: 'obsolete' }),
  ]),
})

export type C3FeeOperation = 'buy' | 'sell'

export type C3CandidateFeeQuote = Readonly<{
  grossBaseUnits: bigint
  feeBaseUnits: bigint
  netBaseUnits: bigint
  rateUnits: bigint
  rateDenominator: bigint
  roundingExcessNumerator: bigint
}>

export function calculateC3CandidateFee(
  grossBaseUnits: bigint,
  operation: C3FeeOperation,
  verifiedSkrEligible: boolean,
): C3CandidateFeeQuote {
  if (grossBaseUnits < 0n) {
    throw new RangeError('C3 fee amount cannot be negative.')
  }

  const standardRate = operation === 'buy' ? C3_FEE_POLICY.buyRateUnits : C3_FEE_POLICY.sellRateUnits
  const rateUnits = verifiedSkrEligible ? C3_FEE_POLICY.verifiedSkrRateUnits : standardRate
  const rawNumerator = grossBaseUnits * rateUnits
  const feeBaseUnits =
    rawNumerator === 0n ? 0n : (rawNumerator + C3_FEE_RATE_DENOMINATOR - 1n) / C3_FEE_RATE_DENOMINATOR

  return Object.freeze({
    grossBaseUnits,
    feeBaseUnits,
    netBaseUnits: grossBaseUnits - feeBaseUnits,
    rateUnits,
    rateDenominator: C3_FEE_RATE_DENOMINATOR,
    roundingExcessNumerator: feeBaseUnits * C3_FEE_RATE_DENOMINATOR - rawNumerator,
  })
}
