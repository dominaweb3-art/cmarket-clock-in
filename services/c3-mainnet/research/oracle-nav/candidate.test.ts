import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POLICY_VERSION,
  FEEDS,
  USD_SCALE,
  candidateNav,
  candidateInitialShares,
  candidateDepositShares,
  candidateRedeemValue,
  evaluatePair,
  evaluateAssetPrice,
  makeResearchSnapshot,
  validateResearchSnapshot,
  evaluateResearchNav,
  type Observation,
  type ResearchPrice,
  type SnapshotBody,
  type NavInput,
  type PricePair,
} from "./candidate.ts";
import { C3_MAINNET_ASSET_REGISTRY } from "../../src/registry.ts";

const now = 1_800_000_000;
const hash = "a".repeat(64);
const observation = (
  feedId: string,
  operator: string,
  price = "100000000",
  exponent = -8,
): Observation => ({
  operator,
  feedId,
  price,
  confidence: "100",
  exponent,
  publishedAt: now - 1,
  retrievedAt: now,
  sourceUrl: "https://example.org/research-fixture",
  evidenceHash: operator === "Pyth-fixture" ? "a".repeat(64) : "b".repeat(64),
});
const pair = (feedId: string) => ({
  primary: observation(feedId, "Pyth-fixture"),
  secondary: observation(
    `independent-fixture-${feedId}`,
    "Independent-fixture",
  ),
});
const price = (asset: keyof typeof FEEDS): ResearchPrice => ({
  asset,
  mint: C3_MAINNET_ASSET_REGISTRY[asset].mint,
  decimals: C3_MAINNET_ASSET_REGISTRY[asset].decimals,
  reference: pair(FEEDS[asset]),
  peg:
    asset === "cbBTC" || asset === "PortalETH"
      ? pair(`${asset}/reference`)
      : null,
});
const body = (): SnapshotBody => ({
  schemaVersion: POLICY_VERSION,
  researchOnly: true,
  snapshotId: "fixture001",
  cluster: "mainnet-beta",
  retrievedAt: now,
  evaluatedAt: now,
  prices: [price("USDC"), price("cbBTC"), price("PortalETH"), price("WSOL")],
  status: "research_fixture_only",
});
const navInput = (): NavInput => ({
  balances: {
    USDC: "1000000",
    cbBTC: "100000000",
    PortalETH: "100000000",
    WSOL: "1000000000",
  },
  pricesE12: {
    USDC: USD_SCALE.toString(),
    cbBTC: (2n * USD_SCALE).toString(),
    PortalETH: (3n * USD_SCALE).toString(),
    WSOL: (5n * USD_SCALE).toString(),
  },
  shareSupply: "11000000",
  expectedShareSupply: "11000000",
  shareDecimals: 6,
  pendingDepositsE12: "0",
  pendingWithdrawalsE12: "0",
  reservesE12: "0",
  feesAccruedE12: "0",
  dustE12: "0",
  snapshotHash: hash,
  policyVersion: POLICY_VERSION,
});
type Mutable<T> = T extends object
  ? { -readonly [K in keyof T]: Mutable<T[K]> }
  : T;
const mutatePrice = (f: (p: Mutable<ResearchPrice>) => void) => {
  const p = structuredClone(price("cbBTC")) as Mutable<ResearchPrice>;
  f(p);
  return () => evaluateAssetPrice(p, now);
};

