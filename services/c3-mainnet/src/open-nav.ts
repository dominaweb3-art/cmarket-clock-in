/**
 * Pure open-vault valuation, not an oracle or transaction authorization.
 *
 * Trust boundary still missing: a server-only collector must decode authenticated
 * raw accounts/signed updates with reviewed layouts, pin TWO economically
 * independent direct asset/USD sources per mint, enforce divergence, and bind
 * finalized custody/config/share supply and lifecycle accounting to one context.
 * It must obtain its own current clock, never caller prices/"verified" flags.
 * No research validators, underlying BTC/ETH prices, USD parity, or last-good
 * price fallback are used here. The raw collector is in open-nav-collector.ts;
 * no production source policy is enrolled.
 * Arithmetic/shape outputs below are explicitly UNVERIFIED, including in tests.
 */
import { C3_MAINNET } from "./constants.ts";
import { C3_MAINNET_ASSET_REGISTRY, type C3AssetId } from "./registry.ts";
import { publicKeyBytes } from "./solana.ts";

export const OPEN_NAV_USD_SCALE = 1_000_000_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const SHARE_UNITS = 1_000_000n;
const ASSETS = Object.freeze(["USDC", "cbBTC", "PortalETH", "WSOL"] as const);
const UNVERIFIED = "ARITHMETIC_ONLY_NOT_VERIFIED" as const;

export type OpenNavDirectSource = Readonly<{
  asset: C3AssetId;
  mint: string;
  operatorId: string;
  feedId: string;
  account: string;
  ownerProgram: string;
  maximumAgeSeconds: number;
  maximumConfidenceBps: number;
  maximumChainClockSkewSeconds: number;
}>;
export type OpenNavUnavailable = Readonly<{
  status: "UNAVAILABLE";
  reason:
    | "SOURCE_POLICY_NOT_PINNED"
    | "PRODUCTION_NOT_APPROVED"
    | "PRICE_POINT_EXPIRED"
    | "POINT_NOT_VERIFIED"
    | "UNCERTAIN_SETTLEMENT";
}>;
const unavailable = (
  reason: OpenNavUnavailable["reason"],
): OpenNavUnavailable => Object.freeze({ status: "UNAVAILABLE", reason });

export {
  collectVerifiedOpenNavPoint,
  evaluateVerifiedOpenNav,
  type VerifiedOpenNavPoint,
} from "./open-nav-collector.ts";

function fail(code: string): never {
  throw new Error(`C3_OPEN_NAV_${code}`);
}
function exact(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("SHAPE");
  const row = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    fail("SHAPE");
  // Accessors/custom prototypes are not a data packet. Reject rather than let
  // a getter change a price/inventory between validation and consumption.
  if (
    Object.getPrototypeOf(row) !== Object.prototype &&
    Object.getPrototypeOf(row) !== null
  )
    fail("SHAPE");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(row, key);
    if (!descriptor || !("value" in descriptor)) fail("SHAPE");
  }
  return row;
}
function amount(value: unknown, max = U64_MAX): bigint {
  if (
    typeof value !== "string" ||
    value.length > 39 ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  )
    fail("INTEGER");
  const n = BigInt(value);
  if (n > max) fail("OVERFLOW");
  return n;
}
function safeInteger(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail("INTEGER");
  return value;
}
function add(a: bigint, b: bigint): bigint {
  if (a + b > U128_MAX) fail("OVERFLOW");
  return a + b;
}
function mul(a: bigint, b: bigint): bigint {
  if (a * b > U128_MAX) fail("OVERFLOW");
  return a * b;
}
function key(value: unknown): string {
  if (typeof value !== "string" || value.length > 44) fail("SOURCE_KEY");
  publicKeyBytes(value);
  return value;
}

export type OpenNavEvaluationContext = Readonly<{
  genesisHash: string;
  finalizedSlot: number;
  chainTimeUnix: number;
  evaluatedAtUnix: number;
}>;

