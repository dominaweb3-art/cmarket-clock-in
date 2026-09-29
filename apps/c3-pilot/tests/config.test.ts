import assert from "node:assert/strict";
import { test } from "node:test";
import {
  C3_MAINNET_EXECUTION_ENABLED,
  C3_PILOT_EXECUTION_ENABLED,
  parsePilotConfig,
} from "../src/config.ts";
import { languages, translations } from "../src/locales.ts";

const key = "2".repeat(32);
const complete = {
  EXPO_PUBLIC_C3_PILOT_CONFIG_VERSION: "local-pilot/v1",
  EXPO_PUBLIC_C3_PILOT_CLUSTER: "local-validator",
  EXPO_PUBLIC_C3_PILOT_PROGRAM_ID: key,
  EXPO_PUBLIC_C3_PILOT_VAULT: key,
  EXPO_PUBLIC_C3_PILOT_SHARE_MINT: key,
  EXPO_PUBLIC_C3_PILOT_USDC_MINT: key,
  EXPO_PUBLIC_C3_PILOT_BACKEND_URL: "https://pilot.example.org",
  EXPO_PUBLIC_C3_PILOT_OWNER_ALLOWLIST: key,
  EXPO_PUBLIC_C3_PILOT_CONFIG_HASH: "a".repeat(64),
};
test("missing, malformed and Mainnet configuration fail closed", () => {
  assert.equal(parsePilotConfig({}, true), null);
  assert.equal(
    parsePilotConfig(
      { ...complete, EXPO_PUBLIC_C3_PILOT_CLUSTER: "mainnet-beta" },
      true,
    ),
    null,
  );
  assert.equal(
    parsePilotConfig(
      { ...complete, EXPO_PUBLIC_C3_PILOT_BACKEND_URL: "http://10.0.2.2:3000" },
      true,
    ),
    null,
  );
  assert.equal(
    parsePilotConfig(
      { ...complete, EXPO_PUBLIC_C3_PILOT_CONFIG_HASH: "bad" },
      true,
    ),
    null,
  );
  assert.equal(parsePilotConfig(complete, true)?.cluster, "local-validator");
  assert.equal(C3_PILOT_EXECUTION_ENABLED, false);
  assert.equal(C3_MAINNET_EXECUTION_ENABLED, false);
});
test("all four languages have every English key", () => {
  const base = Object.keys(translations.en).sort();
  for (const language of languages)
    assert.deepEqual(Object.keys(translations[language]).sort(), base);
});
