import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { C3_MAINNET_ASSET_REGISTRY } from "../../src/registry.ts";

const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../../config/c3/c3-oracle-nav-candidate.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../../../config/c3/c3-oracle-nav-candidate.schema.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("strict manifest schema and disabled policy agree", () => {
  assert.deepEqual(Object.keys(manifest).sort(), [...schema.required].sort());
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.status.const, "blocked");
  assert.equal(schema.properties.mainnetExecutionEnabled.const, false);
  assert.equal(schema.properties.readinessResult.const, "NO-GO");
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.mainnetExecutionEnabled, false);
  assert.equal(
    manifest.allocationBps.cbBTC +
      manifest.allocationBps.PortalETH +
      manifest.allocationBps.WSOL,
    10_000,
  );
  assert.equal(manifest.pilotCandidatesDisabled.minimumPerWalletUsdc, "1");
  assert.equal(manifest.pilotCandidatesDisabled.aggregateTvlCapUsdc, "3");
  assert.equal(manifest.pilotCandidatesDisabled.feesEnabled, false);
  assert.equal(manifest.pilotCandidatesDisabled.limitsEnabled, false);
  for (const asset of ["USDC", "cbBTC", "PortalETH", "WSOL"] as const) {
    assert.deepEqual(
      Object.keys(manifest.assets[asset]).sort(),
      [...schema.$defs.asset.required].sort(),
    );
    assert.equal(
      manifest.assets[asset].mint,
      C3_MAINNET_ASSET_REGISTRY[asset].mint,
    );
    assert.equal(
      manifest.assets[asset].decimals,
      C3_MAINNET_ASSET_REGISTRY[asset].decimals,
    );
    assert.equal(
      manifest.assets[asset].referenceFeedId,
      C3_MAINNET_ASSET_REGISTRY[asset].oracleFeedId,
    );
    assert.deepEqual(
      Object.keys(manifest.assets[asset].priceEvidence).sort(),
      [...schema.$defs.priceEvidence.required].sort(),
    );
    assert.equal(manifest.assets[asset].priceEvidence.cluster, "mainnet-beta");
    for (const key of [
      "retrievedAt",
      "feedAccountId",
      "exponent",
      "confidence",
      "publishTime",
      "observedPrice",
      "evidenceHash",
    ])
      assert.equal(manifest.assets[asset].priceEvidence[key], null);
  }
  for (const key of [
    "feedObservations",
    "feedExponent",
    "feedConfidence",
    "feedPublicationTime",
    "feedObservedPrice",
    "feedEvidenceHash",
  ])
    assert.equal(manifest.evidence[key], null);
});

test("readiness command enumerates blockers and never reports GO", () => {
  const run = spawnSync("node", ["scripts/oracle-readiness.mjs"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /NO-GO/);
  assert.doesNotMatch(run.stdout, /\bREADY\b/);
  for (const reason of manifest.missingEvidence)
    assert.ok(run.stdout.includes(reason));
});
