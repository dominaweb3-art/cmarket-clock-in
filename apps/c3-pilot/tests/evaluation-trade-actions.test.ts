import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  tradeAction,
  recoverOwnerRequest,
} from "../src/evaluation-trade-actions.ts";
import { indicesView } from "../src/evaluation-indices-state.ts";
import { indicesStatus } from "../src/evaluation-indices-copy.ts";
import { languages } from "../src/locales.ts";
const wallet = "owner",
  p = (extra: Record<string, unknown> = {}) => ({
    wallet,
    cluster: "solana:devnet",
    simulatedAssets: true,
    monetaryValue: false,
    finalizedSlot: 10,
    settlementReleased: true,
    paused: false,
    lifecycle: 3,
    shares: "10000000",
    pendingRequests: [],
    allowedActions: ["renew_plan"],
    settlementPlan: { state: "expired" },
    ...extra,
  });
test("Sell resumes the expired existing sale, never creates another redemption; Buy cannot sell", () => {
  assert.equal(tradeAction("sell", wallet, true, p()), "renew_plan");
  assert.equal(indicesView(wallet, true, false, p()).action, "renew_plan");
  assert.equal(tradeAction("buy", wallet, true, p()), null);
  assert.equal(
    tradeAction(
      "buy",
      wallet,
      true,
      p({ lifecycle: 2, allowedActions: ["request_redemption"] }),
    ),
    null,
  );
  assert.equal(
    tradeAction(
      "sell",
      wallet,
      true,
      p({ lifecycle: 2, allowedActions: ["request_redemption"] }),
    ),
    "request_redemption",
  );
  assert.equal(
    tradeAction("sell", wallet, true, p({ allowedActions: ["claim"] })),
    "claim",
  );
  assert.equal(
    tradeAction(
      "sell",
      wallet,
      true,
      p({ settlementPlan: { state: "ready" } }),
    ),
    "advance",
  );
  assert.equal(
    tradeAction("sell", wallet, true, p({ settlementPlan: null })),
    "refresh",
  );
  assert.equal(
    tradeAction(
      "sell",
      wallet,
      true,
      p({ pendingRequests: [{ request_id: "original" }] }),
    ),
    "recover",
  );
  assert.equal(
    tradeAction(
      "buy",
      wallet,
      true,
      p({ lifecycle: 0, allowedActions: ["deposit"] }),
    ),
    "deposit",
  );
  assert.equal(
    tradeAction(
      "sell",
      wallet,
      true,
      p({ lifecycle: 0, allowedActions: ["deposit"] }),
    ),
    null,
  );
  assert.equal(
    tradeAction(
      "buy",
      wallet,
      true,
      p({
        lifecycle: 4,
        returned: "9900000",
        shares: "0",
        round: "2",
        allowedActions: [],
      }),
    ),
    "new_purchase",
  );
  assert.equal(
    tradeAction(
      "buy",
      wallet,
      true,
      p({
        lifecycle: 4,
        returned: "9900000",
        shares: "0",
        round: "10",
        allowedActions: [],
      }),
    ),
    null,
  );
  assert.equal(tradeAction("sell", null, false, null), "wallet");
  for (const extra of [
    { wallet: "other" },
    { cluster: "solana:mainnet" },
    { monetaryValue: true },
    { simulatedAssets: false },
    { finalizedSlot: 0 },
  ])
    assert.equal(tradeAction("sell", wallet, true, p(extra)), "refresh");
});
test("cancelled unsigned packets are retired only by server expiry evidence", async () => {
  const calls: unknown[] = [];
  const result = await recoverOwnerRequest(
    { request_id: "original", signature: null },
    async (body) => {
      calls.push(body);
      return { status: "closed_unexecuted" };
    },
  );
  assert.equal(result.status, "closed_unexecuted");
  assert.deepEqual(calls, [
    { operation: "close_expired", requestId: "original" },
  ]);
});
test("submitted signatures reconcile first; uncertain/failed expiry cannot bypass evidence or resend", async () => {
  for (const state of [
    "uncertain",
    "failed_finalized",
    "effects_verified",
    "already_reconciled",
  ]) {
    const calls: string[] = [];
    const result = await recoverOwnerRequest(
      { request_id: "original", signature: "preserved" },
      async (body) => {
        calls.push(String(body.operation));
        return {
          status: body.operation === "reconcile" ? state : "closed_unexecuted",
        };
      },
    );
    assert.deepEqual(calls, [
      "reconcile",
      ...(["uncertain", "failed_finalized"].includes(state)
        ? ["close_expired"]
        : []),
    ]);
    assert.equal(
      result.status,
      ["uncertain", "failed_finalized"].includes(state)
        ? "closed_unexecuted"
        : state,
    );
  }
  for (const code of [
    "EVAL_OWNER_EXPIRY_BARRIER_NOT_FINALIZED",
    "EVAL_OWNER_UNCERTAIN_RECONCILE_FIRST",
  ]) {
    const calls: string[] = [];
    const result = await recoverOwnerRequest(
      { request_id: "original", signature: "preserved" },
      async (body) => {
        calls.push(String(body.operation));
        if (body.operation === "reconcile") return { status: "uncertain" };
        throw Error(code);
      },
    );
    assert.equal(result.status, "uncertain");
    assert.deepEqual(calls, ["reconcile", "close_expired"]);
  }
  await assert.rejects(
    recoverOwnerRequest({ request_id: "original" }, async () => {
      throw Error("EVAL_OWNER_EXPIRY_ACCOUNT_EFFECTS_CHANGED");
    }),
    /EFFECTS_CHANGED/,
  );
});
test("trade buttons are always present; expired-state copy is not presented as cancellation in any locale", () => {
  const text = readFileSync(
    new URL("../src/EvaluationIndices.tsx", import.meta.url),
    "utf8",
  );
  assert.match(text, /testID="indices-buy-action"/);
  assert.match(text, /testID="indices-sell-action"/);
  assert.match(text, /onTrade\("buy"\)/);
  assert.match(text, /onTrade\("sell"\)/);
  for (const language of languages) {
    const label = indicesStatus(
      language,
      "EVAL_LEG_PLAN_EXPIRED_RENEW_REQUIRED",
    );
    assert.ok(label.includes("EVAL_LEG_PLAN_EXPIRED_RENEW_REQUIRED"));
    assert.notEqual(
      label.split("\n")[0],
      indicesStatus(language, "EVAL_UNKNOWN").split("\n")[0],
    );
  }
});
