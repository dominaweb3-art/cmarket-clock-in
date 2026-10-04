import assert from "node:assert/strict";
import { test } from "node:test";
import {
  C3_MAINNET,
  C3_MAINNET_EXECUTION_CAPABILITY,
} from "../src/constants.ts";
import { C3_MAINNET_ASSET_REGISTRY as registry } from "../src/registry.ts";
import {
  OPEN_NAV_USD_SCALE,
  calculateOpenNavMath,
  calculateOpenFullRedemptionMath,
  collectVerifiedOpenNavPoint,
  evaluateVerifiedOpenNav,
  decodeOpenNavDirectQuote,
  type OpenNavMathInput,
  type OpenNavDirectSource,
  type OpenNavEvaluationContext,
  type VerifiedOpenNavPoint,
} from "../src/open-nav.ts";
import { PINNED_OPEN_NAV_COLLECTOR_POLICY } from "../src/open-nav-collector.ts";

const now = 1_800_000_000;
const context: OpenNavEvaluationContext = {
  genesisHash: C3_MAINNET.genesisHash,
  finalizedSlot: 100,
  chainTimeUnix: now,
  evaluatedAtUnix: now,
};
// Deliberately synthetic direct-feed pins, NEVER production enrolled.
const source = (
  asset: OpenNavDirectSource["asset"] = "USDC",
): OpenNavDirectSource => ({
  asset,
  mint: registry[asset].mint,
  operatorId: "synthetic-server",
  feedId: "f".repeat(64),
  account: C3_MAINNET.usdcMint,
  ownerProgram: C3_MAINNET.tokenProgram,
  maximumAgeSeconds: 60,
  maximumConfidenceBps: 200,
  maximumChainClockSkewSeconds: 5,
});
const quote = (s = source()) => ({
  asset: s.asset,
  mint: s.mint,
  quoteCurrency: "USD",
  priceKind: "direct",
  operatorId: s.operatorId,
  feedId: s.feedId,
  account: s.account,
  ownerProgram: s.ownerProgram,
  genesisHash: C3_MAINNET.genesisHash,
  commitment: "finalized",
  contextSlot: 100,
  priceMantissa: "80000000",
  confidenceMantissa: "100",
  exponent: -8,
  publishTimeUnix: now - 1,
  receivedTimeUnix: now,
  evidenceHash: "a".repeat(64),
});
const inventory = (amount: string) => ({
  custodyBaseUnits: amount,
  accountedBaseUnits: amount,
  excludedReserveBaseUnits: "0",
});
const point = (): OpenNavMathInput => ({
  inventory: {
    USDC: inventory("1000000"),
    cbBTC: inventory("400"),
    PortalETH: inventory("10000"),
    WSOL: inventory("3000000"),
  },
  pricesUsdE12: {
    USDC: "800000000000",
    cbBTC: "100000000000000000",
    PortalETH: "3000000000000000",
    WSOL: "100000000000000",
  },
  shareSupplyBaseUnits: "1000000",
  expectedShareSupplyBaseUnits: "1000000",
  lifecycle: "active",
  settlementState: "certain",
});
const claim = () => ({
  shareSupplyBaseUnits: "1000000",
  redeemedSharesBaseUnits: "1000000",
  custodyUsdcBaseUnits: "997315",
  accountedClaimUsdcBaseUnits: "997314",
  realizedUsdcBaseUnits: "997314",
  settlementState: "certain" as const,
});

test("source policy and collector remain closed; caller JSON cannot certify NAV", async () => {
  assert.equal(PINNED_OPEN_NAV_COLLECTOR_POLICY, null);
  assert.equal(C3_MAINNET_EXECUTION_CAPABILITY, false);
  assert.deepEqual(await collectVerifiedOpenNavPoint(), {
    status: "UNAVAILABLE",
    reason: "PRODUCTION_NOT_APPROVED",
  });
  for (const forged of [
    point(),
    { verified: true },
    { status: "VERIFIED_NAV" },
    null,
  ])
    assert.deepEqual(
      evaluateVerifiedOpenNav(forged as unknown as VerifiedOpenNavPoint),
      {
        status: "UNAVAILABLE",
        reason: "POINT_NOT_VERIFIED",
      },
    );
  assert.equal(
    evaluateVerifiedOpenNav(
      decodeOpenNavDirectQuote(
        quote(),
        source(),
        context,
      ) as unknown as VerifiedOpenNavPoint,
    ).status,
    "UNAVAILABLE",
  );
});