test("research snapshot is immutable, canonical, and cannot impersonate production verification", () => {
  const snapshot = makeResearchSnapshot(body());
  validateResearchSnapshot(snapshot);
  const reordered = Object.fromEntries(
    Object.entries(body()).reverse(),
  ) as SnapshotBody;
  assert.equal(
    makeResearchSnapshot(reordered).canonicalHash,
    snapshot.canonicalHash,
  );
  assert.equal(Object.isFrozen(snapshot.prices[0]?.reference.primary), true);
  assert.throws(
    () =>
      validateResearchSnapshot({ ...snapshot, canonicalHash: "b".repeat(64) }),
    /tampered/,
  );
  assert.throws(
    () => makeResearchSnapshot({ ...body(), verified: true } as SnapshotBody),
    /malformed/,
  );
  assert.throws(
    () =>
      makeResearchSnapshot({
        ...body(),
        status: "production_verified",
      } as unknown as SnapshotBody),
    /invalid/,
  );
  assert.throws(
    () => makeResearchSnapshot({ ...body(), prices: body().prices.slice(1) }),
    /incomplete/,
  );
});
test("stale, future, confidence, missing, duplicate and divergent sources fail closed", () => {
  assert.equal(evaluatePair(pair(FEEDS.USDC), FEEDS.USDC, now), USD_SCALE);
  assert.throws(
    () =>
      evaluatePair(
        {
          ...pair(FEEDS.USDC),
          primary: { ...pair(FEEDS.USDC).primary, publishedAt: now - 61 },
        },
        FEEDS.USDC,
        now,
      ),
    /stale/,
  );
  assert.throws(
    () =>
      evaluatePair(
        {
          ...pair(FEEDS.USDC),
          primary: { ...pair(FEEDS.USDC).primary, publishedAt: now + 1 },
        },
        FEEDS.USDC,
        now,
      ),
    /future/,
  );
  assert.throws(
    () =>
      evaluatePair(
        {
          ...pair(FEEDS.USDC),
          primary: { ...pair(FEEDS.USDC).primary, confidence: "3000000" },
        },
        FEEDS.USDC,
        now,
      ),
    /confidence/,
  );
  assert.throws(
    () =>
      evaluatePair(
        { ...pair(FEEDS.USDC), secondary: pair(FEEDS.USDC).primary },
        FEEDS.USDC,
        now,
      ),
    /not independent/,
  );
  assert.throws(
    () =>
      evaluatePair(
        {
          ...pair(FEEDS.USDC),
          secondary: { ...pair(FEEDS.USDC).secondary, price: "150000000" },
        },
        FEEDS.USDC,
        now,
      ),
    /disagreement/,
  );
  assert.throws(
    () =>
      evaluatePair(
        { primary: pair(FEEDS.USDC).primary } as unknown as PricePair,
        FEEDS.USDC,
        now,
      ),
    /malformed/,
  );
});
test("wrong mint/feed/decimals and absent proxy evidence fail closed", () => {
  assert.equal(evaluateAssetPrice(price("cbBTC"), now), USD_SCALE);
  assert.throws(
    mutatePrice((p) => (p.mint = C3_MAINNET_ASSET_REGISTRY.USDC.mint)),
    /wrong mint/,
  );
  assert.throws(
    mutatePrice((p) => (p.decimals = 6)),
    /wrong mint or decimals/,
  );
  assert.throws(
    mutatePrice((p) => (p.reference.primary.feedId = FEEDS.USDC)),
    /wrong feed/,
  );
  assert.throws(
    mutatePrice((p) => (p.peg = null)),
    /requires peg/,
  );
  assert.throws(
    mutatePrice((p) => {
      if (p.peg) p.peg.primary.feedId = "wrong";
    }),
    /wrong feed/,
  );
  assert.throws(
    mutatePrice((p) => (p.reference.primary.exponent = -19)),
    /exponent/,
  );
  assert.throws(
    mutatePrice((p) => (p.reference.primary.price = "-1")),
    /canonical/,
  );
  assert.throws(
    mutatePrice((p) => (p.reference.primary.price = "0")),
    /zero/,
  );
  assert.throws(
    mutatePrice((p) => (p.reference.primary.price = "1.5")),
    /canonical/,
  );
  assert.throws(
    mutatePrice((p) => (p.reference.primary.price = (1n << 129n).toString())),
    /overflow/,
  );
  assert.throws(
    () =>
      evaluateAssetPrice(
        {
          ...price("cbBTC"),
          asset: "fake-bridged",
        } as unknown as ResearchPrice,
        now,
      ),
    /wrong mint/,
  );
});
test("NAV uses exact integer arithmetic, liabilities and target deviations", () => {
  const n = candidateNav(navInput());
  assert.equal(n.grossE12, 11n * USD_SCALE);
  assert.equal(n.netE12, 11n * USD_SCALE);
  assert.equal(n.sharePriceE12, USD_SCALE);
  assert.equal(
    n.allocationBps.cbBTC + n.allocationBps.PortalETH + n.allocationBps.WSOL,
    10_000n,
  );
  const liabilities = candidateNav({
    ...navInput(),
    pendingDepositsE12: USD_SCALE.toString(),
    pendingWithdrawalsE12: USD_SCALE.toString(),
    reservesE12: USD_SCALE.toString(),
    feesAccruedE12: USD_SCALE.toString(),
    shareSupply: "7000000",
    expectedShareSupply: "7000000",
  });
  assert.equal(liabilities.netE12, 7n * USD_SCALE);
  assert.equal(candidateInitialShares(USD_SCALE, 6, 0n, 0n), 1_000_000n);
  assert.equal(
    candidateDepositShares(USD_SCALE, 11_000_000n, 11n * USD_SCALE),
    1_000_000n,
  );
  assert.equal(
    candidateRedeemValue(1_000_000n, 11_000_000n, 11n * USD_SCALE),
    USD_SCALE,
  );
});
test("research NAV reports rejected prices and never returns production readiness", () => {
  const snapshot = makeResearchSnapshot(body());
  const value = navInput();
  const state: Omit<NavInput, "pricesE12" | "snapshotHash"> = {
    balances: value.balances,
    shareSupply: value.shareSupply,
    expectedShareSupply: value.expectedShareSupply,
    shareDecimals: value.shareDecimals,
    pendingDepositsE12: value.pendingDepositsE12,
    pendingWithdrawalsE12: value.pendingWithdrawalsE12,
    reservesE12: value.reservesE12,
    feesAccruedE12: value.feesAccruedE12,
    dustE12: value.dustE12,
    policyVersion: value.policyVersion,
  };
  const good = evaluateResearchNav(snapshot, state);
  assert.equal(good.readiness, "research_fixture_only");
  assert.equal(good.maximumConfidenceBps, 1n);
  assert.ok(good.nav);
  const bad = evaluateResearchNav(
    { ...snapshot, canonicalHash: "b".repeat(64) },
    state,
  );
  assert.equal(bad.readiness, "rejected");
  assert.equal(bad.nav, null);
  assert.match(bad.rejectedPriceReasons[0]!, /tampered/);
});
test("zero, dust, bounds, supply mismatch, omitted flows and float input fail closed", () => {
  assert.throws(() => candidateInitialShares(1n, 6, 0n, 0n), /zero or dust/);
  assert.throws(
    () => candidateInitialShares(1n << 129n, 6, 0n, 0n),
    /overflow/,
  );
  assert.throws(
    () => candidateInitialShares(USD_SCALE, 6, 1n, 0n),
    /zero supply/,
  );
  assert.throws(() => candidateInitialShares(USD_SCALE, 6, 0n, 1n), /zero NAV/);
  assert.throws(() => candidateDepositShares(1n, 1n, 100n), /zero shares/);
  assert.throws(
    () => candidateRedeemValue(2n, 1n, USD_SCALE),
    /invalid shares/,
  );
  assert.throws(() => candidateRedeemValue(1n, 100n, 1n), /zero value/);
  assert.throws(
    () => candidateNav({ ...navInput(), shareSupply: "1" }),
    /supply mismatch/,
  );
  assert.throws(
    () =>
      candidateNav({
        ...navInput(),
        pendingDepositsE12: undefined,
      } as unknown as NavInput),
    /canonical/,
  );
  const omitted = Object.fromEntries(
    Object.entries(navInput()).filter(
      ([key]) => key !== "pendingWithdrawalsE12",
    ),
  ) as unknown as NavInput;
  assert.throws(() => candidateNav(omitted), /malformed/);
  assert.throws(
    () => candidateNav({ ...navInput(), dustE12: USD_SCALE.toString() }),
    /unbounded dust/,
  );
  assert.throws(
    () =>
      candidateNav({
        ...navInput(),
        balances: { ...navInput().balances, USDC: 1.5 },
      } as unknown as NavInput),
    /canonical/,
  );
  assert.throws(
    () =>
      candidateNav({
        ...navInput(),
        balances: { ...navInput().balances, USDC: (1n << 64n).toString() },
      }),
    /overflow/,
  );
  assert.throws(
    () =>
      candidateNav({
        ...navInput(),
        shareSupply: "0",
        expectedShareSupply: "0",
      }),
    /inconsistent/,
  );
  assert.throws(
    () =>
      candidateNav({
        ...navInput(),
        pendingDepositsE12: (12n * USD_SCALE).toString(),
      }),
    /liabilities exceed/,
  );
  assert.throws(
    () =>
      candidateNav({
        ...navInput(),
        pricesE12: { ...navInput().pricesE12, cbBTC: (1n << 129n).toString() },
      }),
    /overflow/,
  );
});
