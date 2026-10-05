import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import {
  APPROVED_OPEN_PRODUCTION_POLICY,
  requireOpenProductionPolicy,
} from "../src/open-production-policy.ts";
import { OpenProductionRecordSigner } from "../src/open-production-signer.ts";
import { readIndependentOpenEvidence } from "../src/open-rpc-quorum.ts";
import { C3_MAINNET } from "../src/constants.ts";
import { handleProductionOwnerProtocol } from "../src/open-owner-auth-http.ts";
import { ownerServiceEntry } from "../src/open-owner-entry.ts";
import {
  issueOpenEnrollmentChallenge,
  enrollmentRequestMessage,
} from "../src/open-owner-enrollment.ts";

test("pre-intent HTTPS enrollment and removed CLI enrollment cannot bypass source approval", async () => {
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw Error("unexpected I/O");
  };
  const pool = { query: forbidden, connect: forbidden } as unknown as Pool;
  const fetcher = forbidden as unknown as typeof fetch;
  for (const [path, body] of [
    ["/v1/c3/owner/enrollment-challenge", {}],
    [
      "/v1/c3/owner/enrollment-challenge",
      { nonce: "a".repeat(64), requestedAtUnix: 1, signature: "AA==" },
    ],
    [
      "/v1/c3/owner/enroll",
      { challengeId: "forged", message: "AA==", signature: "AA==" },
    ],
  ] as const) {
    await assert.rejects(
      () =>
        handleProductionOwnerProtocol(
          pool,
          "https://c3-api.example.org",
          path,
          body,
          undefined,
          fetcher,
        ),
      /NOT_APPROVED/,
    );
  }
  await assert.rejects(() => ownerServiceEntry("enroll"), /NOT_APPROVED/);
  assert.equal(calls, 0);
});

test("anonymous or invalid enrollment issuance cannot reach PostgreSQL or exhaust owner quota", async () => {
  let calls = 0;
  const pool = {
    connect: async () => {
      calls++;
      throw Error("unexpected PG");
    },
  } as unknown as Pool;
  const policy = { wallet: C3_MAINNET.cbBtcMint } as unknown as Parameters<
    typeof enrollmentRequestMessage
  >[0];
  for (let n = 0; n < 65; n++)
    await assert.rejects(
      () =>
        issueOpenEnrollmentChallenge(
          pool,
          policy,
          "https://c3-api.example.org",
        ),
      /SIGNATURE_REQUIRED/,
    );
  await assert.rejects(
    () =>
      issueOpenEnrollmentChallenge(pool, policy, "https://c3-api.example.org", {
        nonce: "a".repeat(64),
        requestedAtUnix: 1,
        signature: new Uint8Array(64),
      }),
    /REQUEST_REJECTED/,
  );
  assert.equal(calls, 0);
});

