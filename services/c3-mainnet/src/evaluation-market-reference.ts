/** Informational USD market reference ONLY. Never imported by transaction,
 * quote, share issuance, redemption or monetary authorization code. Devnet
 * inventory is simulated; this calculation cannot price a redeemable token. */
const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
const WEIGHTS = [4000n, 3000n, 3000n] as const;
const SCALE = 100_000_000n;
const MAX_AGE_MS = 120_000;
type Prices = readonly [bigint, bigint, bigint];
const check = (value: unknown, code: string): void => {
  if (!value) throw Error("EVAL_MARKET_" + code);
};
export function referencePrice(value: unknown): bigint {
  check(
    typeof value === "string" &&
      /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,8})?$/.test(value),
    "PRICE",
  );
  const [whole, fraction = ""] = (value as string).split(".");
  const price = BigInt(whole!) * SCALE + BigInt(fraction.padEnd(8, "0"));
  check(price > 0n, "PRICE");
  return price;
}
export function representativeValue(
  deposited: bigint,
  basis: Prices,
  current: Prices,
) {
  check(deposited >= 1_000_000n && deposited <= 1_000_000_000_000n, "AMOUNT");
  check(
    basis.length === 3 &&
      current.length === 3 &&
      [...basis, ...current].every((p) => p > 0n),
    "PRICE",
  );
  // Floor once per leg. Error < 3 millionths of an illustrative dollar. No
  // float money math, no assumed token parity, no live rebalancing.
  const legs = basis.map(
    (p, i) => (deposited * WEIGHTS[i]! * current[i]!) / (10_000n * p),
  );
  const value = legs.reduce((a, b) => a + b, 0n);
  return {
    valueUnits: value.toString(),
    changeUnits: (value - deposited).toString(),
    legs: legs.map(String),
  };
}
export function checkedObservation(time: unknown, now: number) {
  check(typeof time === "string", "TIME");
  const timestamp = Date.parse(time as string);
  check(
    Number.isSafeInteger(timestamp) &&
      timestamp <= now + 5_000 &&
      now - timestamp <= MAX_AGE_MS,
    "STALE",
  );
  return timestamp;
}
async function data(path: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(
    "https://api.exchange.coinbase.com/products/" + path,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    },
  );
  check(response.ok, "HTTP_" + response.status);
  const text = await response.text();
  check(text.length <= 100_000, "RESPONSE_SIZE");
  return JSON.parse(text) as unknown;
}
export function historicalClose(rows: unknown, cutoffSeconds: number) {
  check(Array.isArray(rows) && rows.length <= 300, "CANDLES");
  const candidates = (rows as unknown[]).filter(
    (row): row is number[] =>
      Array.isArray(row) &&
      row.length === 6 &&
      row.every((v) => typeof v === "number" && Number.isFinite(v)) &&
      Number.isSafeInteger(row[0]) &&
      row[0] % 60 === 0 &&
      row[0] + 60 <= cutoffSeconds &&
      cutoffSeconds - (row[0] + 60) <= 180,
  );
  candidates.sort((a, b) => b[0]! - a[0]!);
  const row = candidates[0];
  check(
    row &&
      row[1]! > 0 &&
      row[2]! >= row[1]! &&
      row[4]! >= row[1]! &&
      row[4]! <= row[2]! &&
      row[5]! > 0,
    "HISTORICAL_PRICE_UNAVAILABLE",
  );
  return {
    price: referencePrice(String(row![4])),
    publishedAt: new Date((row![0]! + 60) * 1000).toISOString(),
  };
}
export async function marketReference(
  input: {
    deposited: bigint;
    sharesIssued: bigint;
    shares: bigint;
    depositTime: number | null;
    saleTime: number | null;
    lifecycle: number;
  },
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const unavailable = {
    status: "unavailable",
    informationalOnly: true,
    authorizesMoney: false,
    source: "Coinbase Exchange",
    simulatedExposure: true,
  } as const;
  if (!input.depositTime || input.deposited === 0n || input.sharesIssued === 0n)
    return unavailable;
  try {
    check(
      Number.isSafeInteger(input.depositTime) &&
        input.depositTime * 1000 <= now,
      "DEPOSIT_TIME",
    );
    const historical = async (time: number) => {
      check(
        Number.isSafeInteger(time) &&
          time >= input.depositTime! &&
          time * 1000 <= now,
        "HISTORICAL_TIME",
      );
      const start = new Date((time - 240) * 1000).toISOString();
      const end = new Date(time * 1000).toISOString();
      return Promise.all(
        PRODUCTS.map(async (product) =>
          historicalClose(
            await data(
              product +
                "/candles?granularity=60&start=" +
                encodeURIComponent(start) +
                "&end=" +
                encodeURIComponent(end),
              fetcher,
            ),
            time,
          ),
        ),
      );
    };
    const basis = await historical(input.depositTime);
    const frozen = input.lifecycle >= 3;
    check(!frozen || input.saleTime !== null, "SALE_TIME");
    const current = frozen
      ? await historical(input.saleTime!)
      : await Promise.all(
          PRODUCTS.map(async (product) => {
            const ticker = (await data(product + "/ticker", fetcher)) as Record<
              string,
              unknown
            >;
            const publishedAt = new Date(
              checkedObservation(ticker.time, now),
            ).toISOString();
            return { price: referencePrice(ticker.price), publishedAt };
          }),
        );
    const values = representativeValue(
      input.deposited,
      basis.map((v) => v.price) as unknown as Prices,
      current.map((v) => v.price) as unknown as Prices,
    );
    return {
      ...unavailable,
      ...values,
      status: "available",
      frozen,
      observedAt: new Date(now).toISOString(),
      basisTime: new Date(input.depositTime * 1000).toISOString(),
      saleTime: frozen ? new Date(input.saleTime! * 1000).toISOString() : null,
      currentPositionValueUnits: input.shares === 0n ? "0" : values.valueUnits,
      assets: PRODUCTS.map((product, i) => ({
        product,
        weightBps: Number(WEIGHTS[i]),
        basisPriceUnits: basis[i]!.price.toString(),
        basisPublishedAt: basis[i]!.publishedAt,
        priceUnits: current[i]!.price.toString(),
        publishedAt: current[i]!.publishedAt,
      })),
      basisMethod: "last_closed_60_second_candle_before_verified_deposit",
      pricingScale: SCALE.toString(),
    };
  } catch {
    // Pricing failure does NOT block recovery/claim or manufacture a balance.
    return unavailable;
  }
}
