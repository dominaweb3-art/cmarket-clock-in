import { C3_ALLOCATION, C3_AMOUNTS } from "./constants.ts";

export function parseDecimalToBaseUnits(
  value: string,
  decimals: number,
): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new TypeError("Amount must be a canonical positive decimal string.");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new RangeError("Unsupported decimals.");
  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new RangeError("Amount has excessive decimal precision.");
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
  assertU64(result, "amount");
  return result;
}

export function assertU64(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > C3_AMOUNTS.u64Max) {
    throw new RangeError(`${label} is outside the unsigned 64-bit range.`);
  }
  return value;
}

export function mulDivFloor(
  value: bigint,
  multiplier: bigint,
  divisor: bigint,
): bigint {
  if (value < 0n || multiplier < 0n || divisor <= 0n)
    throw new RangeError("Invalid unsigned ratio.");
  return (value * multiplier) / divisor;
}

export function mulDivCeil(
  value: bigint,
  multiplier: bigint,
  divisor: bigint,
): bigint {
  if (value < 0n || multiplier < 0n || divisor <= 0n)
    throw new RangeError("Invalid unsigned ratio.");
  return (value * multiplier + divisor - 1n) / divisor;
}

export function allocateTargetByBps(
  totalBaseUnits: bigint,
): Readonly<{ btc: bigint; eth: bigint; sol: bigint }> {
  assertU64(totalBaseUnits, "allocation total");
  const btc = mulDivFloor(
    totalBaseUnits,
    BigInt(C3_ALLOCATION.btcBps),
    BigInt(C3_ALLOCATION.totalBps),
  );
  const eth = mulDivFloor(
    totalBaseUnits,
    BigInt(C3_ALLOCATION.ethBps),
    BigInt(C3_ALLOCATION.totalBps),
  );
  return Object.freeze({ btc, eth, sol: totalBaseUnits - btc - eth });
}

export function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
