import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("compiled package exports only the read-only facade", async () => {
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  assert.equal(manifest.exports["."].default, "./dist/public.js");
  const packageRoot = new URL("..", import.meta.url);
  const entry = await import(
    new URL("../dist/public.js", import.meta.url).href
  );
  assert.deepEqual(Object.keys(entry), ["getC3ServiceStatus"]);
  assert.equal(entry.getC3ServiceStatus().mainnetExecutionEnabled, false);
  assert.throws(() => require.resolve(`${manifest.name}/dist/builder.js`));
  assert.ok(packageRoot);
  const files = readdirSync(new URL("../dist/", import.meta.url));
  assert.equal(files.includes("index.js"), false);
  assert.equal(
    files.some((name) => /fixture|fake|\.map$/.test(name)),
    false,
  );
  for (const name of files.filter((item) => item.endsWith(".js"))) {
    const source = readFileSync(
      new URL(`../dist/${name}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    );
    assert.doesNotMatch(
      source,
      /(?:from|require\()["'](?:react-native|expo|@solana-mobile)/,
    );
  }
});

test("production artifact and package physically exclude synthetic builder state", () => {
  const build = JSON.parse(
    readFileSync(new URL("../tsconfig.build.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(build.include, ["src/**/*.ts"]);
  assert.ok(build.exclude.includes("tests"));
  for (const name of readdirSync(new URL("../src/", import.meta.url))) {
    if (!name.endsWith(".ts")) continue;
    const source = readFileSync(
      new URL(`../src/${name}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:tests|support|fixture|synthetic)[^"']*["']/,
    );
  }
  const names = readdirSync(new URL("../dist/", import.meta.url));
  const forbidden =
    /authorizationContexts|authorizationRecords|manifestEvidenceRegistry|InMemoryManifestRepository|snapshotRepository|c3\.deposit-intent\.disabled-validation|synthetic-(?:builder|accounting|persistence|reconciliation|keeper|manifest)|tests\/support|Uint8Array\.of\(1,\s*2,\s*3,\s*4\)/;
  for (const name of names) {
    assert.match(name, /\.(?:js|d\.ts)$/);
    assert.doesNotMatch(name, /builder\.js|fixture|synthetic/);
    assert.doesNotMatch(
      readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8"),
      forbidden,
      `Synthetic implementation escaped into dist/${name}`,
    );
  }
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, "npm pack dry-run failed");
  const files = JSON.parse(packed.stdout)[0].files.map((entry) => entry.path);
  assert.ok(files.includes("dist/postgres.js"));
  assert.ok(files.includes("dist/public.js"));
  assert.ok(files.every((file) => !/^(?:tests|scripts|src)\//.test(file)));
  assert.ok(files.every((file) => !/synthetic|fixture|builder\.js/.test(file)));
});

test("production authorization creation cannot use synthetic memory or caller policy", async () => {
  const { PostgresC3Repository } = await import("../dist/postgres.js");
  const repository = Object.create(PostgresC3Repository.prototype);
  await assert.rejects(
    repository.createAuthorization("c3-" + "a".repeat(32), 2n),
    /C3_PRODUCTION_POLICY_NOT_CONFIGURED/,
  );
});

test("Symmetry transaction research is excluded from all production entrypoints", async () => {
  const build = JSON.parse(
    readFileSync(new URL("../tsconfig.build.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(build.include, ["src/**/*.ts"]);
  assert.ok(build.exclude.includes("tests"));
  const names = readdirSync(new URL("../dist/", import.meta.url));
  assert.ok(
    names.every(
      (name) =>
        !/research|symmetry-v3|observed-transactions|fixture/.test(name),
    ),
  );
  for (const name of names.filter((item) => /\.(?:js|d\.ts)$/.test(item))) {
    const source = readFileSync(
      new URL(`../dist/${name}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /research\/symmetry-v3|symmetry-v3-observed-transactions|decodePublicFixture|reconcileObservedCandidate/,
    );
  }
  const constants = await import("../dist/constants.js");
  assert.equal(constants.C3_MAINNET_EXECUTION_CAPABILITY, false);
  const symmetry = await import("../dist/symmetry.js");
  assert.deepEqual(
    symmetry.symmetryAdapterRegistryStatus().enabledAdapterIds,
    [],
  );
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(packed.status, 0);
  const files = JSON.parse(packed.stdout)[0].files.map((item) => item.path);
  assert.ok(
    files.every(
      (file) => !/research|fixture|observed-transactions|\.map$/.test(file),
    ),
  );
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  const mobile = new URL("../../../apps/mobile/", import.meta.url);
  const walk = (directory) =>
    readdirSync(directory).flatMap((name) => {
      if (["node_modules", ".expo", "android", "dist"].includes(name))
        return [];
      const item = new URL(
        `${name}${statSync(new URL(name, directory)).isDirectory() ? "/" : ""}`,
        directory,
      );
      return statSync(item).isDirectory()
        ? walk(item)
        : /\.(?:ts|tsx|js|jsx)$/.test(name)
          ? [item]
          : [];
    });
  for (const file of walk(mobile))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /(?:from|require\()[^\n]*research\/symmetry-v3/,
    );
});
