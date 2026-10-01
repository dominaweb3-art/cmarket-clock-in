/** Canonical public ALT evidence shared with the vault. Never authorizes a quote. */
import { createHash } from "node:crypto";
import { publicKeyBytes } from "./solana.ts";
import { C3_MAINNET } from "./constants.ts";

export type QuoteAltAccount = Readonly<{
  address: string;
  owner: string;
  data: Uint8Array;
}>;
export function quoteAltContentsHash(
  accounts: readonly QuoteAltAccount[],
  slot: bigint,
): Buffer {
  if (accounts.length > 4 || slot <= 0n)
    throw new Error("C3_QUOTE_ALT_INVALID");
  if (!accounts.length) return Buffer.alloc(32);
  const seen = new Set<string>();
  const hash = createHash("sha256")
    .update("c3-alt-resolved-v1")
    .update(Buffer.from([accounts.length]));
  for (const account of accounts) {
    const data = Buffer.from(account.data);
    const size = data.length;
    if (
      seen.has(account.address) ||
      account.owner !== C3_MAINNET.addressLookupTableProgram ||
      size < 56 ||
      size > 56 + 256 * 32 ||
      (size - 56) % 32 !== 0 ||
      data.readUInt32LE(0) !== 1 ||
      data.readBigUInt64LE(4) !== (1n << 64n) - 1n ||
      data.readBigUInt64LE(12) >= slot ||
      data[20]! > (size - 56) / 32 ||
      (data[21] !== 0 && data[21] !== 1)
    )
      throw new Error("C3_QUOTE_ALT_INVALID");
    seen.add(account.address);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(size);
    hash
      .update(publicKeyBytes(account.address))
      .update(publicKeyBytes(account.owner))
      .update(length)
      .update(data);
  }
  return hash.digest();
}
