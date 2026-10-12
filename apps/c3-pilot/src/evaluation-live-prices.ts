/** Market display only. Never accepted by a wallet/settlement controller. */
export type LivePrices = {
  source: "Coinbase Exchange";
  informationalOnly: true;
  authorizesMoney: false;
  pricingScale: "100000000";
  observedAt: string;
  dayBasis: "exchange_reported_24h_open";
  assets: {
    product: string;
    priceUnits: string;
    open24hUnits: string;
    publishedAt: string;
  }[];
};
export function checkedLivePrices(
  value: unknown,
  now = Date.now(),
): LivePrices {
  const r = value as LivePrices;
  const positive = (n: unknown) =>
    typeof n === "string" && /^[1-9][0-9]{0,19}$/.test(n);
  const fresh = (s: unknown) =>
    typeof s === "string" &&
    Number.isFinite(Date.parse(s)) &&
    Date.parse(s) <= now + 5000 &&
    now - Date.parse(s) <= 120000;
  if (
    !r ||
    r.source !== "Coinbase Exchange" ||
    r.informationalOnly !== true ||
    r.authorizesMoney !== false ||
    r.pricingScale !== "100000000" ||
    r.dayBasis !== "exchange_reported_24h_open" ||
    !fresh(r.observedAt) ||
    !Array.isArray(r.assets) ||
    r.assets.length !== 3 ||
    !r.assets.every(
      (a, i) =>
        a &&
        a.product === ["BTC-USD", "ETH-USD", "SOL-USD"][i] &&
        positive(a.priceUnits) &&
        positive(a.open24hUnits) &&
        fresh(a.publishedAt),
    )
  )
    throw Error("EVAL_MARKET_UNAVAILABLE");
  return r;
}
export function liveReferencePosition(
  p: Record<string, unknown> | null,
  live: LivePrices | null,
) {
  const r = p?.marketReference as Record<string, unknown> | undefined;
  if (
    !p ||
    !live ||
    Number(p.lifecycle) !== 2 ||
    r?.status !== "available" ||
    !Array.isArray(r.assets)
  )
    return p;
  if (
    typeof p.deposited !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(p.deposited)
  )
    return p;
  const bases = r.assets as { product: string; basisPriceUnits: string }[];
  if (
    bases.length !== 3 ||
    !bases.every(
      (a, i) =>
        a &&
        a.product === live.assets[i]!.product &&
        /^[1-9][0-9]{0,19}$/.test(a.basisPriceUnits),
    )
  )
    return p;
  const amount = BigInt(p.deposited);
  const value = bases.reduce(
    (sum, a, i) =>
      sum +
      (amount *
        [4000n, 3000n, 3000n][i]! *
        BigInt(live.assets[i]!.priceUnits)) /
        (10000n * BigInt(a.basisPriceUnits)),
    0n,
  );
  return {
    ...p,
    marketReference: {
      ...r,
      observedAt: live.observedAt,
      valueUnits: value.toString(),
      changeUnits: (value - amount).toString(),
      currentPositionValueUnits: p.shares === "0" ? "0" : value.toString(),
      assets: r.assets.map((a, i) => ({
        ...a,
        priceUnits: live.assets[i]!.priceUnits,
        publishedAt: live.assets[i]!.publishedAt,
      })),
    },
  };
}
export function priceChange24h(price: string, open: string) {
  const delta = BigInt(price) - BigInt(open),
    scaled = (delta * 10000n) / BigInt(open);
  return {
    direction: delta > 0n ? "up" : delta < 0n ? "down" : "flat",
    percent: `${delta > 0n ? "+" : delta < 0n ? "−" : ""}${(scaled < 0n ? -scaled : scaled) / 100n}.${((scaled < 0n ? -scaled : scaled) % 100n).toString().padStart(2, "0")}%`,
  };
}