/** Strict decoded-field validation ONLY, NOT raw-account/signed-packet proof.
 * `source` and `context` must eventually come from the pinned server collector.
 * A caller supplying plausible metadata never receives a VerifiedOpenNavPoint.
 * Feed IDs refer to the exact wrapped asset/USD, not BTC/USD or ETH/USD.
 */
export function decodeOpenNavDirectQuote(
  input: unknown,
  source: OpenNavDirectSource,
  context: OpenNavEvaluationContext,
) {
  const p = exact(source, [
    "asset",
    "mint",
    "operatorId",
    "feedId",
    "account",
    "ownerProgram",
    "maximumAgeSeconds",
    "maximumConfidenceBps",
    "maximumChainClockSkewSeconds",
  ]);
  if (!ASSETS.includes(p.asset as C3AssetId)) fail("SOURCE_ASSET");
  const asset = p.asset as C3AssetId;
  if (
    p.mint !== C3_MAINNET_ASSET_REGISTRY[asset].mint ||
    typeof p.operatorId !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(p.operatorId) ||
    typeof p.feedId !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.feedId)
  )
    fail("SOURCE_POLICY");
  // Registry cbBTC/PortalETH IDs are underlying references, not direct feeds.
  if (
    (asset === "cbBTC" || asset === "PortalETH") &&
    p.feedId === C3_MAINNET_ASSET_REGISTRY[asset].oracleFeedId
  )
    fail("UNDERLYING_REFERENCE_FORBIDDEN");
  key(p.account);
  key(p.ownerProgram);
  const maxAge = safeInteger(p.maximumAgeSeconds, 1, 60);
  const maxConfidence = safeInteger(p.maximumConfidenceBps, 1, 200);
  const maxClockSkew = safeInteger(p.maximumChainClockSkewSeconds, 0, 60);
  const c = exact(context, [
    "genesisHash",
    "finalizedSlot",
    "chainTimeUnix",
    "evaluatedAtUnix",
  ]);
  if (c.genesisHash !== C3_MAINNET.genesisHash) fail("CHAIN");
  const slot = safeInteger(c.finalizedSlot, 1, Number.MAX_SAFE_INTEGER);
  const chainTime = safeInteger(c.chainTimeUnix, 1, Number.MAX_SAFE_INTEGER);
  const now = safeInteger(c.evaluatedAtUnix, 1, Number.MAX_SAFE_INTEGER);
  if (Math.abs(now - chainTime) > maxClockSkew) fail("CHAIN_CLOCK");
  const q = exact(input, [
    "asset",
    "mint",
    "quoteCurrency",
    "priceKind",
    "operatorId",
    "feedId",
    "account",
    "ownerProgram",
    "genesisHash",
    "commitment",
    "contextSlot",
    "priceMantissa",
    "confidenceMantissa",
    "exponent",
    "publishTimeUnix",
    "receivedTimeUnix",
    "evidenceHash",
  ]);
  for (const field of [
    "asset",
    "mint",
    "operatorId",
    "feedId",
    "account",
    "ownerProgram",
  ])
    if (q[field] !== p[field]) fail("SOURCE_BINDING");
  if (
    q.quoteCurrency !== "USD" ||
    q.priceKind !== "direct" ||
    q.genesisHash !== C3_MAINNET.genesisHash ||
    q.commitment !== "finalized" ||
    safeInteger(q.contextSlot, 1, Number.MAX_SAFE_INTEGER) !== slot
  )
    fail("CHAIN_OR_DENOMINATION");
  if (
    typeof q.evidenceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(q.evidenceHash) ||
    q.evidenceHash === "0".repeat(64)
  )
    fail("EVIDENCE_HASH");
  const published = safeInteger(q.publishTimeUnix, 1, Number.MAX_SAFE_INTEGER);
  const received = safeInteger(q.receivedTimeUnix, 1, Number.MAX_SAFE_INTEGER);
  if (
    published > received ||
    received > now ||
    published > now ||
    published > chainTime ||
    now - published > maxAge ||
    chainTime - published > maxAge
  )
    fail("PRICE_TIME");
  const price = amount(q.priceMantissa, U128_MAX);
  const confidence = amount(q.confidenceMantissa, U128_MAX);
  if (!price) fail("ZERO_PRICE");
  const confidenceNumerator = mul(confidence, 10_000n);
  if (confidenceNumerator > mul(price, BigInt(maxConfidence)))
    fail("CONFIDENCE");
  const exponent = safeInteger(q.exponent, -18, 0);
  const shift = exponent + 12;
  const priceUsdE12 =
    shift >= 0
      ? mul(price, 10n ** BigInt(shift))
      : price / 10n ** BigInt(-shift);
  if (!priceUsdE12) fail("ZERO_PRICE");
  return Object.freeze({
    status: "DECODED_FIELDS_NOT_AUTHENTICATED" as const,
    asset,
    priceUsdE12: priceUsdE12.toString(),
    confidenceBpsCeil: (
      confidenceNumerator / price +
      (confidenceNumerator % price === 0n ? 0n : 1n)
    ).toString(),
    publishTimeUnix: published,
    contextSlot: slot,
  });
}