test("missing source-reviewed approval prevents PG and isolated signer invocation", async () => {
  let calls = 0;
  const pool = {
    connect: async () => {
      calls++;
      throw new Error("forbidden");
    },
  } as unknown as Pool;
  const signer = new OpenProductionRecordSigner(pool, {
    publicKey: new Uint8Array(32),
    lookupSignature: async () => {
      throw Error("unexpected provider call");
    },
    signIdempotently: async () => {
      calls++;
      return new Uint8Array(64);
    },
  });
  assert.equal(APPROVED_OPEN_PRODUCTION_POLICY, null);
  assert.throws(requireOpenProductionPolicy, /NOT_APPROVED/);
  await assert.rejects(
    () => signer.signRecord("a".repeat(64), "b".repeat(64)),
    /NOT_APPROVED/,
  );
  assert.equal(calls, 0);
});
const providers = [
  {
    providerId: "operator-a-api",
    operatorId: "operator-a",
    endpoint: "https://rpc-a.example.org",
    reviewEvidenceHash: "a".repeat(64),
  },
  {
    providerId: "operator-b-api",
    operatorId: "operator-b",
    endpoint: "https://rpc-b.example.org",
    reviewEvidenceHash: "b".repeat(64),
  },
];
test("quorum rejects HTTP, aliases, same operators and all write methods before I/O", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    throw new Error("forbidden");
  }) as typeof fetch;
  for (const method of [
    "sendTransaction",
    "requestAirdrop",
    "simulateTransaction",
  ])
    await assert.rejects(
      () => readIndependentOpenEvidence(providers, method, [], fetcher),
      /READ_ONLY/,
    );
  for (const replacement of [
    { ...providers[1]!, endpoint: "http://rpc-b.example.org" },
    { ...providers[1]!, operatorId: providers[0]!.operatorId },
    { ...providers[1]!, endpoint: "https://rpc-a.example.org/alias" },
  ])
    await assert.rejects(() =>
      readIndependentOpenEvidence(
        [providers[0]!, replacement],
        "getGenesisHash",
        [],
        fetcher,
      ),
    );
  assert.equal(calls, 0);
});
test("two-provider agreement is only evidence intake; disagreement or wrong genesis fails closed", async () => {
  const response = (result: unknown) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  const agree = (async () => response(C3_MAINNET.genesisHash)) as typeof fetch;
  const r = (await readIndependentOpenEvidence(
    providers,
    "getGenesisHash",
    [],
    agree,
  )) as { status: string };
  assert.equal(r.status, "AGREED_UNVERIFIED_EFFECTS");
  let n = 0;
  await assert.rejects(
    () =>
      readIndependentOpenEvidence(providers, "getGenesisHash", [], (async () =>
        response(
          ++n === 1 ? C3_MAINNET.genesisHash : "other",
        )) as typeof fetch),
    /DISAGREEMENT/,
  );
  await assert.rejects(
    () =>
      readIndependentOpenEvidence(
        providers,
        "getTransaction",
        ["test"],
        (async () => response("wrong genesis")) as typeof fetch,
      ),
    /WRONG_CLUSTER/,
  );
});
test("u64 numeric rounding cannot create false RPC quorum", async () => {
  let n = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    const method = JSON.parse(String(init.body)).method;
    if (method === "getGenesisHash")
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: C3_MAINNET.genesisHash,
        }),
      );
    return new Response(
      `{"jsonrpc":"2.0","id":1,"result":{"balance":${++n === 1 ? "9007199254740992" : "9007199254740993"}}}`,
    );
  }) as typeof fetch;
  await assert.rejects(
    () =>
      readIndependentOpenEvidence(
        providers,
        "getTransaction",
        ["test"],
        fetcher,
      ),
    /UNSAFE_INTEGER/,
  );
});
test("explicit null transaction can be negative evidence; no other missing result satisfies quorum", async () => {
  const missing = (async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result:
          request.method === "getGenesisHash" ? C3_MAINNET.genesisHash : null,
      }),
    );
  }) as typeof fetch;
  const result = (await readIndependentOpenEvidence(
    providers,
    "getTransaction",
    ["public-test-signature"],
    missing,
  )) as { primary: unknown; secondary: unknown };
  assert.equal(result.primary, null);
  assert.equal(result.secondary, null);
  await assert.rejects(
    readIndependentOpenEvidence(providers, "getBlockHeight", [], missing),
    /MISSING_EVIDENCE/,
  );
  const absent = (async (_url: unknown, init: RequestInit) =>
    new Response(
      JSON.stringify(
        JSON.parse(String(init.body)).method === "getGenesisHash"
          ? { jsonrpc: "2.0", id: 1, result: C3_MAINNET.genesisHash }
          : { jsonrpc: "2.0", id: 1 },
      ),
    )) as typeof fetch;
  await assert.rejects(
    readIndependentOpenEvidence(
      providers,
      "getTransaction",
      ["public-test-signature"],
      absent,
    ),
    /MISSING_EVIDENCE/,
  );
});
