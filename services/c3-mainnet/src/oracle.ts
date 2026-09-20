import { C3_MAINNET } from "./constants.ts";
import { C3_MAINNET_ASSET_REGISTRY, type C3AssetId } from "./registry.ts";

export type OracleEvidence = Readonly<{
  asset: C3AssetId;
  feedId: string;
  source: "pyth-core";
  network: "mainnet-beta";
  authenticated: boolean;
  priceMantissa: string;
  confidenceMantissa: string;
  exponent: number;
  publishTimeUnix: number;
  receivedTimeUnix: number;
}>;

export function validateOracleEvidence(
  evidence: OracleEvidence,
  policy: Readonly<{ maximumAgeSeconds: number; maximumConfidenceBps: number }>,
): Readonly<{ priceUsdMicros: bigint; confidenceBps: bigint }> {
  const asset = C3_MAINNET_ASSET_REGISTRY[evidence.asset];
  if (evidence.feedId.toLowerCase().replace(/^0x/, "") !== asset.oracleFeedId)
    throw new Error("Oracle feed ID mismatch.");
  if (
    evidence.source !== "pyth-core" ||
    evidence.network !== C3_MAINNET.cluster ||
    !evidence.authenticated
  )
    throw new Error("Oracle source is not authenticated Mainnet Pyth.");
  if (
    !Number.isInteger(evidence.publishTimeUnix) ||
    !Number.isInteger(evidence.receivedTimeUnix)
  )
    throw new Error("Oracle timestamps are malformed.");
  const age = evidence.receivedTimeUnix - evidence.publishTimeUnix;
  if (age < 0 || age > policy.maximumAgeSeconds)
    throw new Error("Oracle evidence is stale or future-dated.");
  if (
    !/^[1-9]\d*$/.test(evidence.priceMantissa) ||
    !/^\d+$/.test(evidence.confidenceMantissa)
  )
    throw new Error("Oracle mantissas are malformed.");
  if (
    !Number.isInteger(evidence.exponent) ||
    evidence.exponent < -18 ||
    evidence.exponent > 0
  )
    throw new Error("Oracle exponent is outside the approved range.");
  const price = BigInt(evidence.priceMantissa);
  const confidence = BigInt(evidence.confidenceMantissa);
  const confidenceBps = (confidence * 10_000n + price - 1n) / price;
  if (confidenceBps > BigInt(policy.maximumConfidenceBps))
    throw new Error("Oracle confidence interval exceeds policy.");
  const scale = evidence.exponent + 6;
  const priceUsdMicros =
    scale >= 0 ? price * 10n ** BigInt(scale) : price / 10n ** BigInt(-scale);
  if (priceUsdMicros <= 0n) throw new Error("Oracle price resolves to zero.");
  return Object.freeze({ priceUsdMicros, confidenceBps });
}
