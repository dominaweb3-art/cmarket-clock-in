/** Research-only C Market candidate accounting. Never imported by production src. */
import { createHash } from "node:crypto";
import {
  C3_MAINNET_ASSET_REGISTRY,
  type C3AssetId,
} from "../../src/registry.ts";

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
export const USD_SCALE = 1_000_000_000_000n;
export const POLICY_VERSION = "c3-oracle-nav-candidate/v1";
export const FEEDS = Object.freeze({
  USDC: C3_MAINNET_ASSET_REGISTRY.USDC.oracleFeedId,
  cbBTC: C3_MAINNET_ASSET_REGISTRY.cbBTC.oracleFeedId,
  PortalETH: C3_MAINNET_ASSET_REGISTRY.PortalETH.oracleFeedId,
  WSOL: C3_MAINNET_ASSET_REGISTRY.WSOL.oracleFeedId,
});

export type Observation = Readonly<{
  operator: string;
  feedId: string;
  price: string;
  confidence: string;
  exponent: number;
  publishedAt: number;
  retrievedAt: number;
  sourceUrl: string;
  evidenceHash: string;
}>;
export type PricePair = Readonly<{
  primary: Observation;
  secondary: Observation;
}>;
export type ResearchPrice = Readonly<{
  asset: C3AssetId;
  mint: string;
  decimals: number;
  reference: PricePair;
  peg: PricePair | null;
}>;
export type SnapshotBody = Readonly<{
  schemaVersion: typeof POLICY_VERSION;
  researchOnly: true;
  snapshotId: string;
  cluster: "mainnet-beta";
  retrievedAt: number;
  evaluatedAt: number;
  prices: readonly ResearchPrice[];
  status: "research_fixture_only";
}>;
export type ResearchSnapshot = Readonly<
  SnapshotBody & { canonicalHash: string }
>;