test("direct quotes normalize integers, never assume USDC parity or certify source", () => {
  for (const asset of ["USDC", "cbBTC", "PortalETH", "WSOL"] as const) {
    const s = source(asset);
    const result = decodeOpenNavDirectQuote(quote(s), s, context);
    assert.equal(result.priceUsdE12, "800000000000");
    assert.equal(result.status, "DECODED_FIELDS_NOT_AUTHENTICATED");
    assert.equal(result.confidenceBpsCeil, "1");
    assert.ok(Object.isFrozen(result));
  }
  assert.equal(
    decodeOpenNavDirectQuote(
      {
        ...quote(),
        priceMantissa: "12345678900000",
        exponent: -13,
      },
      source(),
      context,
    ).priceUsdE12,
    "1234567890000",
  );
});

test("quote exact bindings reject client flags, wrong feed/account/program/mint/chain", () => {
  const mutations: Record<string, unknown> = {
    asset: "WSOL",
    mint: C3_MAINNET.cbBtcMint,
    operatorId: "client",
    feedId: "b".repeat(64),
    account: C3_MAINNET.cbBtcMint,
    ownerProgram: C3_MAINNET.systemProgram,
    genesisHash: "local",
    commitment: "confirmed",
    contextSlot: 99,
    quoteCurrency: "USDC",
    priceKind: "underlying",
    evidenceHash: "0".repeat(64),
    verified: true,
  };
  for (const [field, value] of Object.entries(mutations))
    assert.throws(() =>
      decodeOpenNavDirectQuote(
        { ...quote(), [field]: value },
        source(),
        context,
      ),
    );
  for (const asset of ["cbBTC", "PortalETH"] as const) {
    const s = { ...source(asset), feedId: registry[asset].oracleFeedId };
    assert.throws(
      () => decodeOpenNavDirectQuote(quote(s), s, context),
      /UNDERLYING_REFERENCE/,
    );
  }
});

test("publication checked against current host AND finalized chain time, not receipt", () => {
  assert.throws(
    () =>
      decodeOpenNavDirectQuote(
        {
          ...quote(),
          publishTimeUnix: now - 1000,
          receivedTimeUnix: now - 999,
        },
        source(),
        context,
      ),
    /PRICE_TIME/,
  );
  for (const mutation of [
    { publishTimeUnix: now + 1 },
    { receivedTimeUnix: now + 1 },
    { publishTimeUnix: now - 61 },
    { receivedTimeUnix: now - 2 },
  ])
    assert.throws(
      () =>
        decodeOpenNavDirectQuote(
          { ...quote(), ...mutation },
          source(),
          context,
        ),
      /PRICE_TIME/,
    );
  const boundary = { ...quote(), publishTimeUnix: now - 60 };
  decodeOpenNavDirectQuote(boundary, source(), context);
  assert.throws(
    () =>
      decodeOpenNavDirectQuote(boundary, source(), {
        ...context,
        evaluatedAtUnix: now + 1,
      }),
    /PRICE_TIME/,
  );
  assert.throws(
    () =>
      decodeOpenNavDirectQuote(quote(), source(), {
        ...context,
        chainTimeUnix: now - 2,
      }),
    /PRICE_TIME/,
  );
  assert.throws(
    () =>
      decodeOpenNavDirectQuote(quote(), source(), {
        ...context,
        chainTimeUnix: now - 6,
      }),
    /CHAIN_CLOCK/,
  );
});

