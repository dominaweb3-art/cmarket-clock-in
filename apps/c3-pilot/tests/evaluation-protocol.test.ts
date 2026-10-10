import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  base64FromUint8Array,
  base64ToBase58,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import {
  EVALUATION_ENDPOINT,
  EVALUATION_CHAIN,
  inspectEvaluationChallenge,
  inspectEvaluationSignedMessage,
} from "../src/evaluation-protocol.ts";
const secret = new Uint8Array(32).fill(7); // fixture only, never a live wallet
const wallet = base64ToBase58(
  base64FromUint8Array(ed25519.getPublicKey(secret)),
);
const now = 1_800_000_000_000;
const id = "11111111-1111-4111-8111-111111111111";
const expires = new Date(now + 119000).toISOString();
const challenge = {
  challengeId: id,
  wallet,
  cluster: EVALUATION_CHAIN,
  expiresAt: expires,
  message: `C Market Devnet evaluation wallet proof v1\nAudience: ${EVALUATION_ENDPOINT}\nNetwork: ${EVALUATION_CHAIN}\nTokens have no monetary value. This message does not transfer funds.\nWallet: ${wallet}\nChallenge: ${id}\nNonce: ${"a".repeat(64)}\nExpires: ${expires}`,
};
test("exact Devnet authentication message and signature; no wallet callback", () => {
  const message = inspectEvaluationChallenge(challenge, wallet, now);
  const signature = ed25519.sign(message, secret);
  assert.deepEqual(
    inspectEvaluationSignedMessage(
      wallet,
      message,
      base64FromUint8Array(signature),
    ),
    signature,
  );
  assert.throws(() =>
    inspectEvaluationSignedMessage(
      wallet,
      new TextEncoder().encode("changed challenge"),
      base64FromUint8Array(signature),
    ),
  );
  assert.throws(() =>
    inspectEvaluationSignedMessage(
      wallet,
      message,
      base64FromUint8Array(ed25519.sign(message, new Uint8Array(32).fill(8))),
    ),
  );
  for (const length of [0, 63, 65, message.length + 63, message.length + 65]) {
    assert.throws(() =>
      inspectEvaluationSignedMessage(
        wallet,
        message,
        base64FromUint8Array(new Uint8Array(length)),
      ),
    );
  }
  const payload = new Uint8Array(message.length + 64);
  payload.set(message);
  payload.set(signature, message.length);
  assert.deepEqual(
    inspectEvaluationSignedMessage(
      wallet,
      message,
      base64FromUint8Array(payload),
    ),
    signature,
  );
  const changed = payload.slice();
  changed[0]! ^= 1;
  assert.throws(() =>
    inspectEvaluationSignedMessage(
      wallet,
      message,
      base64FromUint8Array(changed),
    ),
  );
  payload[message.length]! ^= 1;
  assert.throws(() =>
    inspectEvaluationSignedMessage(
      wallet,
      message,
      base64FromUint8Array(payload),
    ),
  );
});
test("reject wrong chain, audience, wallet, appended transfer text and expired challenge", () => {
  for (const changed of [
    { ...challenge, cluster: "solana:mainnet" },
    {
      ...challenge,
      message: challenge.message.replace(
        EVALUATION_ENDPOINT,
        "https://example.com",
      ),
    },
    { ...challenge, wallet: "wrong" },
    { ...challenge, message: challenge.message + "\nAuthorize a transfer" },
    { ...challenge, expiresAt: new Date(now - 1).toISOString() },
  ])
    assert.throws(() => inspectEvaluationChallenge(changed, wallet, now));
  assert.throws(() =>
    inspectEvaluationChallenge(challenge, wallet, now + 119000),
  );
  assert.throws(() =>
    inspectEvaluationSignedMessage(wallet, new Uint8Array([1]), "AA=="),
  );
});