function fail(message: string): never {
  throw new Error(message);
}
function keysExact(
  value: unknown,
  expected: readonly string[],
  label: string,
): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== [...expected].sort().join("|")
  )
    fail(`${label}: malformed fields`);
}
function bounded(value: bigint, max: bigint, label: string): bigint {
  if (value < 0n || value > max)
    fail(`${label}: unsigned overflow or negative`);
  return value;
}
function mulU128(left: bigint, right: bigint, label: string): bigint {
  return bounded(left * right, U128_MAX, label);
}
function integer(value: string, label: string, positive = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
    fail(`${label}: canonical integer string required`);
  const parsed = BigInt(value);
  bounded(parsed, U128_MAX, label);
  if (positive && parsed === 0n) fail(`${label}: zero is invalid`);
  return parsed;
}
function timestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    fail(`${label}: invalid timestamp`);
}
function observation(
  value: Observation,
  expectedFeed: string,
  now: number,
  maxAge: number,
  maxConfidenceBps: number,
): bigint {
  keysExact(
    value,
    [
      "operator",
      "feedId",
      "price",
      "confidence",
      "exponent",
      "publishedAt",
      "retrievedAt",
      "sourceUrl",
      "evidenceHash",
    ],
    "observation",
  );
  if (
    !value.operator ||
    !/^https:\/\//.test(value.sourceUrl) ||
    !/^[a-f0-9]{64}$/.test(value.evidenceHash)
  )
    fail("observation: source provenance missing");
  if (value.feedId !== expectedFeed) fail("observation: wrong feed ID");
  timestamp(value.publishedAt, "publication");
  timestamp(value.retrievedAt, "retrieval");
  if (
    value.publishedAt > value.retrievedAt ||
    value.retrievedAt > now ||
    now - value.publishedAt > maxAge
  )
    fail("observation: stale or future price");
  if (
    !Number.isSafeInteger(value.exponent) ||
    value.exponent < -18 ||
    value.exponent > 0
  )
    fail("observation: exponent overflow");
  const p = integer(value.price, "price", true),
    c = integer(value.confidence, "confidence");
  if (
    mulU128(c, 10_000n, "confidence ratio") >
    mulU128(p, BigInt(maxConfidenceBps), "confidence policy")
  )
    fail("observation: excessive confidence interval");
  const shift = value.exponent + 12;
  const normalized =
    shift >= 0
      ? mulU128(p, 10n ** BigInt(shift), "normalized price")
      : p / 10n ** BigInt(-shift);
  return bounded(normalized, U128_MAX, "normalized price");
}
export function evaluatePair(
  pair: PricePair,
  feedId: string,
  now: number,
  maxAge = 60,
  maxConfidenceBps = 200,
  maxDivergenceBps = 100,
): bigint {
  keysExact(pair, ["primary", "secondary"], "price pair");
  if (
    pair.primary.operator === pair.secondary.operator ||
    pair.primary.feedId === pair.secondary.feedId ||
    pair.primary.evidenceHash === pair.secondary.evidenceHash
  )
    fail("oracle: sources are not independent");
  const first = observation(
    pair.primary,
    feedId,
    now,
    maxAge,
    maxConfidenceBps,
  );
  // An independent feed ID must be explicitly paired with its own observation; this is research-only.
  const second = observation(
    pair.secondary,
    pair.secondary.feedId,
    now,
    maxAge,
    maxConfidenceBps,
  );
  if (!pair.secondary.feedId) fail("oracle: secondary feed missing");
  const gap = first > second ? first - second : second - first;
  if (
    mulU128(gap, 10_000n, "oracle gap") >
    mulU128(first, BigInt(maxDivergenceBps), "oracle divergence policy")
  )
    fail("oracle: source disagreement");
  return first;
}
export function evaluateAssetPrice(input: ResearchPrice, now: number): bigint {
  keysExact(
    input,
    ["asset", "mint", "decimals", "reference", "peg"],
    "asset price",
  );
  const definition = C3_MAINNET_ASSET_REGISTRY[input.asset];
  if (
    !definition ||
    input.mint !== definition.mint ||
    input.decimals !== definition.decimals
  )
    fail("asset: wrong mint or decimals");
  const reference = evaluatePair(input.reference, FEEDS[input.asset], now);
  if (input.asset === "cbBTC" || input.asset === "PortalETH") {
    if (!input.peg) fail("asset: proxy requires peg evidence");
    const peg = evaluatePair(input.peg, `${input.asset}/reference`, now);
    return mulU128(reference, peg, "proxy price intermediate") / USD_SCALE;
  }
  if (input.peg !== null) fail("asset: unexpected peg evidence");
  return reference;
}
function canonical(body: SnapshotBody): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, ordered(item)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(ordered(body)))
    .digest("hex");
}
export function makeResearchSnapshot(body: SnapshotBody): ResearchSnapshot {
  keysExact(
    body,
    [
      "schemaVersion",
      "researchOnly",
      "snapshotId",
      "cluster",
      "retrievedAt",
      "evaluatedAt",
      "prices",
      "status",
    ],
    "snapshot",
  );
  if (
    body.schemaVersion !== POLICY_VERSION ||
    body.researchOnly !== true ||
    body.status !== "research_fixture_only" ||
    body.cluster !== "mainnet-beta" ||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(body.snapshotId)
  )
    fail("snapshot: invalid research schema");
  timestamp(body.retrievedAt, "snapshot retrieval");
  timestamp(body.evaluatedAt, "snapshot evaluation");
  if (
    body.retrievedAt > body.evaluatedAt ||
    body.prices.length !== 4 ||
    new Set(body.prices.map((p) => p.asset)).size !== 4
  )
    fail("snapshot: incomplete assets or time");
  for (const p of body.prices) evaluateAssetPrice(p, body.evaluatedAt);
  const copy = structuredClone(body);
  const result = { ...copy, canonicalHash: canonical(copy) };
  for (const p of result.prices) {
    Object.freeze(p.reference.primary);
    Object.freeze(p.reference.secondary);
    Object.freeze(p.reference);
    if (p.peg) {
      Object.freeze(p.peg.primary);
      Object.freeze(p.peg.secondary);
      Object.freeze(p.peg);
    }
    Object.freeze(p);
  }
  Object.freeze(result.prices);
  return Object.freeze(result);
}
export function validateResearchSnapshot(snapshot: ResearchSnapshot): void {
  keysExact(
    snapshot,
    [
      "schemaVersion",
      "researchOnly",
      "snapshotId",
      "cluster",
      "retrievedAt",
      "evaluatedAt",
      "prices",
      "status",
      "canonicalHash",
    ],
    "snapshot",
  );
  const { canonicalHash, ...body } = snapshot;
  if (
    !/^[a-f0-9]{64}$/.test(canonicalHash) ||
    canonical(body as SnapshotBody) !== canonicalHash
  )
    fail("snapshot: tampered canonical hash");
  makeResearchSnapshot(body as SnapshotBody);
}

