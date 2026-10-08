/** HTTPS + hosted PostgreSQL proof protocol only. Ephemeral in-memory message
 * signer is NOT Phantom/MWA QA; creates no intent, mint, transfer or transaction. */
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { encodeBase58 } from "../services/c3-mainnet/src/solana.ts";
const origin = "https://cmarket-nine.vercel.app";
async function request(body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(origin + "/api/evaluation", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  return { status: r.status, data };
}
const key = generateKeyPairSync("ed25519");
const wallet = encodeBase58(
  key.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
);
const challenge = await request({ operation: "challenge", wallet });
assert.equal(challenge.status, 200);
assert.equal(challenge.data.cluster, "solana:devnet");
assert.ok(challenge.data.message.includes("does not transfer funds"));
const proof = {
  operation: "authenticate",
  challengeId: challenge.data.challengeId,
  message: challenge.data.message,
  signature: sign(
    null,
    Buffer.from(challenge.data.message),
    key.privateKey,
  ).toString("base64"),
};
const auth = await request(proof);
assert.equal(auth.status, 200);
assert.equal(auth.data.wallet, wallet);
assert.match(auth.data.sessionToken, /^[a-f0-9]{64}$/);
const replay = await request(proof);
assert.equal(replay.status, 401);
assert.equal(replay.data.error, "EVAL_AUTH_REPLAY");
const injected = await request(
  { operation: "position", mint: wallet },
  auth.data.sessionToken,
);
assert.equal(injected.status, 409);
assert.equal(injected.data.error, "EVAL_UNEXPECTED_CLIENT_FIELD");
const position = await request(
  { operation: "position" },
  auth.data.sessionToken,
);
assert.equal(position.status, 409);
assert.equal(position.data.error, "EVAL_OWNER_WALLET_VAULT_NOT_PROVISIONED");
console.log(
  "HOSTED_AUTH=PASS; SIGNED_MESSAGE_REPLAY=REJECTED; CLIENT_FIELD_SUBSTITUTION=REJECTED; UNPROVISIONED_WALLET=BLOCKED; PHYSICAL_MWA=NOT_TESTED; TRANSACTIONS=NONE",
);
