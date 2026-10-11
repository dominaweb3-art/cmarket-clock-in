import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  evaluationTabs,
  evaluationTargets,
  visualText,
} from "../src/evaluation-visual-copy.ts";
import { languages } from "../src/locales.ts";

test("visual targets are exactly 40/30/30 and remain labelled as evaluation in every locale", () => {
  assert.deepEqual(
    evaluationTargets.map((a) => [a.symbol, a.percent]),
    [
      ["BTC", 40],
      ["ETH", 30],
      ["SOL", 30],
    ],
  );
  assert.equal(
    evaluationTargets.reduce((n, a) => n + a.percent, 0),
    100,
  );
  for (const language of languages) {
    for (const key of [
      "demo",
      "index",
      "buy",
      "what",
      "description",
      "allocation",
      "more",
      "soon",
      "markets",
      "account",
      "position",
      "controls",
      "details",
      "back",
      "activityHint",
      "verifiedOnly",
      "test",
      "stepHint",
      "view",
      "goals",
    ] as const) {
      assert.ok(visualText(language, key).trim().length > 0);
    }
    assert.match(visualText(language, "demo"), /Devnet/);
    assert.ok(visualText(language, "test"));
  }
});

test("static navigation structure is outside scroll content and contains only the three existing screens", () => {
  assert.deepEqual(evaluationTabs, ["home", "indices", "activity"]);
  const app = readFileSync(
    new URL("../src/DevnetEvaluationApp.tsx", import.meta.url),
    "utf8",
  );
  const visuals = readFileSync(
    new URL("../src/EvaluationVisuals.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    app.indexOf("<BottomNavigation") > app.lastIndexOf("</ScrollView>"),
  );
  assert.match(visuals, /accessibilityRole="tab"/);
  assert.match(visuals, /accessibilityState=\{\{ selected: tab === value \}\}/);
  assert.match(app, /value === "home"|tab === "home"/);
  assert.match(app, /tab !== "indices" && styles.hidden/);
  assert.match(app, /tab !== "activity" && styles.hidden/);
  assert.match(app, /<EmptyActivity language=\{language\}/);
  assert.match(app, /item.effects_verified === true/);
  assert.match(app, /cluster=devnet/);
  // Structure only; this does not attest physical layout or device QA.
});
