import { test } from "node:test";
import assert from "node:assert/strict";
import { collectFinalizedOpenEconomicEvidence } from "../src/open-economic-quorum.ts";
import { C3_MAINNET } from "../src/constants.ts";
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
const signature = "3".repeat(88),
  accounts = [C3_MAINNET.usdcMint];
function fake(change: string): typeof fetch {
  return (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    let result: unknown;
    switch (body.method) {
      case "getGenesisHash":
        result = C3_MAINNET.genesisHash;
        break;
      case "getSignatureStatuses":
        result = {
          context: { slot: 101 },
          value: [
            change === "missing"
              ? null
              : {
                  slot: 100,
                  err: null,
                  confirmationStatus:
                    change === "confirmed" ? "confirmed" : "finalized",
                },
          ],
        };
        break;
      case "getTransaction":
        assert.equal(body.params[1].commitment, "finalized");
        result = {
          slot: 100,
          meta: {
            err: null,
            innerInstructions: [],
            preTokenBalances: [],
            postTokenBalances: [],
          },
          transaction: {
            signatures: [change === "signature" ? "bad" : signature],
          },
        };
        break;
      case "getMultipleAccounts":
        assert.equal(body.params[1].minContextSlot, 100);
        result = {
          context: { slot: change === "lag" ? 99 : 102 },
          value: [
            change === "missing-account"
              ? null
              : {
                  owner: C3_MAINNET.tokenProgram,
                  data: ["AA==", "base64"],
                  executable: false,
                  lamports: 1000,
                },
          ],
        };
        break;
      default:
        throw Error("unexpected write");
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
}
test("two finalized operators intake does not claim economic confirmation", async () => {
  const r = await collectFinalizedOpenEconomicEvidence(
    providers,
    signature,
    accounts,
    100,
    fake(""),
  );
  assert.equal(r.status, "FINALIZED_QUORUM_REQUIRES_SEMANTIC_VERIFICATION");
  for (const bad of [
    "missing",
    "confirmed",
    "signature",
    "lag",
    "missing-account",
  ])
    await assert.rejects(() =>
      collectFinalizedOpenEconomicEvidence(
        providers,
        signature,
        accounts,
        100,
        fake(bad),
      ),
    );
  await assert.rejects(
    () =>
      collectFinalizedOpenEconomicEvidence(
        [{ ...providers[0]! }, { ...providers[1]!, operatorId: "one" }],
        signature,
        accounts,
        100,
        fake(""),
      ),
    /INDEPENDENT|OPERATOR/,
  );
});
