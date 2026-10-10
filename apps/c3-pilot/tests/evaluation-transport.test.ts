import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluationRequest } from "../src/evaluation-protocol.ts";
import {
  evaluationNativeIoCode,
  waitForEvaluationNetwork,
} from "../src/evaluation-transport.ts";

test("post-wallet network barrier probes GET only, bounds DNS waits and respects original expiry", async () => {
  let calls = 0;
  const waits: number[] = [];
  await waitForEvaluationNetwork(
    90000,
    async () => {
      if (++calls === 1) throw Error("EVAL_NETWORK_DNS_ERROR");
    },
    async (ms) => {
      waits.push(ms);
    },
    () => 1000,
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [11000]);
  calls = 0;
  await assert.rejects(
    waitForEvaluationNetwork(
      90000,
      async () => {
        calls++;
        throw Error("EVAL_NETWORK_DNS_ERROR");
      },
      async () => {},
      () => 1000,
    ),
    { message: "EVAL_NETWORK_DNS_ERROR" },
  );
  assert.equal(calls, 3);
  await assert.rejects(
    waitForEvaluationNetwork(
      14000,
      async () => {
        throw Error("EVAL_NETWORK_DNS_ERROR");
      },
      async () => {
        throw Error("must not wait");
      },
      () => 1000,
    ),
    { message: "EVAL_OWNER_REQUEST_EXPIRED" },
  );
  await assert.rejects(
    waitForEvaluationNetwork(
      90000,
      async () => {
        throw Error("EVAL_NETWORK_TLS_ERROR");
      },
      async () => {
        throw Error("must not retry");
      },
      () => 1000,
    ),
    { message: "EVAL_NETWORK_TLS_ERROR" },
  );
});

test("native IO classification never exposes addresses, credentials or response bodies", () => {
  assert.equal(
    evaluationNativeIoCode(
      "unexpected end of stream on https://private.invalid secret",
    ),
    "EVAL_NETWORK_CONNECTION_CLOSED",
  );
  assert.equal(
    evaluationNativeIoCode("stream was reset: PROTOCOL_ERROR"),
    "EVAL_NETWORK_PROTOCOL_ERROR",
  );
  assert.equal(
    evaluationNativeIoCode("SSLHandshakeException private"),
    "EVAL_NETWORK_TLS_ERROR",
  );
  assert.equal(
    evaluationNativeIoCode("Unable to resolve host private"),
    "EVAL_NETWORK_DNS_ERROR",
  );
  assert.equal(
    evaluationNativeIoCode("private opaque body"),
    "EVAL_NETWORK_REQUEST_FAILED",
  );
});

test("native JSON POST preserves exact proof bytes, rejects server errors and never retries", async () => {
  const original = globalThis.XMLHttpRequest;
  let sent = 0;
  let captured = "";
  let fail = false;
  class FakeXHR {
    status = 401;
    responseText = JSON.stringify({ error: "EVAL_AUTH_CHALLENGE" });
    responseType = "";
    timeout = 0;
    onload?: () => void;
    onerror?: () => void;
    open(method: string, url: string) {
      assert.equal(method, "POST");
      assert.equal(url, "https://cmarket-nine.vercel.app/api/evaluation");
    }
    setRequestHeader(name: string, value: string) {
      assert.equal(name, "Content-Type");
      assert.equal(value, "application/json");
    }
    send(body: string) {
      sent++;
      captured = body;
      assert.equal(this.responseType, "text");
      assert.equal(this.timeout, 50000);
      if (fail) {
        this.responseText = "unexpected end of stream private signature";
        this.onerror?.();
      } else this.onload?.();
    }
  }
  try {
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    const body = {
      operation: "authenticate",
      message: "exact\nmessage",
      signature: "test",
    };
    await assert.rejects(evaluationRequest(body), {
      message: "EVAL_AUTH_CHALLENGE",
    });
    assert.equal(captured, JSON.stringify(body));
    assert.equal(sent, 1);
    fail = true;
    await assert.rejects(evaluationRequest(body), {
      message: "EVAL_NETWORK_CONNECTION_CLOSED",
    });
    assert.equal(sent, 2);
  } finally {
    if (original === undefined)
      delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    else globalThis.XMLHttpRequest = original;
  }
});
