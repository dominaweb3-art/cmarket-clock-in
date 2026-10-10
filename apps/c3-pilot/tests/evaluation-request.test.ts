import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluationRequest,
  submitEvaluationProof,
} from "../src/evaluation-protocol.ts";

test("only proof DNS failure gets one bounded retry with identical bytes and original expiry", async () => {
  const challenge = {
    challengeId: "test",
    wallet: "public",
    cluster: "solana:devnet",
    message: "exact proof",
    expiresAt: new Date(125000).toISOString(),
  };
  const bodies: unknown[] = [];
  const waits: number[] = [];
  const request = async (body: Readonly<Record<string, unknown>>) => {
    bodies.push(body);
    if (bodies.length === 1) throw Error("EVAL_NETWORK_DNS_ERROR");
    return { wallet: "public" };
  };
  assert.deepEqual(
    await submitEvaluationProof(
      challenge,
      "signature",
      request,
      async (ms) => {
        waits.push(ms);
      },
      () => 1000,
    ),
    { wallet: "public" },
  );
  assert.equal(bodies.length, 2);
  assert.strictEqual(bodies[0], bodies[1]);
  assert.deepEqual(waits, [11000]);
  for (const code of [
    "EVAL_NETWORK_REQUEST_FAILED",
    "EVAL_REQUEST_TIMEOUT",
    "EVAL_AUTH_SIGNATURE",
  ]) {
    let calls = 0;
    await assert.rejects(
      submitEvaluationProof(
        challenge,
        "signature",
        async () => {
          calls++;
          throw Error(code);
        },
        async () => {
          throw Error("must not wait");
        },
        () => 1000,
      ),
      { message: code },
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    submitEvaluationProof(
      challenge,
      "signature",
      async () => {
        throw Error("EVAL_NETWORK_DNS_ERROR");
      },
      async () => {
        throw Error("must not wait");
      },
      () => 120000,
    ),
    { message: "EVAL_NETWORK_DNS_ERROR" },
  );
});

test("hosted requests keep safe server codes and isolate transport failures without retry", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: "EVAL_AUTH_CHALLENGE" }), {
        status: 401,
      });
    };
    await assert.rejects(evaluationRequest({ operation: "authenticate" }), {
      message: "EVAL_AUTH_CHALLENGE",
    });
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      new Response("private gateway body", { status: 502 });
    await assert.rejects(evaluationRequest({ operation: "position" }), {
      message: "EVAL_HTTP_502_INVALID_JSON",
    });
    globalThis.fetch = async () => {
      throw Error("private native information");
    };
    await assert.rejects(evaluationRequest({ operation: "position" }), {
      message: "EVAL_REQUEST_FETCH_UNKNOWN",
    });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ wallet: "public" }));
    assert.deepEqual(await evaluationRequest({ operation: "position" }), {
      wallet: "public",
    });
  } finally {
    globalThis.fetch = original;
  }
});