export type NavInput = Readonly<{
  balances: Readonly<Record<C3AssetId, string>>;
  pricesE12: Readonly<Record<C3AssetId, string>>;
  shareSupply: string;
  expectedShareSupply: string;
  shareDecimals: number;
  pendingDepositsE12: string;
  pendingWithdrawalsE12: string;
  reservesE12: string;
  feesAccruedE12: string;
  dustE12: string;
  snapshotHash: string;
  policyVersion: typeof POLICY_VERSION;
}>;
export function candidateNav(input: NavInput) {
  keysExact(
    input,
    [
      "balances",
      "pricesE12",
      "shareSupply",
      "expectedShareSupply",
      "shareDecimals",
      "pendingDepositsE12",
      "pendingWithdrawalsE12",
      "reservesE12",
      "feesAccruedE12",
      "dustE12",
      "snapshotHash",
      "policyVersion",
    ],
    "NAV input",
  );
  if (
    input.policyVersion !== POLICY_VERSION ||
    !/^[a-f0-9]{64}$/.test(input.snapshotHash)
  )
    fail("NAV: invalid policy or snapshot hash");
  if (
    !Number.isInteger(input.shareDecimals) ||
    input.shareDecimals < 0 ||
    input.shareDecimals > 9
  )
    fail("NAV: share decimals invalid");
  keysExact(input.balances, ["USDC", "cbBTC", "PortalETH", "WSOL"], "balances");
  keysExact(input.pricesE12, ["USDC", "cbBTC", "PortalETH", "WSOL"], "prices");
  const supply = bounded(
    integer(input.shareSupply, "share supply"),
    U64_MAX,
    "share supply",
  );
  if (
    supply !==
    bounded(
      integer(input.expectedShareSupply, "expected share supply"),
      U64_MAX,
      "expected share supply",
    )
  )
    fail("NAV: share supply mismatch");
  const values = {} as Record<C3AssetId, bigint>;
  let gross = 0n;
  for (const asset of ["USDC", "cbBTC", "PortalETH", "WSOL"] as const) {
    const b = bounded(
      integer(input.balances[asset], `${asset} balance`),
      U64_MAX,
      `${asset} balance`,
    );
    const p = integer(input.pricesE12[asset], `${asset} price`, true);
    values[asset] =
      mulU128(b, p, `${asset} value intermediate`) /
      10n ** BigInt(C3_MAINNET_ASSET_REGISTRY[asset].decimals);
    gross = bounded(gross + values[asset], U128_MAX, "gross assets");
  }
  const liabilities = [
    input.pendingDepositsE12,
    input.pendingWithdrawalsE12,
    input.reservesE12,
    input.feesAccruedE12,
  ].reduce(
    (sum, item) =>
      bounded(sum + integer(item, "liability"), U128_MAX, "liabilities"),
    0n,
  );
  if (liabilities > gross) fail("NAV: liabilities exceed assets");
  const net = gross - liabilities;
  const dust = integer(input.dustE12, "dust");
  if (dust > net || dust > USD_SCALE / 100n) fail("NAV: unbounded dust");
  if ((supply === 0n && net !== 0n) || (supply > 0n && net === 0n))
    fail("NAV: share supply and assets inconsistent");
  const invested = values.cbBTC + values.PortalETH + values.WSOL;
  const btcBps = invested
    ? mulU128(values.cbBTC, 10_000n, "BTC allocation intermediate") / invested
    : 0n;
  const ethBps = invested
    ? mulU128(values.PortalETH, 10_000n, "ETH allocation intermediate") /
      invested
    : 0n;
  const solBps = invested ? 10_000n - btcBps - ethBps : 0n;
  const sharePriceE12 = supply
    ? mulU128(
        net,
        10n ** BigInt(input.shareDecimals),
        "share price intermediate",
      ) / supply
    : null;
  return Object.freeze({
    assetValuesE12: Object.freeze(values),
    grossE12: gross,
    liabilitiesE12: liabilities,
    netE12: net,
    allocationBps: Object.freeze({
      cbBTC: btcBps,
      PortalETH: ethBps,
      WSOL: solBps,
    }),
    deviationBps: Object.freeze({
      cbBTC: btcBps - 4_000n,
      PortalETH: ethBps - 3_000n,
      WSOL: solBps - 3_000n,
    }),
    sharePriceE12,
    status: "research_candidate_only" as const,
  });
}
/** Binds a research snapshot to NAV inputs; errors remain explicit and no result authorizes execution. */
export function evaluateResearchNav(
  snapshot: ResearchSnapshot,
  state: Omit<NavInput, "pricesE12" | "snapshotHash">,
) {
  try {
    validateResearchSnapshot(snapshot);
    const prices = {} as Record<C3AssetId, string>;
    for (const price of snapshot.prices)
      prices[price.asset] = evaluateAssetPrice(
        price,
        snapshot.evaluatedAt,
      ).toString();
    const nav = candidateNav({
      ...state,
      pricesE12: prices,
      snapshotHash: snapshot.canonicalHash,
    });
    const observations = snapshot.prices.flatMap((item) => [
      item.reference.primary,
      item.reference.secondary,
      ...(item.peg ? [item.peg.primary, item.peg.secondary] : []),
    ]);
    const maximumConfidenceBps = observations.reduce((largest, item) => {
      const price = integer(item.price, "confidence price", true);
      const conf = integer(item.confidence, "confidence interval");
      const bps =
        bounded(
          mulU128(conf, 10_000n, "confidence numerator") + price - 1n,
          U128_MAX,
          "confidence ceil numerator",
        ) / price;
      return bps > largest ? bps : largest;
    }, 0n);
    return Object.freeze({
      readiness: "research_fixture_only" as const,
      maximumConfidenceBps,
      rejectedPriceReasons: [] as string[],
      nav,
    });
  } catch (error) {
    return Object.freeze({
      readiness: "rejected" as const,
      maximumConfidenceBps: null,
      rejectedPriceReasons: [
        error instanceof Error ? error.message : "unknown invalid evidence",
      ],
      nav: null,
    });
  }
}
export function candidateInitialShares(
  depositE12: bigint,
  shareDecimals: number,
  existingShareSupply: bigint,
  existingNetE12: bigint,
): bigint {
  bounded(depositE12, U128_MAX, "deposit");
  bounded(existingShareSupply, U64_MAX, "existing share supply");
  bounded(existingNetE12, U128_MAX, "existing NAV");
  if (existingShareSupply !== 0n || existingNetE12 !== 0n)
    fail("initial shares require zero supply and zero NAV");
  if (
    !Number.isInteger(shareDecimals) ||
    shareDecimals < 0 ||
    shareDecimals > 9
  )
    fail("invalid share decimals");
  const shares =
    mulU128(
      depositE12,
      10n ** BigInt(shareDecimals),
      "initial shares intermediate",
    ) / USD_SCALE;
  if (depositE12 === 0n || shares === 0n)
    fail("zero or dust-only initial deposit");
  return bounded(shares, U64_MAX, "issued shares");
}
export function candidateDepositShares(
  depositE12: bigint,
  supply: bigint,
  netBeforeE12: bigint,
): bigint {
  bounded(depositE12, U128_MAX, "deposit");
  bounded(supply, U64_MAX, "share supply");
  bounded(netBeforeE12, U128_MAX, "NAV");
  if (!depositE12 || !supply || !netBeforeE12)
    fail("deposit: zero denominator or amount");
  const shares =
    mulU128(depositE12, supply, "deposit shares intermediate") / netBeforeE12;
  if (!shares) fail("deposit: zero shares from rounding");
  return bounded(shares, U64_MAX, "issued shares");
}
export function candidateRedeemValue(
  shares: bigint,
  supply: bigint,
  netE12: bigint,
): bigint {
  bounded(shares, U64_MAX, "redeemed shares");
  bounded(supply, U64_MAX, "share supply");
  bounded(netE12, U128_MAX, "NAV");
  if (!shares || !supply || shares > supply || !netE12)
    fail("redeem: invalid shares or NAV");
  const value = mulU128(shares, netE12, "redemption intermediate") / supply;
  if (value === 0n) fail("redeem: zero value after rounding");
  return value;
}
