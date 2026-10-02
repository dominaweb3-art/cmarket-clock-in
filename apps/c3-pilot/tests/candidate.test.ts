import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  MAINNET_MONETARY_CAPABILITY,
  APPROVED_CANDIDATE_CONFIGURATION,
  requireCandidateMoneyGate,
  candidateHttpsEndpoint,
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
  assert.doesNotMatch(
    app,
    /from\s+["']\.\/(?:LocalCyclePanel|backend|local-cycle)["']/,
  );
  const wallet = readFileSync(
    new URL("../src/candidate-wallet.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(wallet, /wallet\.(?:sign|send)/);
  const config = JSON.parse(
    readFileSync(
      new URL("../variants/mainnet/app.json", import.meta.url),
      "utf8",
    ),
  ).expo;
  assert.equal(config.android.package, "com.dominaweb3.cmarket.c3candidate");
  assert.equal(config.extra.mainnetMonetaryCapability, false);
});
