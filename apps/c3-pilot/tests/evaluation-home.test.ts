import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { homeCopy, homeText } from "../src/evaluation-home-copy.ts";
import { homeOperation } from "../src/evaluation-home-state.ts";
import { indicesText } from "../src/evaluation-indices-copy.ts";
import { languages } from "../src/locales.ts";

const source = (name: string) =>
  readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const appText = source("DevnetEvaluationApp.tsx");
const app = ts.createSourceFile(
  "app.tsx",
  appText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
// Execute only the actual presentation/navigation callbacks with inert adapters.
// This does not load React Native, call a wallet, request RPC or render a device.
function initializer(name: string, file = app): string {
  let found = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    )
      found = node.initializer.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, name);
  return found;
}
function expressionFunction(
  expression: string,
  bindings: Record<string, unknown>,
): (...args: unknown[]) => unknown {
  const js = ts.transpileModule(`const fn = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}\nreturn fn;`)(
    ...Object.values(bindings),
  );
}
function homeProperty(name: string): string {
  let expression = "";
  function visit(node: ts.Node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(app) === "EvaluationHome"
    ) {
      for (const p of node.attributes.properties)
        if (
          ts.isJsxAttribute(p) &&
          p.name.getText(app) === name &&
          p.initializer &&
          ts.isJsxExpression(p.initializer) &&
          p.initializer.expression
        )
          expression = p.initializer.expression.getText(app);
    }
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.ok(expression, name);
  return expression;
}
const wallet = "DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej";
const position = (extra: Record<string, unknown> = {}) => ({
  wallet,
  cluster: "solana:devnet",
  simulatedAssets: true,
  monetaryValue: false,
  lifecycle: 0,
  paused: false,
  pendingRequests: [],
  pendingInitialPlan: null,
  allowedActions: ["deposit"],
  ...extra,
});