export type OpenNavInventory = Readonly<{
  custodyBaseUnits: string;
  accountedBaseUnits: string;
  excludedReserveBaseUnits: string;
}>;
export type OpenNavMathInput = Readonly<{
  inventory: Readonly<Record<C3AssetId, OpenNavInventory>>;
  pricesUsdE12: Readonly<Record<C3AssetId, string>>;
  shareSupplyBaseUnits: string;
  expectedShareSupplyBaseUnits: string;
  lifecycle: "pre_issuance" | "active" | "redeeming" | "closed";
  settlementState: "certain" | "uncertain";
}>;

/** Accounted includes reserves; custody minus accounted is excluded donation.
 * Reserves are non-share-owned quantities, deducted ONCE before valuation.
 * Do not put outstanding holders' redemption rights into excluded reserves:
 * their shares remain in supply until burn. The collector must prove ownership
 * and lifecycle; this pure calculator cannot authenticate any caller inputs.
 * No issuance formula: the first 1,000,000 shares are units, NOT USD 1/share.
 */
export function calculateOpenNavMath(input: OpenNavMathInput) {
  const row = exact(input, [
    "inventory",
    "pricesUsdE12",
    "shareSupplyBaseUnits",
    "expectedShareSupplyBaseUnits",
    "lifecycle",
    "settlementState",
  ]);
  if (
    !["pre_issuance", "active", "redeeming", "closed"].includes(
      row.lifecycle as string,
    )
  )
    fail("LIFECYCLE");
  if (row.settlementState !== "certain" && row.settlementState !== "uncertain")
    fail("SETTLEMENT_STATE");
  const inventory = exact(row.inventory, ASSETS);
  const prices = exact(row.pricesUsdE12, ASSETS);
  const supply = amount(row.shareSupplyBaseUnits);
  if (supply !== amount(row.expectedShareSupplyBaseUnits))
    fail("SUPPLY_MISMATCH");
  const funded = row.lifecycle === "active" || row.lifecycle === "redeeming";
  if (supply !== (funded ? SHARE_UNITS : 0n)) fail("PILOT_SUPPLY");
  let gross = 0n,
    net = 0n;
  const values = {} as Record<C3AssetId, string>;
  const numbers = {} as Record<C3AssetId, bigint>;
  for (const asset of ASSETS) {
    const balance = exact(inventory[asset], [
      "custodyBaseUnits",
      "accountedBaseUnits",
      "excludedReserveBaseUnits",
    ]);
    const custody = amount(balance.custodyBaseUnits);
    const accounted = amount(balance.accountedBaseUnits);
    const reserve = amount(balance.excludedReserveBaseUnits);
    if (accounted > custody || reserve > accounted) fail("INVENTORY_BACKING");
    const price = amount(prices[asset], U128_MAX);
    if (!price) fail("ZERO_PRICE");
    const scale = 10n ** BigInt(C3_MAINNET_ASSET_REGISTRY[asset].decimals);
    gross = add(gross, mul(accounted, price) / scale);
    const value = mul(accounted - reserve, price) / scale;
    numbers[asset] = value;
    values[asset] = value.toString();
    net = add(net, value);
    if (!funded && accounted !== reserve) fail("UNOWNED_INVENTORY");
  }
  // Never publish a computed NAV while any transaction/economic effect is
  // uncertain, even when the currently observed balances happen to look valid.
  if (row.settlementState === "uncertain")
    return unavailable("UNCERTAIN_SETTLEMENT");
  const invested = add(add(numbers.cbBTC, numbers.PortalETH), numbers.WSOL);
  const btcBps = invested ? mul(numbers.cbBTC, 10_000n) / invested : 0n;
  const ethBps = invested ? mul(numbers.PortalETH, 10_000n) / invested : 0n;
  return Object.freeze({
    status: UNVERIFIED,
    assetValuesUsdE12: Object.freeze(values),
    accountedGrossUsdE12: gross.toString(),
    excludedReservesUsdE12: (gross - net).toString(),
    netUsdE12: net.toString(),
    shareSupplyBaseUnits: supply.toString(),
    sharePriceUsdE12: supply
      ? (mul(net, SHARE_UNITS) / supply).toString()
      : null,
    // Invested weights exclude USDC; SOL receives ONLY the display remainder.
    investedAllocationBps: invested
      ? Object.freeze({
          cbBTC: btcBps.toString(),
          PortalETH: ethBps.toString(),
          WSOL: (10_000n - btcBps - ethBps).toString(),
        })
      : null,
  });
}

