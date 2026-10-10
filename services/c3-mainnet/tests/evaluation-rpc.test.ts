import assert from "node:assert/strict";
import test from "node:test";
import { evaluationRpc } from "../src/evaluation-rpc.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
test("Devnet connections pace concurrent reads and NEVER retry a rate-limited dispatch", async (t) => {
  const starts: number[] = [];
  let sends = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (
      url: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ) => {
      assert.equal(String(url), "https://api.devnet.solana.com");
      starts.push(performance.now());
      const request = JSON.parse(String(init!.body));
      if (request.method === "sendTransaction") {
        sends++;
        return new Response("", { status: 429 });
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: EVALUATION.genesis,
        }),
        { status: 200 },
      );
    },
  );
  const a = evaluationRpc(),
    b = evaluationRpc();
  assert.deepEqual(
    await Promise.all([a.getGenesisHash(), b.getGenesisHash()]),
    [EVALUATION.genesis, EVALUATION.genesis],
  );
  assert.ok(starts[1]! - starts[0]! >= 500);
  await assert.rejects(
    () =>
      a.sendRawTransaction(Buffer.alloc(100), {
        maxRetries: 0,
        skipPreflight: false,
      }),
    /EVAL_RPC_RATE_LIMIT/,
  );
  assert.equal(sends, 1);
});
