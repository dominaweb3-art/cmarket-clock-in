import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import {
  deriveQuoteMinimum,
  encodeQuoteSealV1,
  quoteIdForNonce,
  type QuoteSealV1,
} from "../src/quote-seal.ts";

function validSeal(): QuoteSealV1 {
  const nonce = randomBytes(32);
  return {
    contextHash: randomBytes(32),
    quoteId: quoteIdForNonce(nonce),
    nonce,
    inputAmount: 1_000_000n,
    quotedOutput: 40_000n,
    slippageBps: 100,
    minimumOutput: 39_600n,
    routeHash: randomBytes(32),
    instructionHash: randomBytes(32),
    accountMetasHash: randomBytes(32),
    altCount: 0,
    altContentsHash: new Uint8Array(32),
    builderTimestamp: 1_000n,
    builderSlot: 100n,
    expiresAt: 1_030n,
    expiresSlot: 200n,
  };
}

test("canonical quote serialization is fixed-length and deterministic", () => {
  const seal = validSeal();
  const first = encodeQuoteSealV1(seal);
  assert.equal(first.length, 300);
  assert.deepEqual(encodeQuoteSealV1(seal), first);
  assert.equal(first.toString("ascii", 0, 16), "C3QUOTESEAL-V1!!");
  assert.deepEqual(first.subarray(49, 81), seal.quoteId);
  assert.deepEqual(first.subarray(81, 113), seal.nonce);
});

test("minimum output uses checked integer floor, never caller value", () => {
  assert.equal(deriveQuoteMinimum(101n, 100), 99n);
  assert.equal(
    deriveQuoteMinimum((1n << 64n) - 1n, 100),
    (((1n << 64n) - 1n) * 9_900n) / 10_000n,
  );
  for (const value of [0n, -1n, 1n << 64n]) {
    assert.throws(() => deriveQuoteMinimum(value, 100));
  }
  for (const slippage of [-1, 0, 101, 10_001, Number.NaN]) {
    assert.throws(() => deriveQuoteMinimum(101n, slippage));
  }
  assert.throws(() => encodeQuoteSealV1({ ...validSeal(), minimumOutput: 1n }));
  assert.equal(deriveQuoteMinimum(478n, 100, 474n), 474n);
  assert.equal(deriveQuoteMinimum(478n, 100, 1n), 473n);
  assert.equal(deriveQuoteMinimum(478n, 100, 474n, 475n), 475n);
  assert.equal(deriveQuoteMinimum(478n, 100, 474n, 470n), 474n);
  assert.equal(deriveQuoteMinimum(478n, 100, 474n, 478n), 478n);
  for (const committed of [0n, -1n, 479n, 1n << 64n])
    assert.throws(
      () => deriveQuoteMinimum(478n, 100, 474n, committed),
      /COMMITTED_MINIMUM/,
    );
  assert.throws(() => deriveQuoteMinimum(478n, 100, 479n));
  const stronger = { ...validSeal(), quotedOutput: 478n, minimumOutput: 474n };
  assert.equal(encodeQuoteSealV1(stronger).length, 300);
  assert.throws(() => encodeQuoteSealV1({ ...stronger, minimumOutput: 472n }));
  assert.throws(() => encodeQuoteSealV1({ ...stronger, minimumOutput: 479n }));
});

test("malformed context, nonce, ALT and expiry fail closed", () => {
  const seal = validSeal();
  assert.throws(() =>
    encodeQuoteSealV1({ ...seal, contextHash: randomBytes(31) }),
  );
  assert.throws(() => encodeQuoteSealV1({ ...seal, nonce: randomBytes(32) }));
  assert.throws(() => encodeQuoteSealV1({ ...seal, altCount: 1 }));
  assert.throws(() =>
    encodeQuoteSealV1({ ...seal, altContentsHash: randomBytes(32) }),
  );
  assert.throws(() => encodeQuoteSealV1({ ...seal, expiresAt: 999n }));
  assert.throws(() => encodeQuoteSealV1({ ...seal, expiresSlot: 100n }));
  assert.throws(() => encodeQuoteSealV1({ ...seal, inputAmount: 1n << 64n }));
});