test("Home copy is complete in four languages and preserves truthful test restrictions", () => {
  for (const language of languages) {
    assert.deepEqual(Object.keys(homeCopy[language]), Object.keys(homeCopy.en));
    for (const key of Object.keys(homeCopy.en) as (keyof typeof homeCopy.en)[])
      assert.ok(homeText(language, key).trim().length, `${language}/${key}`);
    assert.match(homeText(language, "note"), /Devnet/);
    assert.match(
      homeText(language, "buyBody"),
      /1.*1[.,]000[.,]000 USDC Devnet/,
    );
    assert.match(
      homeText(language, "methodologyBody"),
      /BTC 40%.*ETH 30%.*SOL 30%/,
    );
    assert.match(homeText(language, "realBody"), /Devnet/);
    const lifetimeRestriction = {
      en: /ten.*history preserved.*one active/,
      es: /diez.*historial.*una posición activa/,
      "zh-CN": /十.*历史.*一个活跃/,
      "pt-BR": /dez.*histórico.*uma posição ativa/,
    };
    assert.match(
      homeText(language, "repeatBody"),
      lifetimeRestriction[language],
    );
    for (const state of [
      "buying",
      "selling",
      "claiming",
      "recoveryNote",
      "paused",
    ] as const)
      assert.ok(indicesText(language, state));
  }
  assert.equal(homeText("es", "title"), "Criptoactivos, en una cesta.");
  assert.equal(
    homeText("es", "introduction"),
    "C Market reúne activos en índices y te permite seguir tu participación desde una experiencia móvil sencilla.",
  );
});
test("pending hint uses existing wallet-scoped state, not balances or a stored success signature", () => {
  assert.equal(homeOperation(null, false, false, null), null);
  assert.equal(
    homeOperation(wallet, false, false, position({ lifecycle: 1 })),
    null,
  );
  assert.equal(homeOperation(wallet, true, false, null), null);
  assert.equal(homeOperation(wallet, true, true, null), "busy");
  assert.equal(homeOperation(wallet, true, false, position()), null);
  assert.equal(
    homeOperation(wallet, true, false, position({ lifecycle: 1 })),
    "buying",
  );
  assert.equal(
    homeOperation(wallet, true, false, position({ lifecycle: 2 })),
    null,
  );
  assert.equal(
    homeOperation(wallet, true, false, position({ lifecycle: 3 })),
    "selling",
  );
  assert.equal(
    homeOperation(
      wallet,
      true,
      false,
      position({ lifecycle: 3, allowedActions: ["claim"] }),
    ),
    "claiming",
  );
  assert.equal(
    homeOperation(
      wallet,
      true,
      false,
      position({ lifecycle: 4, returned: "990000" }),
    ),
    null,
  );
  assert.equal(
    homeOperation(
      wallet,
      true,
      false,
      position({ lifecycle: 1, paused: true }),
    ),
    "paused",
  );
  for (const pending of [
    { pendingRequests: [{ request_id: "original", signature: "stored" }] },
    { pendingRequests: [{ request_id: "unsubmitted", signature: null }] },
    { pendingInitialPlan: { signature: "original-plan" } },
  ])
    assert.equal(
      homeOperation(wallet, true, false, position(pending)),
      "recoveryNote",
    );
  for (const wrong of [
    { wallet: "other" },
    { cluster: "solana:mainnet" },
    { simulatedAssets: false },
    { monetaryValue: true },
  ])
    assert.equal(
      homeOperation(wallet, true, true, position({ lifecycle: 1, ...wrong })),
      null,
    );
});
test("Explore and Continue only navigate to existing Indices, even while an operation is pending", () => {
  const calls: unknown[] = [];
  const navigate = expressionFunction(homeProperty("onExplore"), {
    changeTab: (value: unknown) => calls.push(value),
  });
  navigate();
  assert.deepEqual(calls, ["indices"]);
  const home = source("EvaluationHome.tsx");
  assert.equal((home.match(/onPress=\{onExplore\}/g) ?? []).length, 2);
  assert.equal((home.match(/style=\{s.primary\}/g) ?? []).length, 1);
  for (const forbidden of [
    "useEffect",
    "fetch(",
    "evaluationRequest",
    "signEvaluation",
    "prepareWalletAction",
    "onConnect",
    "onVerify",
    "displayUnits",
    "Linking",
    "C5",
    "C10",
    "C20",
    "C50",
    "marketKeys",
  ])
    assert.ok(!home.includes(forbidden), forbidden);
  assert.ok(
    home.indexOf("{operation ?") < home.indexOf("<EvaluationAccordion"),
  );
});
test("tab navigation preserves operation state and stops pending catalog jumps when leaving Indices", () => {
  const calls: unknown[] = [],
    catalogRequested = { current: true };
  const change = expressionFunction(initializer("changeTab"), {
    catalogRequested,
    setTab: (v: unknown) => calls.push(v),
    scroll: { current: { scrollTo: (v: unknown) => calls.push(v) } },
  });
  change("activity");
  assert.equal(catalogRequested.current, false);
  assert.deepEqual(calls, ["activity", { y: 0, animated: false }]);
  const body = initializer("changeTab");
  for (const forbidden of [
    "setWallet",
    "setVerified",
    "setPosition",
    "session",
    "sign",
    "evaluationRequest",
  ])
    assert.ok(!body.includes(forbidden));
  assert.ok(
    appText.indexOf("<BottomNavigation") > appText.lastIndexOf("</ScrollView>"),
  );
});
test("upcoming navigation scrolls to the Indices catalog once and only after an explicit user request", () => {
  const catalogRequested = { current: false },
    catalogY = { current: 0 },
    calls: unknown[] = [],
    frames: (() => void)[] = [];
  const scrollToCatalog = expressionFunction(initializer("scrollToCatalog"), {
    catalogY,
    catalogRequested,
    scroll: { current: { scrollTo: (v: unknown) => calls.push(v) } },
  });
  scrollToCatalog(800); // Arriving layout/data alone must not jump.
  assert.equal(calls.length, 0);
  const upcoming = expressionFunction(initializer("openUpcoming"), {
    catalogRequested,
    catalogY,
    scrollToCatalog,
    changeTab: (v: unknown) => calls.push(v),
    requestAnimationFrame: (f: () => void) => frames.push(f),
  });
  upcoming();
  assert.equal(catalogRequested.current, true);
  assert.deepEqual(calls, ["indices"]);
  frames[0]!();
  assert.deepEqual(calls, ["indices", { y: 800, animated: true }]);
  assert.equal(catalogRequested.current, false);
  scrollToCatalog(850);
  assert.equal(calls.length, 2);
  assert.equal(homeProperty("onUpcoming"), "openUpcoming");
});
test("information accordions toggle locally, remain flat and introduce no signature or request", () => {
  const accordionText = source("EvaluationAccordion.tsx");
  const file = ts.createSourceFile(
    "accordion.tsx",
    accordionText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression = "";
  function visit(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === "onPress" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    )
      expression = node.initializer.expression.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  let expanded = false;
  const toggle = expressionFunction(expression, {
    setExpanded: (fn: (v: boolean) => boolean) => {
      expanded = fn(expanded);
    },
  });
  toggle();
  assert.equal(expanded, true);
  toggle();
  assert.equal(expanded, false);
  assert.match(accordionText, /useState\(false\)/);
  assert.match(accordionText, /accessibilityState=\{\{ expanded \}\}/);
  const home = ts.createSourceFile(
    "home.tsx",
    source("EvaluationHome.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let nested = false,
    count = 0;
  function inspect(node: ts.Node, depth = 0) {
    const isAccordion =
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(home) === "EvaluationAccordion";
    if (isAccordion) {
      count++;
      if (depth) nested = true;
    }
    ts.forEachChild(node, (child) =>
      inspect(child, depth + (isAccordion ? 1 : 0)),
    );
  }
  inspect(home);
  assert.equal(count, 5);
  assert.equal(nested, false);
  assert.ok(!appText.includes("accountOpen")); // Home no longer hosts duplicate wallet/trading controls.
  assert.ok(
    !appText.includes("<C3Summary") && !appText.includes("<UpcomingIndices"),
  );
});
