import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOwnerIntent } from "../src/owner-intent.ts";
const wallet = "FnkzNN99YHhoR6Lu5kfnYj5X4ULLqoKTyi5P5xpBJhAZ";
const scope = {
  wallet,
  program: wallet,
  vault: wallet,
  policyHash: "a".repeat(64),
  registryRevision: "1",
  quotePolicyRevision: "1",
};
const origin = "https://cmarket.example.org";
const intentId = "11111111-1111-4111-8111-111111111111";
const receipt = (state: string) =>
  JSON.stringify({
    version: "c3-owner/v1",
    wallet,
    intentId,
    requestId: "22222222-2222-4222-8222-222222222222",
    messageHash: "b".repeat(64),
    action: "deposit",
    state,
    signature: ["signed", "uncertain", "finalized"].includes(state)
      ? "3".repeat(88)
      : null,
  });
test("new enrollment persists only the policy-bound public locator; restart and active-position recovery never reenroll", async () => {
  let locator: string | null = null,
    calls = 0;
  const enroll = async () => {
    calls++;
    return intentId;
  };
  const save = async (r: string) => {
    locator = r;
  };
  assert.equal(
    await resolveOwnerIntent(
      origin,
      scope,
      null,
      null,
      true,
      true,
      enroll,
      save,
    ),
    intentId,
  );
  assert.equal(calls, 1);
  assert.equal(
    await resolveOwnerIntent(
      origin,
      scope,
      locator,
      receipt("uncertain"),
      false,
      false,
      enroll,
      save,
    ),
    intentId,
  );
  assert.equal(
    await resolveOwnerIntent(
      origin,
      scope,
      locator,
      receipt("finalized"),
      false,
      true,
      enroll,
      save,
    ),
    intentId,
  );
  assert.equal(calls, 1);
  assert.doesNotMatch(locator!, /signature|messageHash|payload|token/);
  // Backward compatible public ID from a valid receipt, never a new admission.
  assert.equal(
    await resolveOwnerIntent(
      origin,
      scope,
      null,
      receipt("finalized"),
      false,
      false,
      enroll,
      save,
    ),
    intentId,
  );
  assert.equal(calls, 1);
});
test("pending receipts reject prepare before any enrollment signature/quota/write; explicit sign-in can recover known intent", async () => {
  let calls = 0;
  const forbidden = async () => {
    calls++;
    throw Error("unexpected wallet/write");
  };
  for (const state of ["review", "authorizing", "signed", "uncertain"]) {
    await assert.rejects(
      () =>
        resolveOwnerIntent(
          origin,
          scope,
          null,
          receipt(state),
          true,
          true,
          forbidden,
          forbidden,
        ),
      /RECONCILE_REQUIRED/,
    );
    assert.equal(
      await resolveOwnerIntent(
        origin,
        scope,
        null,
        receipt(state),
        false,
        false,
        forbidden,
        forbidden,
      ),
      intentId,
    );
  }
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      resolveOwnerIntent(
        origin,
        scope,
        null,
        null,
        false,
        false,
        forbidden,
        forbidden,
      ),
    /ENROLLMENT_REQUIRED/,
  );
  assert.equal(calls, 0);
});
test("corrupt, cross-scope, extra-field and conflicting locators fail closed without deleting receipt or opening wallet", async () => {
  let locator = "",
    calls = 0;
  await resolveOwnerIntent(
    origin,
    scope,
    null,
    null,
    false,
    true,
    async () => intentId,
    async (r) => {
      locator = r;
    },
  );
  const record = JSON.parse(locator);
  const forbidden = async () => {
    calls++;
    throw Error("unexpected");
  };
  for (const field of Object.keys(record).filter((k) => k !== "intentId")) {
    await assert.rejects(
      () =>
        resolveOwnerIntent(
          origin,
          scope,
          JSON.stringify({ ...record, [field]: "substituted" }),
          null,
          false,
          true,
          forbidden,
          forbidden,
        ),
      /STORAGE_CORRUPT/,
    );
  }
  for (const bad of [
    "{",
    "null",
    "[]",
    JSON.stringify({ ...record, secret: "never" }),
    JSON.stringify({ ...record, intentId: "bad" }),
  ])
    await assert.rejects(() =>
      resolveOwnerIntent(
        origin,
        scope,
        bad,
        null,
        false,
        true,
        forbidden,
        forbidden,
      ),
    );
  await assert.rejects(
    () =>
      resolveOwnerIntent(
        origin,
        scope,
        JSON.stringify({
          ...record,
          intentId: "33333333-3333-4333-8333-333333333333",
        }),
        receipt("finalized"),
        false,
        true,
        forbidden,
        forbidden,
      ),
    /STORAGE_CONFLICT/,
  );
  await assert.rejects(
    () =>
      resolveOwnerIntent(
        origin,
        scope,
        null,
        receipt("impossible"),
        true,
        true,
        forbidden,
        forbidden,
      ),
    /STORAGE_CORRUPT/,
  );
  assert.equal(calls, 0);
});
