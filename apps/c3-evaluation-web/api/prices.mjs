/** Public display-only market data. Never reads wallet, DB or signer credentials. */
const products = ["BTC-USD", "ETH-USD", "SOL-USD"];
let cached, pending;
function units(value) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,8})?$/.test(value)
  )
    throw Error("PRICE");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (result <= 0n) throw Error("PRICE");
  return result.toString();
}
export async function collectPrices(fetcher = fetch, clock = Date.now) {
  const observedAt = clock();
  const assets = await Promise.all(
    products.map(async (product) => {
      const read = async (kind) => {
        const response = await fetcher(
          `https://api.exchange.coinbase.com/products/${product}/${kind}`,
          {
            headers: { Accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(4500),
          },
        );
        if (!response.ok) throw Error("MARKET_UNAVAILABLE");
        const text = await response.text();
        if (text.length > 10000) throw Error("SHAPE");
        return JSON.parse(text);
      };
      const [ticker, stats] = await Promise.all([
        read("ticker"),
        read("stats"),
      ]);
      const published = Date.parse(ticker.time);
      if (
        !Number.isSafeInteger(published) ||
        published > observedAt + 5000 ||
        observedAt - published > 120000
      )
        throw Error("STALE");
      return {
        product,
        priceUnits: units(ticker.price),
        open24hUnits: units(stats.open),
        publishedAt: new Date(published).toISOString(),
      };
    }),
  );
  return {
    source: "Coinbase Exchange",
    informationalOnly: true,
    authorizesMoney: false,
    pricingScale: "100000000",
    observedAt: new Date(observedAt).toISOString(),
    dayBasis: "exchange_reported_24h_open",
    assets,
  };
}
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  try {
    if (!cached || Date.now() - Date.parse(cached.observedAt) >= 5000) {
      pending ??= collectPrices()
        .then((value) => {
          cached = value;
          return value;
        })
        .finally(() => {
          pending = undefined;
        });
      await pending;
    }
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=5, must-revalidate",
    );
    return res.status(200).json(cached);
  } catch {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "MARKET_UNAVAILABLE" });
  }
}
