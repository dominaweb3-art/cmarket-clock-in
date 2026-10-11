import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { activityCopy, activityText } from "../src/evaluation-activity-copy.ts";
import {
  activityExplorer,
  activityGroups,
  activityUnits,
} from "../src/evaluation-activity-state.ts";
import { languages } from "../src/locales.ts";
const wallet = "DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej";
const sig = (n: number) => String(n + 1).repeat(88);
const receipt = (action: string, n: number, verified = true) => ({
  action,
  signature: sig(n),
  effects_verified: verified,
});
const position = (extra: Record<string, unknown> = {}) => ({
  wallet,
  cluster: "solana:devnet",
  simulatedAssets: true,
  monetaryValue: false,
  finalizedSlot: 123456,
  lifecycle: 0,
  shares: "0",
  returned: "0",
  activity: [],
  ...extra,
});
const source = (f: string) =>
  readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("all four locales cover Activity, uncertainty, empty state and Devnet disclosure", () => {
  for (const l of languages) {
    assert.deepEqual(
      Object.keys(activityCopy[l]),
      Object.keys(activityCopy.en),
    );
    for (const k of Object.keys(
      activityCopy.en,
    ) as (keyof typeof activityCopy.en)[])
      assert.ok(activityText(l, k).trim().length, `${l}/${k}`);
    assert.match(activityText(l, "explorer"), /Devnet/);
    assert.match(activityText(l, "test"), /TEST USDC/);
  }
});
test("activity belongs only to the authenticated wallet and finalized Devnet test scope", () => {
  const p = position({ activity: [receipt("deposit", 0)] });
  assert.deepEqual(activityGroups(wallet, false, p), []);
  assert.deepEqual(activityGroups(null, true, p), []);
  for (const extra of [
    { wallet: "other" },
    { cluster: "solana:mainnet" },
    { monetaryValue: true },
    { simulatedAssets: false },
    { finalizedSlot: 0 },
    { finalizedSlot: "123456" },
  ])
    assert.deepEqual(activityGroups(wallet, true, { ...p, ...extra }), []);
});
test("stored signatures and partial economic evidence cannot complete a journey", () => {
  const view = (
    activity: unknown[],
    lifecycle = 4,
    returned: unknown = "990000",
  ) =>
    activityGroups(wallet, true, position({ activity, lifecycle, returned }));
  assert.equal(view([receipt("deposit", 0)])[0]!.state, "processing");
  assert.equal(
    view([receipt("deposit", 0), receipt("issue_shares", 1, false)])[0]!.state,
    "reconciling",
  );
  assert.equal(
    view([receipt("request_redemption", 2), receipt("claim", 3, false)])[0]!
      .state,
    "reconciling",
  );
  assert.equal(view([receipt("claim", 3)])[0]!.state, "processing");
  for (const returned of ["0", "-1", "0.99", 990000, "bad", null])
    assert.equal(
      view(
        [receipt("request_redemption", 2), receipt("claim", 3)],
        4,
        returned,
      )[0]!.state,
      "processing",
    );
  assert.equal(
    view([receipt("request_redemption", 2), receipt("claim", 3)], 3)[0]!.state,
    "processing",
  );
});
test("buy and sale are grouped once, claim uses the actual reconciled result, not 0.99", () => {
  const activity = [
    receipt("deposit", 0),
    receipt("issue_shares", 1),
    receipt("request_redemption", 2),
    receipt("claim", 3),
  ];
  const groups = activityGroups(
    wallet,
    true,
    position({ activity, lifecycle: 4, returned: "987654", shares: "0" }),
  );
  assert.deepEqual(
    groups.map((g) => [g.kind, g.state]),
    [
      ["buy", "completed"],
      ["sell", "completed"],
    ],
  );
  assert.equal(groups[0]!.amount, null); // API has no historical deposited amount.
  assert.equal(groups[0]!.shares, null); // Burnt shares must not become a fabricated historical balance.
  assert.equal(groups[1]!.amount, "987654");
  const active = activityGroups(
    wallet,
    true,
    position({
      activity: activity.slice(0, 2),
      lifecycle: 2,
      shares: "1000000",
    }),
  );
  assert.equal(active[0]!.shares, "1000000");
  const redeemed = activityGroups(
    wallet,
    true,
    position({
      activity,
      lifecycle: 4,
      returned: "987654",
      shares: "0",
      deposited: "1000000",
      sharesIssued: "1000000",
    }),
  );
  assert.equal(redeemed[0]!.amount, "1000000");
  assert.equal(redeemed[0]!.shares, "1000000"); // Historical issuance, not current balance.
  assert.equal(redeemed[1]!.amount, "987654");
  const unproven = activityGroups(
    wallet,
    true,
    position({
      activity: [receipt("issue_shares", 1, false)],
      lifecycle: 4,
      deposited: "1000000",
      sharesIssued: "1000000",
      shares: "0",
    }),
  );
  assert.equal(unproven[0]!.shares, null);
});
test("unclassified keeper receipts are retained, never inferred from unsorted array order", () => {
  const list = [
    receipt("execute", 0),
    receipt("authorize", 1),
    receipt("plan", 2),
    receipt("record", 3),
  ];
  const groups = activityGroups(
    wallet,
    true,
    position({ activity: list, lifecycle: 4, returned: "990000" }),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.kind, "other");
  assert.equal(groups[0]!.state, "confirmed");
  assert.equal(groups[0]!.receipts.length, 4);
  assert.equal(groups[0]!.date, null);
  assert.equal(groups[0]!.amount, null);
  const reordered = activityGroups(
    wallet,
    true,
    position({ activity: list.toReversed() }),
  );
  assert.deepEqual(
    reordered[0]!.receipts.map((r) => r.signature).toSorted(),
    groups[0]!.receipts.map((r) => r.signature).toSorted(),
  );
});
test("duplicate or conflicting receipts do not fake stages or promote success", () => {
  const original = receipt("deposit", 0);
  assert.equal(
    activityGroups(
      wallet,
      true,
      position({ activity: [original, original] }),
    )[0]!.receipts.length,
    1,
  );
  const groups = activityGroups(
    wallet,
    true,
    position({
      lifecycle: 2,
      activity: [
        original,
        { ...original, effects_verified: false },
        receipt("issue_shares", 1),
      ],
    }),
  );
  assert.equal(groups[0]!.state, "reconciling");
  const conflict = activityGroups(
    wallet,
    true,
    position({ activity: [original, { ...original, action: "claim" }] }),
  );
  assert.equal(conflict[0]!.kind, "other");
  assert.equal(conflict[0]!.receipts[0]!.verified, false);
});
test("malformed signatures, dates and amounts never become evidence or external links", () => {
  assert.equal(activityExplorer("https://malicious.example"), null);
  assert.equal(activityExplorer("<signature>"), null);
  assert.equal(
    activityExplorer(sig(0)),
    `https://explorer.solana.com/tx/${sig(0)}?cluster=devnet`,
  );
  for (const v of [
    undefined,
    null,
    -1,
    1,
    "-1",
    "1.0",
    "01",
    "1e6",
    "9".repeat(21),
  ])
    assert.equal(activityUnits(v), null);
  assert.equal(
    activityGroups(
      wallet,
      true,
      position({
        activity: [
          null,
          {},
          receipt("deposit", 0, false),
          { ...receipt("execute", 1), created_at: "not-a-date" },
        ],
      }),
    )[1]!.date,
    null,
  );
  const g = activityGroups(
    wallet,
    true,
    position({
      lifecycle: 2,
      activity: [
        {
          ...receipt("deposit", 0),
          created_at: "2026-10-10T12:00:00Z",
          input_amount: "1000000",
        },
        receipt("issue_shares", 1),
      ],
    }),
  );
  assert.equal(g[0]!.date, "2026-10-10T12:00:00Z");
  assert.equal(g[0]!.amount, "1000000");
});
test("opening or switching Activity cannot fetch, authorize or mutate operation state", () => {
  const activity = source("EvaluationActivity.tsx"),
    app = source("DevnetEvaluationApp.tsx");
  for (const forbidden of [
    "useEffect",
    "evaluationRequest",
    "signEvaluation",
    "submitEvaluation",
    "fetch(",
    "AsyncStorage",
    "setPosition(",
  ])
    assert.ok(!activity.includes(forbidden), forbidden);
  assert.match(activity, /useState\(false\)/);
  assert.match(activity, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(app, /style=\{tab !== "activity" && styles.hidden\}/);
  assert.match(app, /onWallet=\{\(\) => setWalletOpen\(true\)\}/);
  assert.match(app, /onIndices=\{\(\) => changeTab\("indices"\)\}/);
  assert.match(activity, /view.recover \? onRecover : onIndices/);
  assert.match(activity, /onPress=\{onRefresh\}/);
  assert.match(activity, /Clipboard.setString\(receipt.signature\)/);
  assert.match(activity, /group.receipts.map/);
  assert.ok(!activity.includes("0.99") && !activity.includes("0,99"));
});
