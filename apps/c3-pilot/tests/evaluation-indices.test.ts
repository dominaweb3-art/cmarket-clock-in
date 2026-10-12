import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import {
  indicesCopy,
  indicesStatus,
  indicesText,
  marketKeys,
} from "../src/evaluation-indices-copy.ts";
import { indicesView } from "../src/evaluation-indices-state.ts";
import { languages } from "../src/locales.ts";
import { evalText } from "../src/evaluation-locales.ts";

// Public response shape of evaluation-owner-service.position(). No RPC, wallet,
// private credentials, fake app balances or on-chain operations are involved.
const wallet = "DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej";
const state = (extra: Record<string, unknown> = {}) => ({
  wallet,
  cluster: "solana:devnet",
  simulatedAssets: true,
  monetaryValue: false,
  lifecycle: 0,
  paused: false,
  settlementReleased: true,
  allowedActions: ["deposit"],
  pendingRequests: [],
  pendingInitialPlan: null,
  shares: "0",
  claimable: "0",
  returned: "0",
  ...extra,
});
test("all four locales cover every new key; catalog stays informational", () => {
  for (const language of languages) {
    assert.deepEqual(
      Object.keys(indicesCopy[language]),
      Object.keys(indicesCopy.en),
    );
    for (const key of Object.keys(
      indicesCopy.en,
    ) as (keyof typeof indicesCopy.en)[])
      assert.ok(indicesText(language, key).trim().length, `${language}/${key}`);
    assert.match(indicesText(language, "testNote"), /test|prueba|测试|teste/);
    assert.match(
      indicesText(language, "conditionsBody"),
      /1–1,000,000 USDC Devnet/,
    );
    assert.match(indicesText(language, "conditionsBody"), /Mainnet/);
    assert.match(indicesText(language, "compositionBody"), /40%.*30%.*30%/);
    assert.match(indicesText(language, "europe"), /region|región|地区|região/);
    assert.ok(indicesText(language, "planned").includes("{count}"));
  }
  assert.equal(marketKeys.length, 10);
  assert.equal(new Set(marketKeys).size, 10);
});
test("single primary action follows current connection and reviewed lifecycle", () => {
  const view = (p: Record<string, unknown> | null) =>
    indicesView(wallet, true, false, p);
  assert.equal(indicesView(null, false, false, null).label, "connect");
  assert.equal(indicesView(wallet, false, false, null).label, "verify");
  assert.equal(view(null).action, "provision");
  assert.equal(view(state()).action, "deposit");
  assert.equal(
    view(state({ lifecycle: 1, allowedActions: [] })).action,
    "advance",
  );
  assert.equal(
    view(state({ lifecycle: 1, allowedActions: ["issue_shares"] })).action,
    "issue_shares",
  );
  assert.equal(
    view(
      state({
        lifecycle: 2,
        shares: "1000000",
        allowedActions: ["request_redemption"],
      }),
    ).action,
    "request_redemption",
  );
  assert.equal(
    view(state({ lifecycle: 3, allowedActions: [] })).title,
    "selling",
  );
  assert.equal(
    view(
      state({ lifecycle: 3, claimable: "990000", allowedActions: ["claim"] }),
    ).action,
    "claim",
  );
  const completed = view(
    state({
      lifecycle: 4,
      shares: "0",
      returned: "990000",
      allowedActions: [],
    }),
  );
  assert.equal(completed.title, "completed");
  assert.equal(completed.action, "activity");
  assert.equal(
    view(state({ lifecycle: 4, returned: "0", allowedActions: [] })).title,
    "unknown",
  );
  assert.equal(
    view(state({ lifecycle: 4, returned: "bad", allowedActions: [] })).title,
    "unknown",
  );
  // A signature alone cannot turn a partial operation into success.
  assert.equal(
    view(
      state({
        lifecycle: 3,
        allowedActions: [],
        activity: [{ signature: "stored", effects_verified: false }],
      }),
    ).title,
    "selling",
  );
});
test("switching locale updates previous status copy without a new wallet or network operation", () => {
  for (const from of languages)
    for (const to of languages) {
      assert.equal(
        indicesStatus(to, evalText(from, "authenticated")),
        evalText(to, "authenticated"),
      );
      assert.equal(indicesStatus(to, "buying"), indicesText(to, "buying"));
      assert.equal(indicesStatus(to, ""), "");
      assert.ok(
        indicesStatus(to, "EVAL_ORIGINAL_REQUEST_UNCERTAIN").endsWith(
          "EVAL_ORIGINAL_REQUEST_UNCERTAIN",
        ),
      );
    }
});
test("pending, busy, unavailable, paused and wrong-scope responses never expose a new wallet approval", () => {
  assert.equal(indicesView(wallet, true, true, state()).action, "activity");
  assert.equal(
    indicesView(
      wallet,
      true,
      true,
      state({
        pendingRequests: [{ request_id: "original", signature: "submitted" }],
      }),
    ).recover,
    true,
  );
  for (const extra of [
    { pendingRequests: [{ request_id: "original", signature: "submitted" }] },
    { pendingRequests: [{ request_id: "original", signature: null }] },
    { pendingInitialPlan: { signature: "original-plan" } },
  ]) {
    const result = indicesView(wallet, true, false, state(extra));
    assert.equal(result.action, "activity");
    assert.equal(result.recover, true);
    assert.equal(result.renew, false);
  }
  for (const extra of [
    { settlementReleased: false },
    { paused: true },
    { wallet: "other" },
    { cluster: "solana:mainnet" },
    { simulatedAssets: false },
    { monetaryValue: true },
  ])
    assert.equal(
      indicesView(wallet, true, false, state(extra)).action,
      "refresh",
    );
  assert.equal(
    indicesView(
      wallet,
      true,
      false,
      state({ lifecycle: 3, paused: true, allowedActions: ["claim"] }),
    ).action,
    "claim",
  );
});
test("plan renewal and unswapped-deposit recovery remain explicit and visible", () => {
  const result = indicesView(
    wallet,
    true,
    false,
    state({
      lifecycle: 1,
      allowedActions: ["renew_plan", "recover_deposit_plan"],
    }),
  );
  assert.equal(result.renew, true);
  assert.equal(result.initialPlan, true);
  assert.equal(result.recover, false);
  const app = readFileSync(
    new URL("../src/DevnetEvaluationApp.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    app,
    /if \(unresolved \|\| position\?\.settlementReleased !== true\) return/,
  );
  assert.match(app, /!position\.allowedActions\.includes\(action\)/);
  assert.match(app, /if \(busy \|\| lock\.current \|\| unresolved\) return/);
});
test("accordions and wallet opening are passive; bottom navigation is fixed; no payment inside sheet", () => {
  const source = (file: string) =>
    readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const accordion = source("EvaluationAccordion.tsx"),
    sheet = source("EvaluationWalletSheet.tsx"),
    app = source("DevnetEvaluationApp.tsx"),
    indices = source("EvaluationIndices.tsx");
  assert.match(accordion, /useState\(false\)/);
  assert.match(accordion, /accessibilityState=\{\{ expanded \}\}/);
  assert.ok(!accordion.includes("useEffect"));
  assert.ok(!sheet.includes("useEffect"));
  assert.ok(!sheet.includes("signEvaluation"));
  assert.ok(!sheet.includes("prepareWalletAction"));
  assert.ok(!sheet.includes('t("buy")') && !sheet.includes('t("sell")'));
  assert.ok(!sheet.includes("Phantom")); // Provider identity is not supplied by connection controller.
  assert.match(sheet, /Clipboard\.setString\(wallet\)/);
  assert.match(sheet, /__DEV__ \?/); // Internal QA controls do not occupy release UX.
  assert.ok(!app.includes("headerLanguage"));
  assert.ok(
    app.indexOf("<BottomNavigation") > app.lastIndexOf("</ScrollView>"),
  );
  assert.ok(app.includes('style={tab !== "indices" && styles.hidden}')); // Keep accordion state mounted across tabs.
  assert.ok(
    indices.indexOf("{state.recover ?") <
      indices.indexOf("<EvaluationAccordion key={key}"),
  );
  assert.ok(
    indices.indexOf("accessibilityLiveRegion") <
      indices.indexOf("<EvaluationAccordion key={key}"),
  );
  assert.ok(
    indices.indexOf("marketKeys.map") > indices.indexOf('title={t("markets")}'),
  );
  // Structural checks are not a rendered-device accessibility or layout test.
});
test("unchanged connection, reconciliation and recovery controllers remain byte-equivalent after AST printing", () => {
  // Canonical AST-printer SHA-256 digests captured from original commit 804c3d8.
  // No whitespace/formatting changes can masquerade as a behavioral change.
  const hashes: Record<string, string> = {
    connect: "19933683344e64428c8a1605d3b6b8c66a8691b1360ae12a85fdeed2bfefd737",
    refresh: "c78b3725ebd330352d5678d70cb848d19063c1f344a74739ab7b1612ea4566d9",
    health: "d9067e2d888360430b33fa605a0bba10ea54ab85e5e3d90159521d21d50467b6",
    updatePosition:
      "17a795837ad753dd8109a8565b33072ba9c242b1d4c4b4929fe144254e89b0ca",
    advance: "fe2a2dcdf8aee6ac742337e63f9ae38e8f14c323b0df946ef04f8041cceb2585",
    recover: "a19a5139f3bfba4bdb1de4bd63c5cf34fae9c152ad6a38a195f129a356d0537f",
    displayUnits:
      "d145603605e61958338148a209820b0f4e0f4b93862649ed5abdab53188e0837",
  };
  const file = ts.createSourceFile(
    "app.tsx",
    readFileSync(
      new URL("../src/DevnetEvaluationApp.tsx", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found = new Set<string>();
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      hashes[node.name.text] &&
      node.initializer
    ) {
      const text = ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node.initializer, file);
      assert.equal(
        createHash("sha256").update(text).digest("hex"),
        hashes[node.name.text],
        node.name.text,
      );
      found.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(found.size, Object.keys(hashes).length);
});
test("basket asset uses alpha transparency and is consumed only by explanatory indices content", () => {
  const png = readFileSync(
    new URL(
      "../assets/evaluation-ui/c3-basket-explainer-v1.png",
      import.meta.url,
    ),
  );
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png[25], 6); // RGBA, not a baked black/white background.
  const ui = readFileSync(
    new URL("../src/EvaluationIndices.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /key === "shares"/);
  assert.match(ui, /c3-basket-explainer-v1.png/);
});
