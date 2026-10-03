/** Synthetic codec/session tests. No real wallet, RPC or monetary operation. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOwnerPosition } from "../src/owner-position.ts";
import {
  OwnerController,
  parseOwnerReceipt,
  ownerMessageHash,
  type OwnerBackend,
  type OwnerReceipt,
} from "../src/owner-controller.ts";
import {
  ownerTemplates,
  type MoneyAction,
  type OwnerPolicy,
} from "../src/owner-policy.ts";
const id = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222",
  wallet = "3".repeat(44),
  signature = "4".repeat(88);
const fields = [
  "config",
  "deposit_intent",
  "redemption_intent",
  "deposit",
  "system_program",
  "vault_authority",
  "share_mint",
  "owner_shares",
  "owner_usdc",
  "usdc_mint",
  "token_program",
  "share_token_program",
  "vault_usdc",
  "vault_btc",
  "vault_eth",
  "vault_wsol",
];
const policy: OwnerPolicy = {
  wallet: new Uint8Array(32).fill(1),
  program: new Uint8Array(32).fill(2),
  accounts: Object.fromEntries(
    fields.map((name, i) => [name, new Uint8Array(32).fill(i + 3)]),
  ),
};
function fixturePacket(action: MoneyAction = "deposit") {
  const templates = ownerTemplates(policy, action, 1600, 1000),
    keys = new Map<
      string,
      { key: Uint8Array; writable: boolean; signer: boolean }
    >();
  const hex = (k: Uint8Array) => Buffer.from(k).toString("hex");
  keys.set(hex(policy.wallet), {
    key: policy.wallet,
    writable: true,
    signer: true,
  });
  for (const ix of templates) {
    for (const a of ix.accounts) keys.set(hex(a.key), a);
    keys.set(hex(ix.program), {
      key: ix.program,
      writable: false,
      signer: false,
    });
  }
  const ordered = [...keys.values()].sort(
    (a, b) =>
      Number(b.signer) - Number(a.signer) ||
      Number(b.writable) - Number(a.writable),
  );
  const index = (k: Uint8Array) =>
    ordered.findIndex((a) => hex(a.key) === hex(k));
  return new Uint8Array([
    1,
    ...new Uint8Array(64),
    128,
    1,
    0,
    ordered.filter((a) => !a.writable).length,
    ordered.length,
    ...ordered.flatMap((a) => [...a.key]),
    ...new Uint8Array(32).fill(31),
    templates.length,
    ...templates.flatMap((ix) => [
      index(ix.program),
      ix.accounts.length,
      ...ix.accounts.map((a) => index(a.key)),
      ix.data.length,
      ...ix.data,
    ]),
    0,
  ]);
}
function setup(change?: Partial<OwnerBackend>) {
  let saved = "",
    signCalls = 0,
    prepareCalls = 0,
    clock = 1000;
  const messageHash = ownerMessageHash(fixturePacket().slice(65));
  const backend: OwnerBackend = {
    prepare: async (intentId, action) => {
      prepareCalls++;
      const packet = fixturePacket(action);
      return {
        intentId,
        action,
        requestId,
        wallet,
        messageHash: ownerMessageHash(packet.slice(65)),
        expiry: 1600,
        packet,
      };
    },
    recordSignature: async () => ({ signature }),
    status: async () => ({
      requestId,
      messageHash,
      signature,
      state: "signed",
    }),
    ...change,
  };
  const controller = new OwnerController({
    gate: () => undefined,
    wallet,
    policy,
    backend,
    save: async (r) => {
      saved = JSON.stringify(r);
    },
    now: () => clock,
    sign: async (bytes) => {
      signCalls++;
      const b = bytes.slice();
      b.fill(5, 1, 65);
      return b;
    },
    signature: () => signature,
  });
  return {
    controller,
    saved: () => saved,
    calls: () => ({ signCalls, prepareCalls }),
    advance: () => {
      clock = 1700;
    },
  };
}
test("closure and request renewal preserve uncertainty, require new generation and survive restart", async () => {
  const hash = ownerMessageHash(fixturePacket().slice(65));
  const s = setup({
    closeExpired: async (id) => ({ requestId: id, state: "closed_unexecuted" }),
    status: async () => ({
      requestId,
      messageHash: hash,
      signature: null,
      state: "closed_unexecuted",
      economicEvidenceHash: "a".repeat(64),
      evidenceScope: "MAINNET_INDEPENDENT_RPC",
    }),
  });
  await s.controller.prepare(id, "deposit");
  await s.controller.closeExpired();
  assert.equal(s.controller.snapshot?.state, "uncertain");
  assert.equal(s.calls().signCalls, 0);
  await s.controller.restore(s.saved());
  assert.equal(s.controller.snapshot?.state, "uncertain");
  await assert.rejects(
    () => s.controller.renewExpiredRequest(),
    /GENERATION_REPLAY/,
  );
  assert.equal(s.controller.snapshot?.state, "closed_unexecuted");
  assert.equal(s.calls().signCalls, 0);
  const denied = setup({
    closeExpired: async () => {
      throw Error("blockhash still valid");
    },
  });
  await denied.controller.prepare(id, "deposit");
  const before = denied.saved();
  await assert.rejects(() => denied.controller.closeExpired());
  assert.equal(denied.saved(), before);
});
test("explicit reauthentication recovers closed unrecorded signature without forgetting it", async () => {
  let authentications = 0;
  const s = setup({
    reauthenticate: async () => {
      authentications++;
    },
    status: async () => ({
      requestId,
      messageHash: ownerMessageHash(fixturePacket().slice(65)),
      signature: null,
      state: "closed_unexecuted",
      economicEvidenceHash: "a".repeat(64),
      evidenceScope: "MAINNET_INDEPENDENT_RPC",
    }),
  });
  await s.controller.prepare(id, "deposit");
  await s.controller.approve();
  await s.controller.restore(s.saved());
  assert.equal(authentications, 0);
  await s.controller.reauthenticate();
  assert.equal(authentications, 1);
  await s.controller.recover();
  assert.equal(s.controller.snapshot?.state, "closed_unexecuted");
  assert.equal(s.controller.snapshot?.signature, signature);
  assert.equal(s.calls().signCalls, 1);
  await assert.rejects(
    () => s.controller.renewExpiredRequest(),
    /GENERATION_REPLAY/,
  );
  assert.equal(s.controller.snapshot?.signature, signature);
  assert.equal(JSON.parse(s.saved()).signature, signature);
  assert.equal(JSON.parse(s.saved()).state, "closed_unexecuted");
  assert.equal(s.calls().signCalls, 1);
  assert.equal(authentications, 1);
});
test("malformed signed/null recovery preserves prior receipt with zero writes or wallet calls", async () => {
  for (const bad of [
    { state: "signed", signature: null },
    { state: "unexpected", signature: null },
    { state: "signed", signature: 42 },
  ]) {
    const s = setup({
      status: async () =>
        ({
          requestId,
          messageHash: ownerMessageHash(fixturePacket().slice(65)),
          ...bad,
        }) as never,
    });
    await s.controller.prepare(id, "deposit");
    const before = s.saved();
    await assert.rejects(() => s.controller.recover(), /RECOVERY_BINDING/);
    assert.equal(s.saved(), before);
    assert.equal(s.controller.snapshot?.state, "review");
    assert.equal(s.calls().signCalls, 0);
  }
});
test("economic recovery requires matching scope and hash; restart never trusts stored finality", async () => {
  const fields = {
    requestId,
    messageHash: ownerMessageHash(fixturePacket().slice(65)),
    signature,
    state: "finalized" as const,
  };
  for (const evidence of [
    {},
    {
      economicEvidenceHash: "b".repeat(64),
      evidenceScope: "LOCAL_CLONE" as const,
    },
  ]) {
    const s = setup({ status: async () => ({ ...fields, ...evidence }) });
    await s.controller.prepare(id, "deposit");
    const before = s.saved();
    await assert.rejects(() => s.controller.recover(), /RECOVERY_BINDING/);
    assert.equal(s.saved(), before);
  }
  const s = setup({
    status: async () => ({
      ...fields,
      economicEvidenceHash: "b".repeat(64),
      evidenceScope: "MAINNET_INDEPENDENT_RPC",
    }),
  });
  await s.controller.prepare(id, "deposit");
  await s.controller.recover();
  assert.equal(s.controller.snapshot?.state, "finalized");
  const restarted = setup();
  await restarted.controller.restore(s.saved());
  assert.equal(restarted.controller.snapshot?.state, "uncertain");
  assert.equal(restarted.calls().signCalls, 0);
});
test("position requires on-chain scope, exact ownership, u64 units and no invented NAV", () => {
  const p = {
    wallet,
    shareMint: "6".repeat(44),
    shareUnits: "1000000",
    shareDecimals: 6,
    slot: 123,
    scope: "LOCAL_CLONE",
    nav: null,
  };
  assert.throws(() => parseOwnerPosition(p, wallet, p.shareMint));
  assert.equal(
    parseOwnerPosition(p, wallet, p.shareMint, "LOCAL_CLONE").shareUnits,
    "1000000",
  );
  for (const bad of [
    { wallet: "7".repeat(44) },
    { shareUnits: "18446744073709551616" },
    { shareUnits: "-1" },
    { shareUnits: "1.1" },
    { shareUnits: "01" },
    { nav: 1 },
    { slot: 0 },
    { shareDecimals: 9 },
  ]) {
    assert.throws(() =>
      parseOwnerPosition({ ...p, ...bad }, wallet, p.shareMint, "LOCAL_CLONE"),
    );
  }
});
test("all four owner packets use independently derived exact IDL policy", async () => {
  for (const action of [
    "deposit",
    "issue_shares",
    "request_redemption",
    "claim",
  ] as const) {
    const s = setup();
    await s.controller.prepare(id, action);
    assert.equal(s.calls().signCalls, 0);
    await s.controller.approve();
    assert.equal(s.controller.snapshot?.state, "signed");
    assert.equal(s.calls().signCalls, 1);
    assert.doesNotMatch(s.saved(), /packet|templates|payload|authToken/i);
    await assert.rejects(() => s.controller.approve());
  }
});
test("gate, malicious packet, expiry and concurrent presses cannot reach signing", async () => {
  const bad = setup({
    prepare: async (intentId, action) => {
      const b = fixturePacket();
      b[100] = b[100]! ^ 1;
      return {
        intentId,
        action,
        requestId,
        wallet,
        messageHash: "a".repeat(64),
        expiry: 1600,
        packet: b,
      };
    },
  });
  await assert.rejects(() => bad.controller.prepare(id, "deposit"));
  assert.equal(bad.calls().signCalls, 0);
  const s = setup();
  await assert.rejects(() => s.controller.approve());
  const preparing = s.controller.prepare(id, "deposit");
  await assert.rejects(() => s.controller.prepare(id, "deposit"));
  await preparing;
  s.advance();
  await assert.rejects(() => s.controller.approve());
  assert.equal(s.calls().signCalls, 0);
});
test("lost receipt survives restart and only explicit read-only recovery occurs", async () => {
  const s = setup({
    recordSignature: async () => {
      throw Error("connection lost");
    },
  });
  await s.controller.prepare(id, "deposit");
  await assert.rejects(() => s.controller.approve());
  assert.equal(s.controller.snapshot?.state, "uncertain");
  assert.equal(s.controller.snapshot?.signature, signature);
  const restarted = setup();
  await restarted.controller.restore(s.saved());
  assert.deepEqual(restarted.calls(), { signCalls: 0, prepareCalls: 0 });
  await assert.rejects(() => restarted.controller.prepare(id, "deposit"));
  await restarted.controller.recover();
  assert.equal(restarted.controller.snapshot?.signature, signature);
  assert.equal(restarted.controller.snapshot?.state, "signed");
  assert.equal(restarted.calls().signCalls, 0);
});
test("strict storage rejects cross-wallet, corrupt/extra fields and impossible finality", async () => {
  const s = setup();
  await s.controller.prepare(id, "deposit");
  const r = JSON.parse(s.saved()) as OwnerReceipt;
  for (const changed of [
    { ...r, signature: null, state: "finalized" },
    { ...r, wallet: "5".repeat(44) },
    { ...r, payload: "secret" },
    { ...r, requestId: "bad" },
    { ...r, action: "claim_all" },
  ])
    assert.throws(() => parseOwnerReceipt(JSON.stringify(changed), wallet));
  assert.equal(
    parseOwnerReceipt(JSON.stringify({ ...r, state: "authorizing" }), wallet)
      .state,
    "uncertain",
  );
});
test("wrong recovery binding never overwrites known signed receipt", async () => {
  const s = setup({
    status: async () => ({
      requestId,
      messageHash: "b".repeat(64),
      signature: null,
      state: "uncertain",
    }),
  });
  await s.controller.prepare(id, "deposit");
  await s.controller.approve();
  await assert.rejects(() => s.controller.recover());
  assert.equal(s.controller.snapshot?.signature, signature);
});
test("forged hash with otherwise valid packet cannot reach wallet or storage", async () => {
  const s = setup({
    prepare: async (intentId, action) => ({
      intentId,
      action,
      requestId,
      wallet,
      messageHash: "b".repeat(64),
      expiry: 1600,
      packet: fixturePacket(),
    }),
  });
  await assert.rejects(
    () => s.controller.prepare(id, "deposit"),
    /MESSAGE_HASH_MISMATCH/,
  );
  assert.equal(s.calls().signCalls, 0);
  assert.equal(s.saved(), "");
});