test("NaN/unsafe clocks, malformed mantissas, excessive confidence and overflow fail", () => {
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() =>
      decodeOpenNavDirectQuote(quote(), source(), {
        ...context,
        evaluatedAtUnix: value,
      }),
    );
    assert.throws(() =>
      decodeOpenNavDirectQuote(
        quote(),
        { ...source(), maximumAgeSeconds: value },
        context,
      ),
    );
    assert.throws(() =>
      decodeOpenNavDirectQuote(
        { ...quote(), publishTimeUnix: value },
        source(),
        context,
      ),
    );
  }
  for (const value of [
    "0",
    "-1",
    "01",
    "1.2",
    "1e8",
    80000000,
    (1n << 128n).toString(),
    "1".repeat(1000),
  ])
    assert.throws(() =>
      decodeOpenNavDirectQuote(
        { ...quote(), priceMantissa: value },
        source(),
        context,
      ),
    );
  assert.throws(
    () =>
      decodeOpenNavDirectQuote(
        { ...quote(), confidenceMantissa: "1600001" },
        source(),
        context,
      ),
    /CONFIDENCE/,
  );
  decodeOpenNavDirectQuote(
    { ...quote(), confidenceMantissa: "1600000" },
    source(),
    context,
  );
  assert.throws(
    () =>
      decodeOpenNavDirectQuote(
        {
          ...quote(),
          priceMantissa: "1",
          confidenceMantissa: "0",
          exponent: -18,
        },
        source(),
        context,
      ),
    /ZERO_PRICE/,
  );
  assert.throws(
    () =>
      decodeOpenNavDirectQuote(
        {
          ...quote(),
          priceMantissa: ((1n << 128n) - 1n).toString(),
          confidenceMantissa: "0",
          exponent: 0,
        },
        source(),
        context,
      ),
    /OVERFLOW/,
  );
});

test("NAV values 1M share units at actual prices; invested target excludes cash", () => {
  const n = calculateOpenNavMath(point());
  assert.equal(n.status, "ARITHMETIC_ONLY_NOT_VERIFIED");
  assert.equal(n.netUsdE12, "1800000000000");
  assert.equal(n.sharePriceUsdE12, "1800000000000");
  assert.deepEqual(n.assetValuesUsdE12, {
    USDC: "800000000000",
    cbBTC: "400000000000",
    PortalETH: "300000000000",
    WSOL: "300000000000",
  });
  assert.deepEqual(n.investedAllocationBps, {
    cbBTC: "4000",
    PortalETH: "3000",
    WSOL: "3000",
  });
  assert.equal(OPEN_NAV_USD_SCALE, 1000000000000n);
  assert.ok(Object.isFrozen(n) && Object.isFrozen(n.assetValuesUsdE12));
});

test("donations excluded in every lifecycle; reserves deducted exactly once", () => {
  const base = point();
  const donated = { ...base, inventory: { ...base.inventory } };
  for (const asset of ["USDC", "cbBTC", "PortalETH", "WSOL"] as const)
    donated.inventory[asset] = {
      ...donated.inventory[asset],
      custodyBaseUnits: "18446744073709551615",
    };
  assert.deepEqual(calculateOpenNavMath(donated), calculateOpenNavMath(base));
  const reserved = { ...base, inventory: { ...base.inventory } };
  reserved.inventory.USDC = {
    custodyBaseUnits: "3000000",
    accountedBaseUnits: "2000000",
    excludedReserveBaseUnits: "1000000",
  };
  const r = calculateOpenNavMath(reserved);
  if (r.status === "UNAVAILABLE") assert.fail("arithmetic unavailable");
  assert.equal(r.netUsdE12, "1800000000000");
  assert.equal(r.excludedReservesUsdE12, "800000000000");
  for (const lifecycle of ["pre_issuance", "closed"] as const) {
    const empty = {
      ...base,
      lifecycle,
      shareSupplyBaseUnits: "0",
      expectedShareSupplyBaseUnits: "0",
      inventory: {
        USDC: {
          custodyBaseUnits: "2000001",
          accountedBaseUnits: "1000000",
          excludedReserveBaseUnits: "1000000",
        },
        cbBTC: { ...inventory("0"), custodyBaseUnits: "1" },
        PortalETH: { ...inventory("0"), custodyBaseUnits: "1" },
        WSOL: { ...inventory("0"), custodyBaseUnits: "1" },
      },
    };
    const n = calculateOpenNavMath(empty);
    if (n.status === "UNAVAILABLE") assert.fail("arithmetic unavailable");
    assert.equal(n.netUsdE12, "0");
    assert.equal(n.sharePriceUsdE12, null);
    assert.equal(n.investedAllocationBps, null);
  }
  assert.deepEqual(
    calculateOpenNavMath({ ...donated, lifecycle: "redeeming" }),
    calculateOpenNavMath(base),
  );
});

