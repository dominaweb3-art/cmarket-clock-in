import { test } from "node:test";
import assert from "node:assert/strict";
import { createCycleController } from "./cycle-controller.ts";
test("local controller rejects hostile requests and concurrent starts release once", async () => {
  const c = createCycleController(() => ({
    stage: "ready",
    confirmedLegs: 0,
    sharesIssued: "0",
    sharesBurned: "0",
    usdcReturned: "0",
  }));
  await new Promise<void>((r) => c.server.listen(0, "127.0.0.1", r));
  try {
    const address = c.server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/v1/c3/local-cycle`;
    assert.equal(
      (await fetch(url, { headers: { Origin: "https://evil.invalid" } }))
        .status,
      400,
    );
    const run = (await (await fetch(url)).json()) as {
      runId: string;
      token: string;
    };
    for (const value of [
      { ...run, wallet: "injected" },
      { runId: run.runId, token: "0".repeat(64) },
      { runId: "wrong", token: run.token },
    ])
      assert.equal(
        (
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(value),
          })
        ).status,
        400,
      );
    let starts = 0;
    void c.started.then(() => {
      starts++;
    });
    await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.runId, token: run.token }),
        }),
      ),
    );
    await c.started;
    assert.equal(starts, 1);
    c.finish(false);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.runId, token: run.token }),
    });
    assert.equal(
      ((await (await fetch(url)).json()) as { state: string }).state,
      "blocked",
    );
    assert.equal(starts, 1);
  } finally {
    await new Promise<void>((r) => c.server.close(() => r()));
  }
});