/** Full-redemption arithmetic is price-independent. `accountedClaimUsdc` is
 * the reconciled claim entitlement, not whole ATA balance or a NAV estimate.
 * Supply/redeemed shares refer to the reconciled PRE-BURN state. Current zero
 * mint supply after a burn does not recreate or authenticate an entitlement.
 * This does not prove finality or authorize a payment; owner/effect/burn proofs
 * remain the separate lifecycle reconciliation boundary's responsibility.
 */
export function calculateOpenFullRedemptionMath(
  input: Readonly<{
    shareSupplyBaseUnits: string;
    redeemedSharesBaseUnits: string;
    custodyUsdcBaseUnits: string;
    accountedClaimUsdcBaseUnits: string;
    realizedUsdcBaseUnits: string;
    settlementState: "certain" | "uncertain";
  }>,
) {
  const row = exact(input, [
    "shareSupplyBaseUnits",
    "redeemedSharesBaseUnits",
    "custodyUsdcBaseUnits",
    "accountedClaimUsdcBaseUnits",
    "realizedUsdcBaseUnits",
    "settlementState",
  ]);
  if (row.settlementState !== "certain" && row.settlementState !== "uncertain")
    fail("SETTLEMENT_STATE");
  const supply = amount(row.shareSupplyBaseUnits);
  if (supply !== SHARE_UNITS || amount(row.redeemedSharesBaseUnits) !== supply)
    fail("FULL_REDEMPTION_REQUIRED");
  const custody = amount(row.custodyUsdcBaseUnits);
  const claim = amount(row.accountedClaimUsdcBaseUnits);
  const realized = amount(row.realizedUsdcBaseUnits);
  if (!realized || realized !== claim || claim > custody)
    fail("REALIZED_CLAIM");
  if (row.settlementState === "uncertain")
    return unavailable("UNCERTAIN_SETTLEMENT");
  return Object.freeze({
    status: UNVERIFIED,
    usdcBaseUnits: realized.toString(),
  });
}
