import { test } from "node:test";
import assert from "node:assert/strict";
import { OwnerFlow } from "../src/owner-flow.ts";
import {
  inspectOwnerTransaction,
  freezeOwnerReview,
  type OwnerInstructionReview,
} from "../src/owner-transaction-review.ts";
// Byte-level synthetic owner-renewal fixture. Not physical MWA approval.
const owner = new Uint8Array(32).fill(1),
  program = new Uint8Array(32).fill(2),
  plan = new Uint8Array(32).fill(3);
const ix: OwnerInstructionReview = {
  program,
  accounts: [
    { key: owner, signer: true, writable: true },
    { key: plan, signer: false, writable: true },
  ],
  data: new Uint8Array([1, 2, 3]),
};
const packet = new Uint8Array([
  1,
  ...new Uint8Array(64),
  128,
  1,
  0,
  1,
  3,
  ...owner,
  ...plan,
  ...program,
  ...new Uint8Array(32).fill(4),
  1,
  2,
  2,
  0,
  1,
  3,
  1,
  2,
  3,
  0,
]);
test("exact v0 owner review rejects substitution, extra signer/accounts/ALT and oversized payloads", () => {
  assert.ok(inspectOwnerTransaction(packet, owner, [ix]));
  for (const offset of [
    0, 1, 65, 66, 67, 68, 69, 70, 198, 199, 200, 201, 202, 203, 204, 205, 206,
    207,
  ]) {
    if (offset >= packet.length) continue;
    const bad = packet.slice();
    bad[offset] = bad[offset]! ^ 1;
    assert.throws(() => inspectOwnerTransaction(bad, owner, [ix]));
  }
  assert.throws(() =>
    inspectOwnerTransaction(new Uint8Array(1233), owner, [ix]),
  );
  assert.throws(() =>
    inspectOwnerTransaction(packet, new Uint8Array(32).fill(5), [ix]),
  );
  assert.throws(() =>
    inspectOwnerTransaction(packet, owner, [
      { ...ix, data: new Uint8Array([1, 2, 4]) },
    ]),
  );
});
test("review and explicit approval ordering; uncertain results never become retryable", () => {
  const id = "a".repeat(36),
    hash = "b".repeat(64),
    flow = new OwnerFlow();
  flow.start(id, hash);
  assert.throws(() => flow.authorize());
  flow.review();
  flow.authorize();
  flow.signed("3".repeat(88));
  flow.interrupted();
  assert.throws(() => flow.start(id, hash));
  assert.throws(() => flow.reject());
  assert.throws(() => flow.finalized("4".repeat(88)));
  flow.finalized("3".repeat(88));
  assert.throws(() => flow.start(id, hash));
});
test("mutable Buffer/templates cannot alter a frozen pre-wallet review", () => {
  const bytes = Buffer.from(packet),
    templates = [
      {
        ...ix,
        data: new Uint8Array(ix.data),
        accounts: ix.accounts.map((a) => ({
          ...a,
          key: new Uint8Array(a.key),
        })),
      },
    ];
  const frozen = freezeOwnerReview(bytes, owner, templates);
  bytes.fill(9);
  templates[0]!.data.fill(9);
  templates[0]!.accounts[0]!.key.fill(9);
  assert.deepEqual(frozen.bytes, packet);
  assert.ok(
    inspectOwnerTransaction(frozen.bytes, frozen.wallet, frozen.templates),
  );
});
test("late verified signature keeps the uncertain request blocked from resubmission", () => {
  const id = "a".repeat(36),
    hash = "b".repeat(64),
    flow = new OwnerFlow();
  flow.start(id, hash);
  flow.review();
  flow.authorize();
  flow.interrupted();
  assert.throws(() => flow.finalized(null as unknown as string));
  assert.equal(flow.snapshot.state, "uncertain");
  assert.equal(flow.snapshot.signature, null);
  assert.throws(() =>
    flow.recordLateVerifiedSignature("c".repeat(36), hash, "3".repeat(88)),
  );
  assert.throws(() =>
    flow.recordLateVerifiedSignature(id, "c".repeat(64), "3".repeat(88)),
  );
  flow.recordLateVerifiedSignature(id, hash, "3".repeat(88));
  assert.equal(flow.snapshot.state, "uncertain");
  assert.equal(flow.snapshot.signature, "3".repeat(88));
  assert.throws(() => flow.start(id, hash));
});
