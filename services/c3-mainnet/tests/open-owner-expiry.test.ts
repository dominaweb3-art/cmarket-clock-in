import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectExpiredOwnerBarrier,
  closeExpiredProductionOwnerRequest,
} from "../src/open-owner-expiry.ts";
import { C3_MAINNET } from "../src/constants.ts";
import type { Pool } from "pg";
const providers = [
  {
    providerId: "one",
    operatorId: "one",
    endpoint: "https://one.example.org",
    reviewEvidenceHash: "a".repeat(64),
  },
  {
    providerId: "two",
    operatorId: "two",
    endpoint: "https://two.example.org",
    reviewEvidenceHash: "b".repeat(64),
  },
];
test("two-operator expiry cannot use a pre-invalidity snapshot, known signature or disagreement", async () => {
  for (const failure of [
    "",
    "live",
    "lag",
    "changed",
    "known",
    "same-operator",
  ]) {
    const seen: string[] = [];
    const fetcher = (async (input: unknown, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      let result: unknown;
      if (method === "getGenesisHash") result = C3_MAINNET.genesisHash;
      else if (method === "getBlockHeight") result = 101;
      else if (method === "isBlockhashValid") {
        seen.push("invalid");
        result = { context: { slot: 123 }, value: failure === "live" };
      } else if (method === "getMultipleAccounts") {
        assert.equal(seen.filter((m) => m === "invalid").length, 2);
        assert.equal(params[1].minContextSlot, 123);
        result = {
          context: { slot: failure === "lag" ? 122 : 124 },
          value: [
            {
              owner: C3_MAINNET.tokenProgram,
              executable: false,
              data: [
                failure === "changed" && String(input).includes("two.")
                  ? "Ag=="
                  : "AQ==",
                "base64",
              ],
            },
            null,
          ],
        };
      } else if (method === "getSignatureStatuses")
        result = {
          context: { slot: 125 },
          value: [
            failure === "known"
              ? { confirmationStatus: "finalized", err: null }
              : null,
          ],
        };
      else throw Error("unexpected operation");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }) as typeof fetch;
    const run = () =>
      collectExpiredOwnerBarrier(
        failure === "same-operator"
          ? [providers[0]!, { ...providers[1]!, operatorId: "one" }]
          : providers,
        C3_MAINNET.usdcMint,
        "100",
        [C3_MAINNET.cbBtcMint, C3_MAINNET.portalEthMint],
        "3".repeat(88),
        fetcher,
      );
    if (failure) await assert.rejects(run);
    else assert.equal((await run()).stateHash.length, 32);
  }
  let calls = 0;
  await assert.rejects(
    () =>
      closeExpiredProductionOwnerRequest(
        {
          query: () => {
            calls++;
          },
        } as unknown as Pool,
        "none",
        true,
        (async () => {
          calls++;
          throw Error("unexpected");
        }) as typeof fetch,
      ),
    /NOT_APPROVED/,
  );
  assert.equal(calls, 0);
});
