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
  };
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
