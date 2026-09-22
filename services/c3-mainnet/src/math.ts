import { C3_ALLOCATION, C3_AMOUNTS } from "./constants.ts";

const U128_MAX = (1n << 128n) - 1n;

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

export function checkedAddU64(
  left: bigint,
  right: bigint,
  label: string,
): bigint {
  assertU64(left, `${label} left operand`);
  assertU64(right, `${label} right operand`);
  return assertU64(left + right, label);
}

export function checkedSubU64(
  left: bigint,
  right: bigint,
  label: string,
): bigint {
  assertU64(left, `${label} left operand`);
  assertU64(right, `${label} right operand`);
  if (right > left) throw new RangeError(`${label} would underflow u64.`);
  return left - right;
}

export function checkedMulU64(
  left: bigint,
  right: bigint,
  label: string,
): bigint {
  assertU64(left, `${label} left operand`);
  assertU64(right, `${label} right operand`);
  return assertU64(left * right, label);
}

export function checkedMulDivFloorU64(
  value: bigint,
  multiplier: bigint,
  divisor: bigint,
  label: string,
): bigint {
  assertU64(divisor, `${label} divisor`);
  if (divisor === 0n)
    throw new RangeError(`${label} divisor must be positive.`);
  assertU64(value, `${label} value`);
  assertU64(multiplier, `${label} multiplier`);
  const product = value * multiplier;
  if (product > U128_MAX)
    throw new RangeError(`${label} intermediate product exceeds u128.`);
  return assertU64(product / divisor, label);
}

export function mulDivFloor(
  value: bigint,
  multiplier: bigint,
  divisor: bigint,
): bigint {
  return checkedMulDivFloorU64(value, multiplier, divisor, "bounded ratio");
}

export function mulDivCeil(
  value: bigint,
  multiplier: bigint,
  divisor: bigint,
): bigint {
  assertU64(value, "bounded ceiling value");
  assertU64(multiplier, "bounded ceiling multiplier");
  assertU64(divisor, "bounded ceiling divisor");
  if (divisor === 0n) throw new RangeError("Bounded ceiling divisor is zero.");
  const product = value * multiplier;
  if (product > U128_MAX)
    throw new RangeError("Bounded ceiling intermediate exceeds u128.");
  return assertU64(
    product / divisor + (product % divisor === 0n ? 0n : 1n),
    "bounded ceiling result",
  );
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
