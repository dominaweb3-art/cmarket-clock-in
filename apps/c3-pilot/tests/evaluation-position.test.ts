import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  basketPosition,
  positionCopy,
} from "../src/evaluation-position-view.ts";
import {
  indicesView,
  buyEntryAction,
} from "../src/evaluation-indices-state.ts";
const wallet = "DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej";
const position = (extra: Record<string, unknown> = {}) => ({
  wallet,
  cluster: "solana:devnet",
  simulatedAssets: true,
  monetaryValue: false,
  lifecycle: 2,
  deposited: "100000000",
  shares: "100000000",
  claimable: "0",
  returned: "0",
  settlementReleased: true,
  pendingRequests: [],
  allowedActions: ["request_redemption"],
  ...extra,
});
test("amount-first position never treats burned or unverified shares as an active basket", () => {
  assert.equal(basketPosition(wallet, true, position()).state, "active");
  assert.equal(
    basketPosition(
      wallet,
      true,
      position({ lifecycle: 4, shares: "0", returned: "99000000" }),
    ).state,
    "completed",
  );
  assert.equal(basketPosition(wallet, false, position()).state, "verify");
  for (const bad of [
    { wallet: "other" },
    { cluster: "solana:mainnet" },
    { shares: "bad" },
    { deposited: "1000000000001" },
    { lifecycle: 2, shares: "0" },
  ])
    assert.equal(
      basketPosition(wallet, true, position(bad)).state,
      "unavailable",
    );
  for (const locale of Object.values(positionCopy)) {
    assert.deepEqual(Object.keys(locale), Object.keys(positionCopy.en));
    assert.ok(locale.sellReason.length > 20);
  }
});
test("Buy entry guides authentication and a fresh vault without authorizing a payment", () => {
  assert.equal(
    buyEntryAction(indicesView(null, false, false, null), false, false),
    "wallet",
  );
  assert.equal(
    buyEntryAction(indicesView(wallet, false, false, null), false, false),
    "wallet",
  );
  assert.equal(
    buyEntryAction(indicesView(wallet, true, false, null), false, false),
    "provision",
  );
  const done = position({
    lifecycle: 4,
    shares: "0",
    returned: "99000000",
    allowedActions: [],
  });
  assert.equal(
    buyEntryAction(indicesView(wallet, true, false, done), false, false),
    "new_purchase",
  );
  assert.equal(
    buyEntryAction(indicesView(wallet, true, false, position()), false, true),
    null,
  );
  assert.equal(
    buyEntryAction(
      indicesView(
        wallet,
        true,
        false,
        position({ pendingRequests: [{ signature: "original" }] }),
      ),
      false,
      true,
    ),
    null,
  );
  assert.equal(
    buyEntryAction(indicesView(wallet, true, false, done), true, true),
    null,
  );
});
test("Indices keeps the position; compact Home only navigates, and sale remains state-bound", () => {
  const source = (p: string) =>
    readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
  assert.match(source("EvaluationIndices.tsx"), /<EvaluationPosition/);
  assert.doesNotMatch(source("EvaluationHome.tsx"), /<EvaluationPosition/);
  assert.match(
    source("EvaluationIndices.tsx"),
    /EvaluationAccordion title=\{positionCopy\[language\]\.details\}/,
  );
  assert.match(
    source("EvaluationIndices.tsx"),
    /state\.action === "request_redemption" && !busy/,
  );
  for (const forbidden of [
    "signEvaluation",
    "evaluationRequest",
    "prepareWalletAction",
    "fetch(",
  ])
    assert.ok(!source("EvaluationPosition.tsx").includes(forbidden));
});
