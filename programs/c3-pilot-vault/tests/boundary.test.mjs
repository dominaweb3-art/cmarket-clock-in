import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const here = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(here, "../..");
const idlPath = resolve(here, "target/idl/c3_pilot_vault.json");
const soPath = resolve(here, "target/deploy/c3_pilot_vault.so");

test("production artifact excludes local mock entrypoints and protects stable mobile/Symmetry", () => {
  assert.ok(
    existsSync(idlPath) && existsSync(soPath),
    "run a default-feature Anchor build first",
  );
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));
  const names = idl.instructions.map((ix) => ix.name);
  assert.equal(
    names.some((name) => /mock|probe/i.test(name)),
    false,
    "mock instruction must be absent from production IDL",
  );
  for (const lifecycle of [
    "create_deposit_intent",
    "deposit_usdc",
    "create_deposit_settlement_plan",
    "authorize_swap_leg",
    "execute_swap_leg",
    "record_deposit_settlement",
    "issue_initial_shares",
    "create_redemption_intent",
    "create_redemption_settlement_plan",
    "record_redemption_settlement",
    "claim_usdc",
  ]) {
    assert.equal(
      names.includes(lifecycle),
      true,
      `${lifecycle} must be present but disabled in the production IDL`,
    );
  }
  const so = readFileSync(soPath);
  for (const marker of [
    "MOCK_LOCAL_ONLY",
    "mock_settle_deposit",
    "mock_settle_redemption",
    "local_jupiter_probe",
    "ISOLATED_JUPITER_CPI",
    "c3-ordered-fork-v1",
    "7dfvugVLSaDFrXF6i2SbNji5vJmCvKP9grj4Nh8EysfZ",
  ]) {
    assert.equal(
      so.includes(Buffer.from(marker)),
      false,
      `production binary contains ${marker}`,
    );
  }
  const changed = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" },
  );
  for (const line of changed.split("\n").filter(Boolean)) {
    const path = line.slice(3);
    assert.equal(
      path.startsWith("apps/mobile/"),
      false,
      "stable mobile file changed",
    );
    assert.equal(
      path.startsWith("services/c3-symmetry-builder/"),
      false,
      "preserved Symmetry builder changed",
    );
    assert.equal(
      path === "services/c3-mainnet/src/symmetry.ts",
      false,
      "frozen Symmetry provider changed",
    );
    // C3V2 intentionally adds server-only Jupiter validation to c3-mainnet.
  }
  const constants = readFileSync(
    resolve(here, "programs/c3_pilot_vault/src/constants.rs"),
    "utf8",
  );
  assert.match(
    constants,
    /#\[cfg\(not\(any\(feature = "local-mock", feature = "local-jupiter-cycle"\)\)\)\][\s\S]*?ROUTER_EXECUTION_ENABLED: bool = false/,
    "default build must disable all economic execution",
  );
  const source = readFileSync(
    resolve(here, "programs/c3_pilot_vault/src/lib.rs"),
    "utf8",
  );
  assert.match(
    source,
    /require!\(ROUTER_EXECUTION_ENABLED, VaultError::SwapDisabled\)/,
  );
  assert.match(
    source,
    /#\[cfg\(feature = "local-mock"\)\]/,
    "mock entrypoint must be feature-gated",
  );
});

test("local-only configuration and tracked-file boundary remain closed", () => {
  const anchorConfig = readFileSync(resolve(here, "Anchor.toml"), "utf8");
  const cargoConfig = readFileSync(
    resolve(here, "programs/c3_pilot_vault/Cargo.toml"),
    "utf8",
  );
  const packageConfig = readFileSync(resolve(here, "package.json"), "utf8");
  assert.match(anchorConfig, /cluster = "localnet"/);
  assert.doesNotMatch(
    anchorConfig,
    /\[programs\.mainnet\]|mainnet-beta|devnet/,
  );
  assert.match(cargoConfig, /default = \[\]/);
  assert.match(cargoConfig, /local-mock = \[\]/);
  assert.doesNotMatch(packageConfig, /@symmetry-hq\/sdk|pyth|mainnet/i);
  const visible = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  );
  for (const path of visible.split("\n").filter(Boolean)) {
    if (path === ".env.example" || path.endsWith("/.env.example")) continue;
    assert.doesNotMatch(
      path,
      /(^|\/)(?:\.env(?:\.|$)|.*(?:keypair|keystore|private-key|local-test-wallet).*(?:\.json|\.pem|\.p12|\.jks)$)/i,
    );
    assert.equal(
      path.startsWith("programs/c3-pilot-vault/target/"),
      false,
      "generated program artifact exposed",
    );
  }
});
