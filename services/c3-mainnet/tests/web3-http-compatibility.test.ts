import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Connection, PublicKey } from "@solana/web3.js";

// Only the server package is overridden. No wallet, network, signatures or sends.
const require = createRequire(import.meta.url);
test("official jayson pin removes vulnerable implementations, not just advisory output", () => {
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  assert.equal(lock.packages["node_modules/jayson"].version, "5.0.0");
  assert.equal(
    lock.packages["node_modules/jayson"].integrity,
    "sha512-FghxOWlJB5ZPsRsuMF1U4GFHjkJfOEYSlIHpI6Wt6MXIzvqWVo0Kpl7/SMfY36vWggA+b+L09zRGP6m4ROVnKg==",
  );
  for (const path of Object.keys(lock.packages)) {
    assert.doesNotMatch(
      path,
      /(?:^|\/)(?:stream-json|stream-chain|bigint-buffer|@solana\/spl-token|@solana\/buffer-layout-utils)$/,
    );
    if (/(?:^|\/)uuid$/.test(path))
      assert.notEqual(lock.packages[path].version, "8.3.2");
  }
  assert.throws(() => require.resolve("stream-json"));
});

test("unchanged web3 HTTP client preserves IDs, nulls, batches and RPC errors", async () => {
  const seen: { id: string; method: string }[] = [];
  let mode = "healthy";
  const connection = new Connection("https://rpc.invalid", {
    disableRetryOnRateLimit: true,
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const reply = (r: { id: string; method: string }) => {
        assert.equal(typeof r.id, "string");
        assert.ok(r.id.length > 0);
        seen.push(r);
        if (mode === "error")
          return {
            jsonrpc: "2.0",
            id: r.id,
            error: { code: -32000, message: "isolated error" },
          };
        if (r.method === "getGenesisHash")
          return { jsonrpc: "2.0", id: r.id, result: "isolated-genesis" };
        if (r.method === "getTransaction")
          return { jsonrpc: "2.0", id: r.id, result: null };
        if (r.method === "getBalance")
          return {
            jsonrpc: "2.0",
            id: r.id,
            result: { context: { slot: 42 }, value: 100 },
          };
        throw Error("unexpected read-only RPC method");
      };
      return new Response(
        JSON.stringify(
          Array.isArray(request) ? request.map(reply) : reply(request),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.equal(await connection.getGenesisHash(), "isolated-genesis");
  assert.equal(
    await connection.getBalance(
      new PublicKey("11111111111111111111111111111111"),
    ),
    100,
  );
  assert.equal(
    await connection.getTransaction("1".repeat(64), {
      maxSupportedTransactionVersion: 0,
    }),
    null,
  );
  assert.deepEqual(
    await connection.getTransactions(["1".repeat(64), "2".repeat(64)], {
      maxSupportedTransactionVersion: 0,
    }),
    [null, null],
  );
  mode = "error";
  await assert.rejects(() => connection.getGenesisHash(), /isolated error/);
  assert.equal(seen.length, 6);
  assert.equal(new Set(seen.map((r) => r.id)).size, 6);
  assert.ok(
    seen.every((r) =>
      ["getGenesisHash", "getBalance", "getTransaction"].includes(r.method),
    ),
  );
});
