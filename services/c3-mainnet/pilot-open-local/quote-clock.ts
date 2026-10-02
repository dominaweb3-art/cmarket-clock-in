/** Official build metadata may be slightly ahead of the server clock. Wait
 * boundedly; never rewrite creation time, extend expiry or sign a future seal.
 * No RPC, wallet, signing or submission. Clock regressions are bounded by the
 * monotonic deadline; reaching the timestamp never renews a stale quote.
 */
export async function awaitQuoteClock(
  timestampMs: number,
  maximumAgeMs: number,
): Promise<void> {
  if (
    !Number.isSafeInteger(timestampMs) ||
    timestampMs <= 0 ||
    !Number.isInteger(maximumAgeMs) ||
    maximumAgeMs < 1 ||
    maximumAgeMs > 30000
  )
    throw Error("C3_QUOTE_CLOCK_INVALID");
  const started = performance.now();
  const future = timestampMs - Date.now();
  if (future > 5000 || -future >= maximumAgeMs)
    throw Error("C3_QUOTE_CLOCK_UNUSABLE");
  while (Date.now() < timestampMs) {
    if (performance.now() - started >= 5100)
      throw Error("C3_QUOTE_CLOCK_UNUSABLE");
    await new Promise((r) =>
      setTimeout(r, Math.min(100, Math.max(1, timestampMs - Date.now()))),
    );
  }
  if (
    performance.now() - started >= 5100 ||
    Date.now() - timestampMs >= maximumAgeMs
  )
    throw Error("C3_QUOTE_CLOCK_UNUSABLE");
}
