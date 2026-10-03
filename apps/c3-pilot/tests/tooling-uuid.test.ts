/** Build-tool compatibility regression; no files/projects written. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
test("pinned official uuid remains CommonJS-compatible with xcode generateUuid", () => {
  const require = createRequire(import.meta.url),
    xcode = require("xcode"),
    p = xcode.project("unwritten-test.pbxproj");
  p.allUuids = () => [];
  const fromXcode = createRequire(require.resolve("xcode"));
  assert.equal(fromXcode("uuid/package.json").version, "11.1.1");
  const ids = Array.from({ length: 1000 }, () => p.generateUuid());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[A-F0-9]{24}$/.test(id)));
});
