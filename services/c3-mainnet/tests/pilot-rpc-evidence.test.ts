import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertIndependentRpcProviders,
  collectIndependentTransactionEvidence,
  type ReviewedRpcProvider,
} from "../src/pilot-rpc-evidence.ts";

const providers: readonly ReviewedRpcProvider[] = [
  {
    providerId: "rpc-one",
    operatorId: "operator-one",
    endpoint: "https://rpc-one.example/",
    reviewEvidenceHash: "a".repeat(64),
  },
  {
    providerId: "rpc-two",
    operatorId: "operator-two",
    endpoint: "https://rpc-two.example/",
    reviewEvidenceHash: "b".repeat(64),
  },
];
const signature = "2".repeat(64);

test("reviewed provider pair must be HTTPS and truly distinct", () => {
  assert.doesNotThrow(() => assertIndependentRpcProviders(providers));
  assert.throws(
    () => assertIndependentRpcProviders([providers[0]!]),
    /PAIR_REQUIRED/,
  );
  assert.throws(
    () =>
      assertIndependentRpcProviders([
        providers[0]!,
        { ...providers[1]!, operatorId: "operator-one" },
      ]),
    /NOT_INDEPENDENT/,
  );
  assert.throws(
    () =>
      assertIndependentRpcProviders([
        providers[0]!,
        { ...providers[1]!, providerId: "rpc-one" },
      ]),
    /NOT_INDEPENDENT/,
  );
  assert.throws(
    () =>
      assertIndependentRpcProviders([
        providers[0]!,
        { ...providers[1]!, endpoint: "https://RPC-ONE.example" },
      ]),
    /NOT_INDEPENDENT/,
  );
  assert.throws(
    () =>
      assertIndependentRpcProviders([
        providers[0]!,
        { ...providers[1]!, endpoint: "http://rpc-two.example/" },
      ]),
    /HTTPS_ENDPOINT_REQUIRED/,
  );
  assert.throws(
    () =>
      assertIndependentRpcProviders([
        providers[0]!,
        { ...providers[1]!, endpoint: "https://user:pass@rpc-two.example/" },
      ]),
    /HTTPS_ENDPOINT_REQUIRED/,
  );
});

test("raw getTransaction intake is read-only, sequential and never confirms a leg", async () => {
  const requests: unknown[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          slot: requests.length,
          blockTime: 1,
          transaction: ["AQ==", "base64"],
          meta: {},
          version: 0,
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const result = await collectIndependentTransactionEvidence(
    providers,
    signature,
    fetcher,
  );
  assert.equal(result.status, "MANUAL_REVIEW");
  assert.equal(result.reason, "C3_RPC_PROVIDER_EVIDENCE_CONFLICT");
  assert.equal(requests.length, 2);
  for (const request of requests as Record<string, unknown>[]) {
    assert.equal(request.method, "getTransaction");
    assert.equal((request.params as unknown[])[0], signature);
  }
});

test("missing provider evidence fails closed and does not retry", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }),
      { status: 200 },
    );
  }) as typeof fetch;
  const result = await collectIndependentTransactionEvidence(
    providers,
    signature,
    fetcher,
  );
  assert.equal(result.status, "MANUAL_REVIEW");
  assert.equal(result.reason, "C3_RPC_MISSING_OR_INVALID_EVIDENCE");
  assert.equal(calls, 1);
});
