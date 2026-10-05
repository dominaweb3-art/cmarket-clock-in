import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  base64FromUint8Array,
  base64ToBase58,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import { createOwnerEnrollment } from "../src/owner-enrollment.ts";
const key = new Uint8Array(32).fill(17); // isolated message fixture; never a funded wallet
const wallet = base64ToBase58(base64FromUint8Array(ed25519.getPublicKey(key)));
const scope = {
  wallet,
  program: wallet,
  vault: wallet,
  policyHash: "a".repeat(64),
  registryRevision: "1",
  quotePolicyRevision: "2",
};
const origin = "https://cmarket.example.org";
const id = "11111111-1111-4111-8111-111111111111";
const intent = "22222222-2222-4222-8222-222222222222";
function setup(
  mutate?: (lines: string[]) => void,
  options?: {
    afterSign?: (count: number) => Promise<void>;
    enrollmentResult?: unknown;
  },
) {
  let now = 1000000,
    signs = 0,
    calls = 0,
    submitted = 0;
  const messages: string[] = [];
  const fetcher = (async (input: unknown, init: RequestInit) => {
    calls++;
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    const body = JSON.parse(String(init.body));
    if (String(input).endsWith("/enrollment-challenge")) {
      assert.deepEqual(Object.keys(body).sort(), [
        "nonce",
        "requestedAtUnix",
        "signature",
      ]);
      const request = messages[0]!;
      assert.equal(
        request,
        [
          "C Market owner enrollment challenge request v1",
          "Purpose: request one control-proof challenge; NO transaction, transfer, token approval, login or Mainnet execution authorization.",
          `Audience: ${origin}`,
          `Wallet: ${wallet}`,
          `Program: ${wallet}`,
          `Vault: ${wallet}`,
          `Policy SHA-256: ${scope.policyHash}`,
          `Nonce: ${body.nonce}`,
          `Requested at Unix: ${body.requestedAtUnix}`,
        ].join("\n"),
      );
      assert.ok(
        ed25519.verify(
          Buffer.from(body.signature, "base64"),
          new TextEncoder().encode(request),
          ed25519.getPublicKey(key),
          { zip215: false },
        ),
      );
      const until = new Date(now + 120000).toISOString();
      const lines = [
        "C Market owner enrollment control proof v1",
        "Purpose: enroll this wallet only; NO transaction, transfer, token approval or Mainnet execution authorization.",
        "Network: solana:mainnet (message only)",
        `Audience: ${origin}`,
        `Wallet: ${wallet}`,
        `Program: ${wallet}`,
        `Vault: ${wallet}`,
        `Policy SHA-256: ${scope.policyHash}`,
        "Registry revision: 1",
        "Quote policy revision: 2",
        `Challenge: ${id}`,
        `Nonce: ${"b".repeat(64)}`,
        `Expires: ${until}`,
      ];
      mutate?.(lines);
      return new Response(
        JSON.stringify({
          challengeId: id,
          message: lines.join("\n"),
          expiresAt: until,
        }),
      );
    }
    assert.equal(String(input), origin + "/v1/c3/owner/enroll");
    assert.deepEqual(Object.keys(body).sort(), [
      "challengeId",
      "message",
      "signature",
    ]);
    assert.equal(Buffer.from(body.message, "base64").toString(), messages[1]);
    assert.ok(
      ed25519.verify(
        Buffer.from(body.signature, "base64"),
        Buffer.from(body.message, "base64"),
        ed25519.getPublicKey(key),
        { zip215: false },
      ),
    );
    submitted++;
    return new Response(
      JSON.stringify(options?.enrollmentResult ?? { intentId: intent }),
    );
  }) as typeof fetch;
  const client = createOwnerEnrollment(
    origin,
    scope,
    async (bytes) => {
      signs++;
      messages.push(new TextDecoder().decode(bytes));
      await options?.afterSign?.(signs);
      return ed25519.sign(bytes, key);
    },
    base64FromUint8Array,
    () => now,
    fetcher,
  );
  return {
    client,
    fetcher,
    counts: () => ({ signs, calls, submitted }),
    setNow: (n: number) => {
      now = n;
    },
  };
}
test("explicit control proof obtains one server-owned intent; read/cache never signs or persists", async () => {
  const s = setup();
  assert.equal(s.client.intentId, null);
  assert.deepEqual(s.counts(), { signs: 0, calls: 0, submitted: 0 });
  assert.equal(await s.client.enroll(), intent);
  assert.equal(await s.client.enroll(), intent);
  assert.deepEqual(s.counts(), { signs: 2, calls: 2, submitted: 1 });
  assert.equal(
    setup().client.intentId,
    null,
    "restart cannot invent/persist proof or an authenticated session",
  );
});
test("every server scope/purpose/order/nonce/expiry substitution is rejected before proof signing", async () => {
  for (let index = 0; index < 13; index++) {
    const s = setup((lines) => {
      lines[index] = "substituted";
    });
    await assert.rejects(s.client.enroll, /CHALLENGE/);
    assert.deepEqual(s.counts(), { signs: 1, calls: 1, submitted: 0 });
    assert.equal(s.client.intentId, null);
  }
  for (const mutate of [
    (l: string[]) => {
      [l[5], l[6]] = [l[6]!, l[5]!];
    },
    (l: string[]) => {
      l.push("Transfer: enabled");
    },
    (l: string[]) => {
      l[11] = `Nonce: ${"g".repeat(64)}`;
    },
  ]) {
    const s = setup(mutate);
    await assert.rejects(s.client.enroll, /CHALLENGE/);
    assert.equal(s.counts().submitted, 0);
  }
});
test("rejects incorrect signatures, expired replies, failed HTTP, malformed intent and concurrent enrollment; never retries", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const s = setup(undefined, {
    afterSign: async (count) => {
      if (count === 1) await waiting;
    },
  });
  const first = s.client.enroll();
  await assert.rejects(s.client.enroll, /ALREADY_PENDING/);
  release();
  assert.equal(await first, intent);
  assert.deepEqual(s.counts(), { signs: 2, calls: 2, submitted: 1 });
  const wrong = createOwnerEnrollment(
    origin,
    scope,
    async () => new Uint8Array(64),
    base64FromUint8Array,
    () => 1000000,
    s.fetcher,
  );
  await assert.rejects(wrong.enroll, /SIGNATURE/);
  let calls = 0;
  for (const response of [
    new Response("{}", { status: 503 }),
    new Response("{}"),
    new Response("{}", { status: 403 }),
  ]) {
    const client = createOwnerEnrollment(
      origin,
      scope,
      async (b) => ed25519.sign(b, key),
      base64FromUint8Array,
      () => 1000000,
      (async () => {
        calls++;
        return response;
      }) as typeof fetch,
    );
    await assert.rejects(client.enroll, /UNCERTAIN|CHALLENGE/);
  }
  assert.equal(calls, 3);
  for (const enrollmentResult of [
    { intentId: "bad" },
    { intentId: intent, policy: "attacker" },
    { wallet },
    {},
  ]) {
    const malformed = setup(undefined, { enrollmentResult });
    await assert.rejects(malformed.client.enroll, /RESPONSE/);
    assert.equal(malformed.client.intentId, null);
    assert.equal(malformed.counts().submitted, 1);
  }
  const expired = createOwnerEnrollment(
    origin,
    scope,
    async (b) => ed25519.sign(b, key),
    base64FromUint8Array,
    () => 1000000,
    (async () =>
      new Response(
        JSON.stringify({
          challengeId: id,
          message: "",
          expiresAt: new Date(1000000).toISOString(),
        }),
      )) as typeof fetch,
  );
  await assert.rejects(expired.enroll, /EXPIRY/);
  let delayed: ReturnType<typeof setup>;
  delayed = setup(undefined, {
    afterSign: async (count) => {
      if (count === 2) delayed.setNow(1120000);
    },
  });
  await assert.rejects(delayed.client.enroll, /EXPIRY/);
  assert.equal(
    delayed.counts().submitted,
    0,
    "expiry during physical review cannot enroll",
  );
});
test("release binds server enrollment before session; Mainnet disabled; candidate no longer imports Devnet device QA", () => {
  const src = (name: string) =>
    readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
  const c = src("candidate-owner.ts");
  assert.doesNotMatch(c, /configuration\.intentId|c\.intentId/);
  assert.match(c, /const intentId = intentIds\.get\(wallet\)/);
  assert.match(c, /C3_OWNER_ENROLLMENT_REQUIRED/);
  assert.match(c, /requireCandidateMoneyGate\(\);/);
  assert.doesNotMatch(
    src("MainnetCandidateApp.tsx"),
    /device-message-qa|reviewDeviceQa/,
  );
  assert.match(
    src("candidate-config.ts"),
    /MAINNET_MONETARY_CAPABILITY = false/,
  );
  assert.match(c, /return null;/);
});
