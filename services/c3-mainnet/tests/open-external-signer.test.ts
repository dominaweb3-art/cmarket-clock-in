import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpsOpenQuoteSigner } from "../src/open-external-signer.ts";
const metadata = {
  endpoint: "https://isolated-signer.example.org/v1/c3/quote-signatures/",
  publicKey: new Uint8Array(32).fill(7),
  reviewEvidenceHash: "a".repeat(64),
};
test("external signer is bounded server transport with stable request identity and no retries", async () => {
  const calls: RequestInit[] = [];
  const transport = (async (_url: unknown, init: RequestInit) => {
    calls.push(init);
    if (init.method === "GET") return new Response(null, { status: 404 });
    const b = JSON.parse(String(init.body));
    assert.equal(b.requestId, "b".repeat(64));
    assert.equal(Buffer.from(b.canonicalBytes, "base64").length, 300);
    assert.equal(b.payloadHash.length, 64);
    return new Response(
      JSON.stringify({
        requestId: b.requestId,
        publicKey: Buffer.from(metadata.publicKey).toString("hex"),
        signature: "c".repeat(128),
      }),
    );
  }) as typeof fetch;
  const signer = new HttpsOpenQuoteSigner(metadata, transport);
  assert.equal(
    (await signer.signIdempotently("b".repeat(64), new Uint8Array(300))).length,
    64,
  );
  assert.equal(await signer.lookupSignature("b".repeat(64)), null);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.redirect === "error" && c.signal));
  let failures = 0;
  const failing = new HttpsOpenQuoteSigner(metadata, (async () => {
    failures++;
    throw Error("test");
  }) as typeof fetch);
  await assert.rejects(() =>
    failing.signIdempotently("b".repeat(64), new Uint8Array(300)),
  );
  assert.equal(failures, 1);
});
test("external signer rejects endpoints, malformed identity and oversized responses", async () => {
  let calls = 0;
  const forbidden = (async () => {
    calls++;
    throw Error("unexpected");
  }) as typeof fetch;
  for (const endpoint of [
    "http://isolated-signer.example.org/v1/c3/quote-signatures/",
    "https://user:secret@example.org/v1/c3/quote-signatures/",
    "https://example.org/other",
  ])
    assert.throws(
      () => new HttpsOpenQuoteSigner({ ...metadata, endpoint }, forbidden),
    );
  const signer = new HttpsOpenQuoteSigner(metadata, forbidden);
  await assert.rejects(() =>
    signer.signIdempotently("invalid", new Uint8Array(300)),
  );
  await assert.rejects(() =>
    signer.signIdempotently("b".repeat(64), new Uint8Array(299)),
  );
  assert.equal(calls, 0);
  for (const response of [
    "x".repeat(4097),
    JSON.stringify({
      requestId: "b".repeat(64),
      publicKey: "d".repeat(64),
      signature: "c".repeat(128),
    }),
  ]) {
    const s = new HttpsOpenQuoteSigner(
      metadata,
      (async () => new Response(response)) as typeof fetch,
    );
    await assert.rejects(() =>
      s.signIdempotently("b".repeat(64), new Uint8Array(300)),
    );
  }
});