test("uncertain effects never return NAV or a claim amount", () => {
  assert.deepEqual(
    calculateOpenNavMath({ ...point(), settlementState: "uncertain" }),
    {
      status: "UNAVAILABLE",
      reason: "UNCERTAIN_SETTLEMENT",
    },
  );
  assert.deepEqual(
    calculateOpenFullRedemptionMath({
      ...claim(),
      settlementState: "uncertain",
    }),
    {
      status: "UNAVAILABLE",
      reason: "UNCERTAIN_SETTLEMENT",
    },
  );
});

test("reserves are excluded in token units before floor rounding, including wrapped dust", () => {
  const base = point();
  const n = calculateOpenNavMath({
    ...base,
    inventory: {
      USDC: inventory("0"),
      cbBTC: inventory("0"),
      PortalETH: inventory("0"),
      WSOL: {
        custodyBaseUnits: "99",
        accountedBaseUnits: "2",
        excludedReserveBaseUnits: "1",
      },
    },
    pricesUsdE12: { ...base.pricesUsdE12, WSOL: "1500000000" },
  });
  if (n.status === "UNAVAILABLE") assert.fail("arithmetic unavailable");
  // floor((2 - 1) * 1.5) = 1, NOT floor(2 * 1.5) - floor(1 * 1.5) = 2.
  assert.equal(n.accountedGrossUsdE12, "3");
  assert.equal(n.netUsdE12, "1");
  assert.equal(n.excludedReservesUsdE12, "2");
  assert.equal(n.sharePriceUsdE12, "1");
  assert.deepEqual(n.investedAllocationBps, {
    cbBTC: "0",
    PortalETH: "0",
    WSOL: "10000",
  });
});

test("strict arithmetic inputs reject omissions, backing/supply mismatch and float prices", () => {
  const bad: Record<string, unknown>[] = [
    { ...point(), verified: true },
    { ...point(), pricesUsdE12: { USDC: "1" } },
    { ...point(), shareSupplyBaseUnits: "999999" },
    { ...point(), expectedShareSupplyBaseUnits: "2" },
    {
      ...point(),
      shareSupplyBaseUnits: "2000000",
      expectedShareSupplyBaseUnits: "2000000",
    },
    { ...point(), lifecycle: "closed" },
    { ...point(), settlementState: "finalized" },
    { ...point(), pricesUsdE12: { ...point().pricesUsdE12, USDC: 0.8 } },
    {
      ...point(),
      inventory: {
        ...point().inventory,
        USDC: { ...inventory("1"), accountedBaseUnits: "2" },
      },
    },
    {
      ...point(),
      inventory: {
        ...point().inventory,
        USDC: { ...inventory("1"), excludedReserveBaseUnits: "2" },
      },
    },
    {
      ...point(),
      pricesUsdE12: {
        ...point().pricesUsdE12,
        cbBTC: ((1n << 128n) - 1n).toString(),
      },
    },
  ];
  for (const value of bad)
    assert.throws(() => calculateOpenNavMath(value as OpenNavMathInput));
  const getter = { ...point() };
  Object.defineProperty(getter, "pricesUsdE12", {
    get: () => point().pricesUsdE12,
  });
  assert.throws(() => calculateOpenNavMath(getter), /SHAPE/);
  assert.throws(
    () => calculateOpenNavMath({ ...point(), [Symbol("verified")]: true }),
    /SHAPE/,
  );
});

test("full redemption returns exact realized USDC, not marked USD, donations or partial payout", () => {
  assert.deepEqual(calculateOpenFullRedemptionMath(claim()), {
    status: "ARITHMETIC_ONLY_NOT_VERIFIED",
    usdcBaseUnits: "997314",
  });
  assert.deepEqual(
    calculateOpenFullRedemptionMath({
      ...claim(),
      custodyUsdcBaseUnits: "9999999999",
    }),
    calculateOpenFullRedemptionMath(claim()),
  );
  for (const mutation of [
    { redeemedSharesBaseUnits: "1" },
    { shareSupplyBaseUnits: "0" },
    { realizedUsdcBaseUnits: "997315" },
    { accountedClaimUsdcBaseUnits: "997315" },
    { custodyUsdcBaseUnits: "997313" },
    { realizedUsdcBaseUnits: "0" },
  ])
    assert.throws(() =>
      calculateOpenFullRedemptionMath({ ...claim(), ...mutation }),
    );
});
