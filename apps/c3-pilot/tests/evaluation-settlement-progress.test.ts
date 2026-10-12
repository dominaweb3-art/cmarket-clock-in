import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import {
  canContinueSettlement,
  continueSettlement,
} from "../src/evaluation-settlement-progress.ts";
import { saleCopy } from "../src/evaluation-sale-copy.ts";
import { languages } from "../src/locales.ts";
import { indicesView } from "../src/evaluation-indices-state.ts";
import { homeOperation } from "../src/evaluation-home-state.ts";
const wallet = "DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej";
const p = (extra: Record<string, unknown> = {}) => ({
  wallet,
  cluster: "solana:devnet",
  simulatedAssets: true,
  monetaryValue: false,
  finalizedSlot: 510139387,
  settlementReleased: true,
  paused: false,
  lifecycle: 3,
  pendingRequests: [],
  pendingInitialPlan: null,
  allowedActions: [],
  shares: "10000000",
  returned: "0",
  ...extra,
});
test("continuation stops at explicit claim; it never approves, claims or burns for the user", async () => {
  let steps = 0;
  const result = await continueSettlement({
    wallet,
    initial: p(),
    advance: async () => {
      steps++;
      return { stage: "execute_effects_verified" };
    },
    position: async () =>
      p(steps === 3 ? { allowedActions: ["claim"], claimable: "9900000" } : {}),
    sleep: async () => undefined,
  });
  assert.equal(steps, 3);
  assert.equal(result, "owner");
  assert.equal(
    indicesView(wallet, true, false, p({ allowedActions: ["claim"] })).action,
    "claim",
  );
});
test("uncertain, failed, wrong scope, expired and pending outcomes never resend or auto-renew", async () => {
  for (const stage of ["uncertain", "failed"]) {
    let calls = 0;
    const promise = continueSettlement({
      wallet,
      initial: p(),
      advance: async () => {
        calls++;
        return { stage };
      },
      position: async () => p(),
      sleep: async () => undefined,
    });
    if (stage === "failed")
      await assert.rejects(promise, /EVAL_FINALIZED_OPERATION_FAILED/);
    else assert.equal(await promise, "uncertain");
    assert.equal(calls, 1);
  }
  for (const extra of [
    { wallet: "other" },
    { cluster: "solana:mainnet" },
    { paused: true },
    { monetaryValue: true },
    { simulatedAssets: false },
    { finalizedSlot: 0 },
    { settlementReleased: false },
    { pendingRequests: [{ signature: "original" }] },
    { pendingInitialPlan: { signature: "original" } },
    { allowedActions: ["issue_shares"] },
    { allowedActions: ["claim"] },
    { lifecycle: 2 },
    { lifecycle: 4 },
    { lifecycle: "3" },
  ]) {
    assert.equal(canContinueSettlement(wallet, p(extra)), false);
    assert.equal(
      await continueSettlement({
        wallet,
        initial: p(extra),
        advance: async () => {
          throw Error("UNEXPECTED_ADVANCE");
        },
        position: async () => {
          throw Error("UNEXPECTED_READ");
        },
        sleep: async () => undefined,
      }),
      "owner",
    );
  }
  let calls = 0;
  await assert.rejects(
    continueSettlement({
      wallet,
      initial: p(),
      advance: async () => {
        calls++;
        throw Error("EVAL_SERVICE_QUOTE_EXPIRED_RENEW_REQUIRED");
      },
      position: async () => p(),
      sleep: async () => undefined,
    }),
    /EXPIRED_RENEW_REQUIRED/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    continueSettlement({
      wallet,
      initial: p(),
      advance: async () => ({ stage: "record_effects_verified" }),
      position: async () => p({ wallet: "other" }),
      sleep: async () => undefined,
    }),
    /EVAL_POSITION_SCOPE/,
  );
});
test("restart reads the original durable position and bounded polling cannot run indefinitely", async () => {
  let calls = 0,
    reads = 0,
    sleeps = 0;
  assert.equal(
    await continueSettlement({
      wallet,
      initial: p(),
      advance: async () => {
        calls++;
        return { stage: "authorization_pending" };
      },
      position: async () => {
        reads++;
        return p();
      },
      sleep: async (ms) => {
        assert.equal(ms, 3000);
        sleeps++;
      },
    }),
    "uncertain",
  );
  assert.equal(calls, 48);
  assert.equal(reads, 48);
  assert.equal(sleeps, 48);
  calls = 0;
  assert.equal(
    await continueSettlement({
      wallet,
      initial: p({ allowedActions: ["claim"] }),
      advance: async () => {
        calls++;
        return {};
      },
      position: async () => p(),
      sleep: async () => undefined,
    }),
    "owner",
  );
  assert.equal(calls, 0);
});
test("closed position clears pending UI only after claim; receipt history is not deleted", () => {
  const pending = p({
    activity: [{ action: "request_redemption", effects_verified: true }],
  });
  assert.equal(homeOperation(wallet, true, false, pending), "selling");
  assert.equal(
    homeOperation(wallet, true, false, p({ allowedActions: ["claim"] })),
    "claiming",
  );
  const closed = p({ lifecycle: 4, shares: "0", returned: "9900000" });
  assert.equal(homeOperation(wallet, true, false, closed), null);
  assert.equal(indicesView(wallet, true, false, closed).title, "completed");
  assert.equal(
    indicesView(wallet, true, false, {
      ...closed,
      pendingRequests: [{ signature: "original" }],
    }).recover,
    true,
  );
});
test("mobile owner continuation is guarded by reconciled effects, not by submission alone", async () => {
  const source = readFileSync(
    new URL("../src/DevnetEvaluationApp.tsx", import.meta.url),
    "utf8",
  );
  const file = ts.createSourceFile(
    "app.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let declaration = "";
  function visit(n: ts.Node) {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(file) === "prepareWalletAction"
    )
      declaration = n.initializer!.getText(file);
    ts.forEachChild(n, visit);
  }
  visit(file);
  const output = ts.transpileModule(`const action = ${declaration};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const resultStatus of [
    "effects_verified",
    "already_reconciled",
    "uncertain",
  ]) {
    const calls: string[] = [],
      confirmations: (() => void)[] = [],
      executions: Promise<void>[] = [];
    const bindings = {
      wallet,
      verified: true,
      busy: false,
      purchaseAmount: "1",
      position: { deposited: "10000000", round: "2" },
      language: "en",
      t: (v: string) => v,
      displayUnits: (v: string) => v,
      purchaseCopy: { en: { invalid: "invalid" } },
      saleCopy,
      Alert: {
        alert: (
          _a: unknown,
          _b: unknown,
          buttons: { onPress?: () => void }[],
        ) => confirmations.push(buttons[1]!.onPress!),
      },
      run: (fn: () => Promise<void>) => {
        executions.push(fn());
      },
      session: { current: "isolated-test-token" },
      evaluationRequest: async (body: Record<string, unknown>) => {
        calls.push(String(body.operation));
        return body.operation === "reconcile"
          ? { status: resultStatus }
          : { requestId: "original", expiresAt: "2030-01-01T00:00:00Z" };
      },
      signEvaluationTransaction: async () => {
        calls.push("owner-sign");
        return new Uint8Array(0);
      },
      base64FromUint8Array: () => "fixture",
      waitForEvaluationNetwork: async () => undefined,
      setStatus: () => undefined,
      updatePosition: async () => p(),
      canContinueSettlement,
      advanceSettlement: async () => {
        calls.push("keeper-continuation");
      },
    };
    const action = new Function(
      ...Object.keys(bindings),
      `${output}\nreturn action;`,
    )(...Object.values(bindings));
    action("request_redemption");
    assert.equal(calls.length, 0); // Opening review never signs.
    confirmations[0]!();
    await Promise.all(executions);
    assert.deepEqual(calls, [
      "prepare",
      "owner-sign",
      "submit",
      "reconcile",
      ...(resultStatus === "uncertain" ? [] : ["keeper-continuation"]),
    ]);
  }
  assert.match(
    source,
    /const advance = \(\) => run\(\(\) => advanceSettlement\(\)\)/,
  );
  const balances = readFileSync(
    new URL("../src/EvaluationBalances.tsx", import.meta.url),
    "utf8",
  );
  assert.match(balances, /30_000/);
  assert.match(balances, /clearInterval\(timer\)/);
  assert.match(balances, /\[wallet, refresh, revision\]/);
});
test("sale quantities and completion instructions are present in all four languages", () => {
  for (const language of languages) {
    assert.deepEqual(Object.keys(saleCopy[language]), Object.keys(saleCopy.en));
    for (const text of Object.values(saleCopy[language]))
      assert.ok(text.trim());
    assert.ok(saleCopy[language].all.includes("{amount}"));
  }
});
