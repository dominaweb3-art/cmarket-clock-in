import { test } from "node:test";
import assert from "node:assert/strict";
import { createOwnerSession } from "../src/owner-session.ts";
const origin = "https://cmarket.example.org",
  wallet = "3".repeat(44),
  intent = "11111111-1111-4111-8111-111111111111",
  challenge = "22222222-2222-4222-8222-222222222222";
test("owner auth validates scope before wallet; session never persisted/refreshed by recovery", async () => {
  let now = 1000000,
    signs = 0,
    mode = "",
    authReads = 0;
  const fetcher = (async (input: unknown, init: RequestInit) => {
    if (String(input).endsWith("/challenge"))
      return new Response(
        JSON.stringify({
          challengeId: challenge,
          message: `C Market owner session v1\nAudience: ${mode === "audience" ? "https://evil.example.org" : origin}\nWallet: ${mode === "wallet" ? "4".repeat(44) : wallet}\nIntent: ${intent}\nChallenge: ${challenge}\nNonce: ${"a".repeat(64)}\nExpires: ${new Date(now + (mode === "expired" ? -1 : 120000)).toISOString()}`,
        }),
      );
    if (String(input).endsWith("/session"))
      return new Response(JSON.stringify({ token: "b".repeat(64) }));
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer " + "b".repeat(64),
    );
    authReads++;
    return new Response("{}");
  }) as typeof fetch;
  const session = createOwnerSession(
    origin,
    wallet,
    intent,
    async () => {
      signs++;
      return new Uint8Array(64);
    },
    (b) => Buffer.from(b).toString("base64"),
    () => now,
    fetcher,
  );
  assert.throws(() => session.fetch(origin + "/status"), /REAUTH_REQUIRED/);
  for (mode of ["audience", "wallet", "expired"])
    await assert.rejects(() => session.authenticate(), /CHALLENGE|EXPIRY/);
  assert.equal(signs, 0);
  mode = "";
  await session.authenticate();
  assert.equal(signs, 1);
  await session.fetch(origin + "/status");
  assert.equal(authReads, 1);
  assert.throws(() => session.fetch("https://evil.example.org"), /DESTINATION/);
  now += 600000;
  assert.throws(() => session.fetch(origin + "/status"), /REAUTH_REQUIRED/);
  assert.equal(signs, 1);
  const restarted = createOwnerSession(
    origin,
    wallet,
    intent,
    async () => {
      throw Error("unexpected wallet");
    },
    () => "",
    () => now,
    fetcher,
  );
  assert.throws(() => restarted.fetch(origin + "/status"), /REAUTH_REQUIRED/);
  session.clear();
  assert.throws(() => session.fetch(origin + "/status"), /REAUTH_REQUIRED/);
});
