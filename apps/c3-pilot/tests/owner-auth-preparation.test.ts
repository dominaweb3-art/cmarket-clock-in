import assert from "node:assert/strict";
import { test } from "node:test";
import { authenticatedOwnerPreparation } from "../src/owner-backend.ts";
import type { OwnerBackend } from "../src/owner-controller.ts";

test("release preparation preserves explicit economic review across authentication", async () => {
  const calls: unknown[][] = [];
  const prepare = authenticatedOwnerPreparation(
    {
      prepare: async (...args) => {
        calls.push(args);
        return {} as Awaited<ReturnType<OwnerBackend["prepare"]>>;
      },
    },
    async () => {
      calls.push(["authentication"]);
    },
  );
  await prepare("intent", "renew_plan", true);
  assert.deepEqual(calls, [["authentication"], ["intent", "renew_plan", true]]);
  calls.length = 0;
  await prepare("intent", "renew_plan");
  assert.deepEqual(calls, [
    ["authentication"],
    ["intent", "renew_plan", false],
  ]);
  calls.length = 0;
  await assert.rejects(
    prepare("intent", "deposit", true),
    /C3_OWNER_RESPONSE_INVALID/,
  );
  assert.deepEqual(
    calls,
    [],
    "invalid economic scope cannot open authentication",
  );
});

test("failed authentication cannot prepare or request a signature", async () => {
  let prepared = 0;
  const prepare = authenticatedOwnerPreparation(
    {
      prepare: async () => {
        prepared++;
        return {} as Awaited<ReturnType<OwnerBackend["prepare"]>>;
      },
    },
    async () => {
      throw Error("owner rejected");
    },
  );
  await assert.rejects(prepare("intent", "renew_plan", true), /owner rejected/);
  assert.equal(prepared, 0);
});
