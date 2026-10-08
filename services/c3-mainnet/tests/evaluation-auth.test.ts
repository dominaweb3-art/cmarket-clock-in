import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  evaluationProofMessage,
  verifyEvaluationProof,
} from "../src/evaluation-auth.ts";
test("wallet proof identifies Devnet and cannot authorize a different owner/message", () => {
  const pair = generateKeyPairSync("ed25519"),
    raw = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    wallet = new PublicKey(raw).toBase58();
  const message = evaluationProofMessage(
    wallet,
    "12345678-1234-1234-1234-123456789abc",
    "a".repeat(64),
    new Date("2026-10-05T15:00:00Z"),
  );
  assert.match(message.toString(), /Network: solana:devnet/);
  assert.match(message.toString(), /does not transfer funds/);
  const signature = sign(null, message, pair.privateKey);
  assert.doesNotThrow(() => verifyEvaluationProof(wallet, message, signature));
  assert.throws(
    () =>
      verifyEvaluationProof(
        wallet,
        Buffer.concat([message, Buffer.from("tampered")]),
        signature,
      ),
    /SIGNATURE/,
  );
  assert.throws(
    () => verifyEvaluationProof(wallet, message, signature.subarray(1)),
    /SHAPE/,
  );
  const other = generateKeyPairSync("ed25519");
  assert.throws(
    () =>
      verifyEvaluationProof(
        new PublicKey(
          other.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
        ).toBase58(),
        message,
        signature,
      ),
    /SIGNATURE/,
  );
  // No callback, wallet SDK, RPC, monetary transaction or funded key participates.
});
