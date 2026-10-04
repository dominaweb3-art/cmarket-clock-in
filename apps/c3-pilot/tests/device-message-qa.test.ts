import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  createDeviceQaReview,
  consumeDeviceQaReview,
  verifyDeviceQaReply,
  assertDeviceQaFresh,
  DEVICE_QA_CHAIN,
} from "../src/device-message-qa.ts";
// Isolated cryptographic tests. No MWA callback or physical signature evidence.
const testKey = new Uint8Array(32).fill(7),
  pub = ed25519.getPublicKey(testKey);
test("QA domain / Devnet / immutable bytes / exact Ed25519; never owner authentication", () => {
  assert.equal(DEVICE_QA_CHAIN, "solana:devnet");
  const review = createDeviceQaReview(pub),
    expected = consumeDeviceQaReview(review);
  assert.ok(Object.isFrozen(review));
  assert.match(review.text, /DEVICE QA ONLY/);
  assert.doesNotMatch(review.text, /^C Market owner session v1/m);
  const reply = new Uint8Array([
    ...expected.bytes,
    ...ed25519.sign(expected.bytes, testKey),
  ]);
  assert.equal(
    verifyDeviceQaReply(expected, reply).status,
    "VERIFIED_NON_ECONOMIC_MESSAGE",
  );
  for (const offset of [0, expected.bytes.length, reply.length - 1]) {
    const bad = reply.slice();
    bad[offset] = bad[offset]! ^ 1;
    assert.throws(() => verifyDeviceQaReply(expected, bad));
  }
  assert.throws(() => verifyDeviceQaReply(expected, reply.subarray(1)));
  assert.throws(() => consumeDeviceQaReview(review));
  assert.throws(() => consumeDeviceQaReview({ ...review }));
});
test("expiry / clock regression reject before any wallet and after its return", () => {
  mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  try {
    const review = createDeviceQaReview(pub),
      expected = consumeDeviceQaReview(review);
    const reply = new Uint8Array([
      ...expected.bytes,
      ...ed25519.sign(expected.bytes, testKey),
    ]);
    const unused = createDeviceQaReview(pub);
    mock.timers.tick(120000);
    assert.throws(() => consumeDeviceQaReview(unused));
    assert.throws(() => verifyDeviceQaReply(expected, reply));
    const future = createDeviceQaReview(pub);
    mock.timers.setTime(1800000000000);
    assert.throws(() => consumeDeviceQaReview(future));
  } finally {
    mock.timers.reset();
  }
});
test("QA wallet path has no server/storage/transaction or monetary callback", () => {
  const source = readFileSync(
    new URL("../src/device-message-qa-wallet.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /chain: DEVICE_QA_CHAIN/);
  assert.match(source, /wallet\.signMessages/);
  assert.ok(
    source.indexOf("assertDeviceQaFresh(expected)") <
      source.indexOf("await wallet.signMessages("),
  );
  assert.doesNotMatch(
    source,
    /wallet\.(?:signTransactions|signAndSend|send)|fetch\(|AsyncStorage|owner-session|requestCandidateMonetarySignature/,
  );
  assert.ok(
    source.indexOf("consumeDeviceQaReview(review)") <
      source.indexOf("return transact("),
  );
});
test("wall-clock rollback inside window / monotonic expiry / forged context fail closed", () => {
  mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  let mono = 100;
  const timer = mock.method(performance, "now", () => mono);
  try {
    const expected = consumeDeviceQaReview(createDeviceQaReview(pub));
    assert.throws(() => assertDeviceQaFresh({ ...expected }));
    mono += 1000;
    mock.timers.tick(1000);
    assertDeviceQaFresh(expected);
    mock.timers.setTime(1800000000500);
    assert.throws(() => assertDeviceQaFresh(expected));
    mock.timers.setTime(1800000001000);
    const other = consumeDeviceQaReview(createDeviceQaReview(pub));
    mono += 120000;
    assert.throws(() => assertDeviceQaFresh(other));
  } finally {
    timer.mock.restore();
    mock.timers.reset();
  }
});
