import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MAINNET_MONETARY_CAPABILITY,
  APPROVED_CANDIDATE_CONFIGURATION,
  requireCandidateMoneyGate,
  candidateHttpsEndpoint,
  runCandidateMonetarySession,
} from "../src/candidate-config.ts";
import {
  candidateLanguages,
  candidateTranslations,
} from "../src/candidate-locales.ts";
test("candidate capability cannot be enabled by env, storage or a URL", () => {
  assert.equal(MAINNET_MONETARY_CAPABILITY, false);
  assert.equal(APPROVED_CANDIDATE_CONFIGURATION, null);
  assert.throws(requireCandidateMoneyGate, /NOT_APPROVED/);
  for (const v of [
    undefined,
    "http://127.0.0.1:8787",
    "http://10.0.2.2:8899",
    "https://a:b@example.org",
    "https://example.org?enable=true",
  ])
    assert.equal(candidateHttpsEndpoint(v), null);
  for (const l of candidateLanguages)
    assert.deepEqual(
      Object.keys(candidateTranslations[l]).sort(),
      Object.keys(candidateTranslations.en).sort(),
    );
});
test("entrypoint physically excludes clone launcher and signing callbacks", () => {
  const entry = readFileSync(
    new URL("../variants/mainnet/index.js", import.meta.url),
    "utf8",
  );
  assert.match(entry, /MainnetCandidateApp/);
  const app = readFileSync(
    new URL("../src/MainnetCandidateApp.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /<Text style=\{s\.notice\}>\{t\.singlePosition\}<\/Text>/);
  assert.ok(
    app.indexOf("{t.singlePosition}") < app.indexOf("{tab ==="),
    "restrictions must be visible before wallet or position state",
  );
  assert.doesNotMatch(
    app,
    /from\s+["']\.\/(?:LocalCyclePanel|backend|local-cycle)["']/,
  );
  const wallet = readFileSync(
    new URL("../src/candidate-wallet.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(wallet, /wallet\.(?:signAndSend|send)/);
  const signing = wallet.slice(
    wallet.indexOf("export async function requestCandidateMonetarySignature"),
  );
  assert.ok(
    signing.indexOf("requireCandidateMoneyGate();") <
      signing.indexOf("return runCandidateMonetarySession("),
  );
  assert.match(signing, /wallet\.signTransactions/);
  const config = JSON.parse(
    readFileSync(
      new URL("../variants/mainnet/app.json", import.meta.url),
      "utf8",
    ),
  ).expo;
  assert.equal(config.android.package, "com.dominaweb3.cmarket.c3candidate");
  assert.equal(config.extra.mainnetMonetaryCapability, false);
});
test("direct monetary entry cannot invoke even a mock MWA session", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runCandidateMonetarySession(async () => {
        calls++;
        return "signed";
      }),
    /NOT_APPROVED/,
  );
  assert.equal(calls, 0);
});
