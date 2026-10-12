/** Display-only validation. Never an input to wallet or settlement requests. */
export function referenceView(
  position: Record<string, unknown> | null,
  now = Date.now(),
) {
  if (
    !position ||
    position.cluster !== "solana:devnet" ||
    position.simulatedAssets !== true ||
    position.monetaryValue !== false
  )
    return null;
  const r = position.marketReference as Record<string, unknown> | undefined;
  const unsigned = (v: unknown): v is string =>
    typeof v === "string" && /^(0|[1-9][0-9]{0,29})$/.test(v);
  if (
    !r ||
    r.status !== "available" ||
    r.informationalOnly !== true ||
    r.authorizesMoney !== false ||
    r.simulatedExposure !== true ||
    r.source !== "Coinbase Exchange" ||
    r.basisMethod !== "last_closed_60_second_candle_before_verified_deposit" ||
    r.pricingScale !== "100000000" ||
    !unsigned(r.valueUnits) ||
    !unsigned(r.currentPositionValueUnits) ||
    typeof r.changeUnits !== "string" ||
    !/^-?(0|[1-9][0-9]{0,29})$/.test(r.changeUnits) ||
    !unsigned(position.deposited) ||
    BigInt(position.deposited) < 1_000_000n ||
    BigInt(position.deposited) > 1_000_000_000_000n ||
    BigInt(r.valueUnits) - BigInt(position.deposited) !==
      BigInt(r.changeUnits) ||
    r.frozen !== Number(position.lifecycle) >= 3 ||
    !unsigned(position.shares) ||
    r.currentPositionValueUnits !==
      (position.shares === "0" ? "0" : r.valueUnits)
  )
    return null;
  const observedAt = Date.parse(String(r.observedAt)),
    basisTime = Date.parse(String(r.basisTime));
  if (
    !Number.isSafeInteger(observedAt) ||
    observedAt > now + 5_000 ||
    now - observedAt > 120_000 ||
    !Number.isSafeInteger(basisTime) ||
    basisTime > observedAt
  )
    return null;
  const assets = r.assets;
  if (
    !Array.isArray(assets) ||
    assets.length !== 3 ||
    !assets.every(
      (a, i) =>
        a &&
        a.product === ["BTC-USD", "ETH-USD", "SOL-USD"][i] &&
        a.weightBps === [4000, 3000, 3000][i] &&
        unsigned(a.priceUnits) &&
        BigInt(a.priceUnits) > 0n &&
        unsigned(a.basisPriceUnits) &&
        BigInt(a.basisPriceUnits) > 0n,
    )
  )
    return null;
  return {
    value: r.valueUnits as string,
    change: r.changeUnits as string,
    frozen: r.frozen as boolean,
    observedAt: r.observedAt as string,
    basisTime: r.basisTime as string,
    performance: referencePerformance(
      r.changeUnits as string,
      position.deposited,
    ),
  };
}
/** Exact display arithmetic; never authorizes a swap, valuation or redemption.
 * Percentages truncate to two decimals. Tiny nonzero changes retain their sign
 * and use a less-than label rather than falsely presenting zero performance. */
export function referencePerformance(change: string, deposited: string) {
  if (
    !/^-?(0|[1-9][0-9]{0,29})$/.test(change) ||
    !/^[1-9][0-9]{0,29}$/.test(deposited) ||
    BigInt(deposited) < 1_000_000n ||
    BigInt(deposited) > 1_000_000_000_000n ||
    BigInt(change) < -BigInt(deposited)
  )
    throw Error("EVAL_REFERENCE_PERFORMANCE_INVALID");
  const delta = BigInt(change),
    absolute = delta < 0n ? -delta : delta,
    hundredths = (absolute * 10_000n) / BigInt(deposited);
  return {
    direction: delta > 0n ? "up" : delta < 0n ? "down" : "flat",
    percent:
      (delta > 0n ? "+" : delta < 0n ? "−" : "") +
      (delta !== 0n && hundredths === 0n
        ? "<0.01"
        : (hundredths / 100n).toString() +
          "." +
          (hundredths % 100n).toString().padStart(2, "0")) +
      "%",
  } as const;
}
export function referenceDollars(units: string) {
  const value = BigInt(units),
    absolute = value < 0n ? -value : value;
  return (
    (value < 0n ? "−" : "") +
    (absolute / 1_000_000n).toString() +
    "." +
    (absolute % 1_000_000n).toString().padStart(6, "0").slice(0, 4)
  );
}
