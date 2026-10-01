import assert from "node:assert/strict";
import { test } from "node:test";
import { C3_MAINNET } from "../src/constants.ts";
import { quoteAltContentsHash } from "../src/quote-alt.ts";
import { publicKeyBytes } from "../src/solana.ts";
function table() {
  const data = Buffer.alloc(88);
  data.writeUInt32LE(1);
  data.writeBigUInt64LE((1n << 64n) - 1n, 4);
  data.writeBigUInt64LE(10n, 12);
  Buffer.from(publicKeyBytes(C3_MAINNET.usdcMint)).copy(data, 56);
  return {
    address: C3_MAINNET.cbBtcMint,
    owner: C3_MAINNET.addressLookupTableProgram,
    data,
  };
}
test("ALT seal commits key, owner, raw authority and every resolved address in order", () => {
  const original = table();
  const hash = quoteAltContentsHash([original], 11n);
  assert.equal(hash.length, 32);
  assert.deepEqual(quoteAltContentsHash([], 11n), Buffer.alloc(32));
  assert.notDeepEqual(
    hash,
    quoteAltContentsHash(
      [{ ...original, address: C3_MAINNET.portalEthMint }],
      11n,
    ),
  );
  const changed = table();
  changed.data[87] = changed.data[87]! ^ 1;
  assert.notDeepEqual(hash, quoteAltContentsHash([changed], 11n));
  const authority = table();
  authority.data[21] = 1;
  Buffer.from(publicKeyBytes(C3_MAINNET.usdcMint)).copy(authority.data, 22);
  assert.notDeepEqual(hash, quoteAltContentsHash([authority], 11n));
  assert.throws(() => quoteAltContentsHash([original, original], 11n));
  assert.throws(() =>
    quoteAltContentsHash(
      [{ ...original, owner: C3_MAINNET.tokenProgram }],
      11n,
    ),
  );
  assert.throws(() => quoteAltContentsHash([original], 10n));
  for (const size of [0, 55, 57, 89, 9000])
    assert.throws(() =>
      quoteAltContentsHash([{ ...original, data: Buffer.alloc(size) }], 11n),
    );
  const inactive = table();
  inactive.data.writeBigUInt64LE(12n, 4);
  assert.throws(() => quoteAltContentsHash([inactive], 11n));
});
