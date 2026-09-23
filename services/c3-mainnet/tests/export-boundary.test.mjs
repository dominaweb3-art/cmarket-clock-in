import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";

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
