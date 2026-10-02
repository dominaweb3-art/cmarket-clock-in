/** Public clone snapshot validation, not an instruction or liquidity generator.
 * Official Orca state/{fixed_tick_array,dynamic_tick_array}.rs layouts.
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
export function verifyWhirlpoolTick(
  data: Buffer,
  pool: PublicKey,
  start: number,
): void {
  const reject = () => {
    throw Error("C3_BANK_TICK_ARRAY");
  };
  if (data.length < 12 || data.readInt32LE(8) !== start) reject();
  const fixed = Buffer.from("4561bdbe6e0742bb", "hex");
  const dynamic = createHash("sha256")
    .update("account:DynamicTickArray")
    .digest()
    .subarray(0, 8);
  if (data.subarray(0, 8).equals(fixed)) {
    if (
      data.length !== 9988 ||
      !new PublicKey(data.subarray(9956)).equals(pool)
    )
      reject();
    for (let n = 0; n < 88; n++) if (data[12 + n * 113]! > 1) reject();
    return;
  }
  if (
    !data.subarray(0, 8).equals(dynamic) ||
    data.length < 148 ||
    data.length > 10004 ||
    !new PublicKey(data.subarray(12, 44)).equals(pool)
  )
    reject();
  const bitmap = data.readBigUInt64LE(44) | (data.readBigUInt64LE(52) << 64n);
  if (bitmap >> 88n) reject();
  let offset = 60;
  for (let n = 0; n < 88; n++) {
    const initialized = Number((bitmap >> BigInt(n)) & 1n);
    if (data[offset] !== initialized) reject();
    offset += initialized ? 113 : 1;
    if (offset > data.length) reject();
  }
  if (offset !== data.length) reject();
}
