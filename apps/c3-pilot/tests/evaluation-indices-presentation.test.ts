import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { indicesText } from "../src/evaluation-indices-copy.ts";
import { saleCopy } from "../src/evaluation-sale-copy.ts";
import {
  localizedUnits,
  presentationLimits,
  presentationAction,
  positionSummary,
} from "../src/evaluation-indices-presentation.ts";
import { indicesView } from "../src/evaluation-indices-state.ts";
import {
  presentationCopy,
  presentationText,
} from "../src/evaluation-indices-presentation-copy.ts";
import {
  EVALUATION_ROUND_LIMIT,
  validatePurchaseReview,
} from "../src/evaluation-purchase.ts";
const wallet = "owner";
const p = (extra: Record<string, unknown> = {}) => ({
  wallet,
  cluster: "solana:devnet",
  simulatedAssets: true,
  monetaryValue: false,
  finalizedSlot: 123,
  lifecycle: 2,
  shares: "10000000",
  deposited: "10000000",
  claimable: "0",
  returned: "0",
  minimumPurchase: "1000000",
  maximumPurchase: "200000000",
  availableUsdc: "190990000",
  round: "2",
  settlementReleased: true,
  allowedActions: ["request_redemption"],
  pendingRequests: [],
  ...extra,
});
test("localized units preserve exact amounts, six decimals and values beyond Number precision", () => {
  assert.equal(localizedUnits("10000000", "es"), "10");
  assert.equal(localizedUnits("10009900", "es"), "10,0099");
  assert.equal(localizedUnits("1000000000000", "en"), "1,000,000");
  assert.equal(localizedUnits("1000000000000", "pt-BR"), "1.000.000");
  assert.equal(
    localizedUnits("9007199254740993123456", "en"),
    "9,007,199,254,740,993.123456",
  );
  assert.equal(localizedUnits("-24200", "es"), "−0,0242");
  for (const value of [undefined, "", "01", "1.2", "NaN", 0])
    assert.equal(localizedUnits(value, "en"), "—");
});
test("one owned summary separates deposit, shares, pending issuance and actual proceeds", () => {
  assert.deepEqual(positionSummary(wallet, true, p()), {
    empty: false,
    deposited: "10000000",
    shares: "10000000",
    received: null,
    claimable: null,
  });
  assert.equal(
    positionSummary(
      wallet,
      true,
      p({ lifecycle: 1, shares: "0", allowedActions: [] }),
    )?.shares,
    null,
  );
  assert.equal(
    positionSummary(wallet, true, p({ shares: undefined }))?.shares,
    null,
  );
  assert.equal(positionSummary(wallet, true, p({ shares: "0" }))?.shares, null);
  assert.deepEqual(
    positionSummary(
      wallet,
      true,
      p({
        lifecycle: 0,
        shares: "0",
        deposited: "0",
        allowedActions: ["deposit"],
      }),
    ),
    { empty: true },
  );
  assert.equal(
    positionSummary(
      wallet,
      true,
      p({ lifecycle: 4, shares: "0", returned: "9900000", allowedActions: [] }),
    )?.received,
    "9900000",
  );
  assert.equal(
    positionSummary(wallet, true, p({ lifecycle: 4, returned: "9900000" })),
    null,
  );
  for (const extra of [
    { wallet: "other" },
    { cluster: "solana:mainnet" },
    { finalizedSlot: 0 },
    { deposited: "bad" },
  ])
    assert.equal(positionSummary(wallet, true, p(extra)), null);
  assert.equal(positionSummary(wallet, false, p()), null);
});
test("current vault caps and repetition come from scoped configuration, never an old fixed deposit", () => {
  assert.equal(presentationLimits(wallet, true, p())?.maximum, "200000000");
  assert.equal(
    presentationLimits(wallet, true, p({ maximumPurchase: "1000000000000" }))
      ?.maximum,
    "1000000000000",
  );
  assert.equal(
    presentationLimits(wallet, true, p({ maximumPurchase: "1000000" }))
      ?.maximum,
    "1000000",
  );
  for (const extra of [
    { maximumPurchase: undefined },
    { round: "11" },
    { minimumPurchase: "0" },
    { maximumPurchase: "bad" },
    { wallet: "other" },
  ])
    assert.equal(presentationLimits(wallet, true, p(extra)), null);
  assert.equal(EVALUATION_ROUND_LIMIT, 10n);
  validatePurchaseReview({ amount: 1_000_000n, round: EVALUATION_ROUND_LIMIT });
  assert.throws(() =>
    validatePurchaseReview({
      amount: 1_000_000n,
      round: EVALUATION_ROUND_LIMIT + 1n,
    }),
  );
});
test("single primary action preserves reviewed connection, transaction and recovery branches", () => {
  const action = (
    record: Record<string, unknown> | null,
    busy = false,
    validAmount = true,
  ) =>
    presentationAction(
      indicesView(wallet, true, busy, record),
      busy,
      validAmount,
      presentationLimits(wallet, true, record),
    );
  assert.equal(
    presentationAction(
      indicesView(null, false, false, null),
      false,
      false,
      null,
    ).action,
    "wallet",
  );
  assert.equal(action(null).action, "provision");
  assert.equal(action(p()).action, "request_redemption");
  assert.equal(action(p(), true).action, "activity");
  assert.equal(
    action(p({ pendingRequests: [{ signature: "original" }] })).action,
    "activity",
  );
  assert.equal(
    action(p({ lifecycle: 1, allowedActions: ["issue_shares"] })).action,
    "issue_shares",
  );
  assert.equal(
    action(p({ lifecycle: 1, allowedActions: [] })).action,
    "advance",
  );
  assert.equal(
    action(p({ lifecycle: 3, allowedActions: ["claim"], claimable: "9900000" }))
      .action,
    "claim",
  );
  const completed = p({
    lifecycle: 4,
    shares: "0",
    returned: "9900000",
    allowedActions: [],
  });
  assert.equal(action(completed).action, "new_purchase");
  assert.equal(action({ ...completed, round: "10" }).action, "activity");
  assert.equal(action({ ...completed, finalizedSlot: 0 }).action, "activity");
  assert.equal(
    action(p({ lifecycle: 0, allowedActions: ["deposit"] }), false, false)
      .disabled,
    true,
  );
  assert.equal(action(p({ maximumPurchase: undefined })).disabled, true);
});
test("copy covers four languages; layout keeps actions and recovery ahead of flat information rows", () => {
  for (const copy of Object.values(presentationCopy)) {
    assert.deepEqual(Object.keys(copy), Object.keys(presentationCopy.en));
    assert.ok(Object.values(copy).every((v) => v.trim().length > 0));
    assert.match(copy.conditionsBody, /Devnet/);
    assert.match(copy.compositionBody, /40%.*30%.*30%/);
    assert.ok(
      copy.range.includes("{minimum}") && copy.range.includes("{maximum}"),
    );
    assert.ok(
      copy.repeat.includes("{round}") && copy.repeat.includes("{rounds}"),
    );
  }
  const source = readFileSync(
    new URL("../src/EvaluationIndices.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    (source.match(/testID="indices-primary-action"/g) ?? []).length,
    1,
  );
  assert.ok(
    source.indexOf("evaluationTargets.map") <
      source.indexOf("<EvaluationPosition"),
  );
  assert.ok(
    source.indexOf("indices-primary-action") <
      source.indexOf("<EvaluationMarketReference"),
  );
  assert.ok(
    source.indexOf("{state.recover ?") < source.indexOf("indices-about-c3"),
  );
  assert.match(source, /useState<string \| null>\(null\)/);
  assert.match(source, /previous === key \? null : key/);
  assert.match(source, /fontScale <= 1\.2/);
  for (const forbidden of [
    "fetch(",
    "evaluationRequest",
    "signEvaluation",
    "useEffect",
    "s.tradeActions",
  ])
    assert.ok(!source.includes(forbidden));
});
test("actual primary-label and press expressions preserve all locales and cannot dispatch when disabled", () => {
  // Execute only source presentation expressions with an inert action recorder.
  // This is not native rendering, a physical signature or a blockchain test.
  const text = readFileSync(
    new URL("../src/EvaluationIndices.tsx", import.meta.url),
    "utf8",
  );
  const file = ts.createSourceFile(
    "index.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let labelExpression = "",
    pressExpression = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === "label" &&
      node.initializer
    )
      labelExpression = node.initializer.getText(file);
    if (
      ts.isJsxOpeningElement(node) &&
      node.attributes.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.name.getText(file) === "testID" &&
          a.initializer?.getText(file) === '"indices-primary-action"',
      )
    ) {
      for (const a of node.attributes.properties)
        if (
          ts.isJsxAttribute(a) &&
          a.name.getText(file) === "onPress" &&
          a.initializer &&
          ts.isJsxExpression(a.initializer) &&
          a.initializer.expression
        )
          pressExpression = a.initializer.expression.getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(labelExpression && pressExpression);
  const evaluate = (expression: string, bindings: Record<string, unknown>) =>
    new Function(
      ...Object.keys(bindings),
      ts.transpileModule("const value = " + expression + ";", {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText + "return value;",
    )(...Object.values(bindings));
  const cases = [
    { wallet: null, verified: false, record: null, key: "connect" },
    { wallet, verified: false, record: null, key: "verify" },
    { wallet, verified: true, record: null, key: "funds" },
    {
      wallet,
      verified: true,
      record: p({ lifecycle: 0, allowedActions: ["deposit"] }),
      key: "buy",
    },
    { wallet, verified: true, record: p(), key: "sell" },
    {
      wallet,
      verified: true,
      record: p({ lifecycle: 1, allowedActions: ["issue_shares"] }),
      key: "issue",
    },
    {
      wallet,
      verified: true,
      record: p({ lifecycle: 1, allowedActions: [] }),
      key: "continue",
    },
    {
      wallet,
      verified: true,
      record: p({ lifecycle: 3, allowedActions: ["claim"] }),
      key: "claim",
    },
    {
      wallet,
      verified: true,
      record: p({
        lifecycle: 4,
        returned: "9900000",
        round: "10",
        allowedActions: [],
      }),
      key: "activity",
    },
  ];
  for (const language of Object.keys(
    presentationCopy,
  ) as (keyof typeof presentationCopy)[])
    for (const c of cases) {
      const state = indicesView(c.wallet, c.verified, false, c.record);
      const primary = presentationAction(
        state,
        false,
        true,
        presentationLimits(c.wallet, c.verified, c.record),
      );
      const t = (key: keyof typeof presentationCopy.en) =>
        presentationText(language, key);
      const label = evaluate(labelExpression, {
        primary,
        state,
        language,
        t,
        indicesText,
        sale: saleCopy[language],
      });
      assert.equal(
        label,
        c.key === "sell"
          ? saleCopy[language].sell
          : c.key === "connect" || c.key === "verify"
            ? indicesText(language, c.key)
            : t(c.key as keyof typeof presentationCopy.en),
      );
      const recorded: unknown[] = [];
      const onAction = (action: unknown) => recorded.push(action);
      (evaluate(pressExpression, { primary, onAction }) as () => void)();
      assert.deepEqual(recorded, primary.disabled ? [] : [primary.action]);
      recorded.length = 0;
      (
        evaluate(pressExpression, {
          primary: { ...primary, disabled: true },
          onAction,
        }) as () => void
      )();
      assert.equal(recorded.length, 0);
    }
});
