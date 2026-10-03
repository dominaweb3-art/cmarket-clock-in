/** Server compiler and production economic verifier, signed ephemeral fixtures.
 * Models a donation AFTER preparation; no wallet, network or submission. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { compilerFixture } from "./open-owner-compiler.test.ts";
import { compileTrustedOwnerPacket } from "../src/open-owner-compiler.ts";
import { compileEconomicManifest } from "../src/open-owner-service.ts";
import { verifyOwnerEconomicEffects } from "../src/open-owner-effects.ts";
import { collectExpiredOwnerBarrier } from "../src/open-owner-expiry.ts";
import { encodeBase58, publicKeyBytes } from "../src/solana.ts";
import { C3_MAINNET as c } from "../src/constants.ts";
const providers = [
  {
    providerId: "one",
    operatorId: "one",
    endpoint: "https://one.example.org",
    reviewEvidenceHash: "a".repeat(64),
  },
  {
    providerId: "two",
    operatorId: "two",
    endpoint: "https://two.example.org",
    reviewEvidenceHash: "b".repeat(64),
  },
];
function deposit(prefund: number) {
  const f = compilerFixture(),
    compiled = compileTrustedOwnerPacket(f.policy, f.context, f.idl, "deposit"),
    manifest = compileEconomicManifest(
      f.policy,
      f.context,
      compiled,
      "deposit",
      3000000n,
    ),
    tx = VersionedTransaction.deserialize(compiled.packet);
  tx.sign([f.wallet]);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58()),
    idx = (a: string) => keys.indexOf(a),
    rent = 3000000,
    funding = Math.max(0, rent - prefund);
  const create = Buffer.alloc(52);
  create.writeBigUInt64LE(BigInt(rent), 4);
  create.writeBigUInt64LE(288n, 12);
  Buffer.from(publicKeyBytes(f.policy.program)).copy(create, 20);
  const transfer = Buffer.alloc(12);
  transfer.writeUInt32LE(2);
  transfer.writeBigUInt64LE(BigInt(funding), 4);
  const allocate = Buffer.alloc(12);
  allocate.writeUInt32LE(8);
  allocate.writeBigUInt64LE(288n, 4);
  const assign = Buffer.alloc(36);
  assign.writeUInt32LE(1);
  Buffer.from(publicKeyBytes(f.policy.program)).copy(assign, 4);
  const ix = (program: string, accounts: string[], data: Buffer) => ({
    programIdIndex: idx(program),
    accounts: accounts.map(idx),
    data: encodeBase58(data),
  });
  const setup =
    prefund === 0
      ? [ix(c.systemProgram, [f.policy.wallet, f.a.deposit], create)]
      : [
          ...(funding > 0
            ? [ix(c.systemProgram, [f.policy.wallet, f.a.deposit], transfer)]
            : []),
          ix(c.systemProgram, [f.a.deposit], allocate),
          ix(c.systemProgram, [f.a.deposit], assign),
        ];
  const checked = Buffer.alloc(10);
  checked[0] = 12;
  checked.writeBigUInt64LE(1000000n, 1);
  checked[9] = 6;
  const token = (address: string, owner: string, amount: string) => ({
    accountIndex: idx(address),
    owner,
    mint: c.usdcMint,
    programId: c.tokenProgram,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const pre = keys.map(() => 10000000);
  pre[idx(f.a.deposit)] = prefund;
  const post = [...pre];
  post[0] = pre[0]! - funding - 5000;
  post[idx(f.a.deposit)] = prefund + funding;
  const meta = {
    err: null,
    fee: 5000,
    innerInstructions: [
      { index: 0, instructions: setup },
      {
        index: 1,
        instructions: [
          ix(
            c.tokenProgram,
            [f.a.ownerUsdc, c.usdcMint, f.a.vaultTokens[0]!, f.policy.wallet],
            checked,
          ),
        ],
      },
    ],
    preTokenBalances: [
      token(f.a.ownerUsdc, f.policy.wallet, "1000000"),
      token(f.a.vaultTokens[0]!, f.a.authority, "0"),
    ],
    postTokenBalances: [
      token(f.a.ownerUsdc, f.policy.wallet, "0"),
      token(f.a.vaultTokens[0]!, f.a.authority, "1000000"),
    ],
    preBalances: pre,
    postBalances: post,
  };
  const after = { ...f.accounts },
    cfg = Buffer.from(f.cfg),
    intent = Buffer.alloc(288);
  cfg[480] = 1;
  cfg.writeBigUInt64LE(1n, 456);
  after[f.policy.vault] = f.raw(cfg, f.policy.program);
  createHash("sha256")
    .update("account:DepositIntent")
    .digest()
    .copy(intent, 0, 0, 8);
  intent[8] = 1;
  intent.writeBigUInt64LE(1n, 9);
  Buffer.from(publicKeyBytes(f.policy.vault)).copy(intent, 17);
  Buffer.from(publicKeyBytes(f.policy.wallet)).copy(intent, 49);
  intent.writeBigUInt64LE(1n, 81);
  intent.writeBigUInt64LE(40n, 89);
  intent.writeBigInt64LE(1000n, 97);
  intent.writeBigInt64LE(1120n, 105);
  intent[113] = 2;
  intent.writeBigUInt64LE(1000000n, 114);
  intent.writeBigUInt64LE(1000000n, 122);
  [4000, 3000, 3000].forEach((n, i) => intent.writeUInt16LE(n, 194 + i * 2));
  after[f.a.deposit] = f.raw(intent, f.policy.program);
  const reserve = Buffer.from(
    f.accounts[f.a.vaultTokens[0]!]!.data[0]!,
    "base64",
  );
  reserve.writeBigUInt64LE(1000000n, 64);
  after[f.a.vaultTokens[0]!] = f.raw(reserve, c.tokenProgram);
  const packet = Buffer.from(tx.serialize()),
    signature = encodeBase58(tx.signatures[0]!),
    wire = {
      slot: 42,
      transaction: [packet.toString("base64"), "base64"],
      meta,
    },
    json = { slot: 42, transaction: { signatures: [signature] }, meta },
    snapshot = {
      context: { slot: 43 },
      value: manifest.snapshots.map((s) => after[s.address]),
    };
  return { f, compiled, packet, signature, manifest, wire, json, snapshot };
}
test("post-preparation prefunding permits ONLY exact Anchor initialization, funding and fee", () => {
  for (const prefund of [0, 1, 1000000, 3000000, 4000000]) {
    const f = deposit(prefund);
    assert.equal(
      verifyOwnerEconomicEffects(
        f.manifest,
        f.signature,
        f.wire,
        f.json,
        f.snapshot,
      ).slot,
      42,
    );
    const wire = structuredClone(f.wire),
      json = structuredClone(f.json);
    wire.meta.postBalances[1] = wire.meta.postBalances[1]! - 1;
    json.meta.postBalances[1] = json.meta.postBalances[1]! - 1;
    assert.throws(
      () =>
        verifyOwnerEconomicEffects(
          f.manifest,
          f.signature,
          wire,
          json,
          f.snapshot,
        ),
      /C3_/,
    );
  }
});
test("expired donated empty PDA is not an executed intent; finalized failure requires exact signed rollback", async () => {
  const f = deposit(0);
  for (const defect of ["", "debit", "signature", "success", "initialized"]) {
    const meta = {
      ...f.wire.meta,
      err: { InstructionError: [0, "Custom"] },
      innerInstructions: [],
      preTokenBalances: [],
      postTokenBalances: [],
      preBalances: f.wire.meta.preBalances,
      postBalances: f.wire.meta.preBalances.map(
        (n, i) => n - (i === 0 ? 5000 : 0),
      ),
    };
    if (defect === "debit") meta.postBalances[1] = meta.postBalances[1]! - 1;
    const wire = { slot: 123, transaction: f.wire.transaction, meta };
    if (defect === "signature") {
      const b = Buffer.from(f.packet);
      b[1] = b[1]! ^ 1;
      wire.transaction = [b.toString("base64"), "base64"];
    }
    const fetcher = (async (_input: unknown, init: RequestInit) => {
      const { method } = JSON.parse(String(init.body));
      let result: unknown;
      if (method === "getGenesisHash") result = c.genesisHash;
      else if (method === "getBlockHeight") result = 201;
      else if (method === "isBlockhashValid")
        result = { context: { slot: 124 }, value: false };
      else if (method === "getMultipleAccounts")
        result = {
          context: { slot: 125 },
          value: [
            {
              owner: c.systemProgram,
              executable: false,
              lamports: 1,
              data: [defect === "initialized" ? "AQ==" : "", "base64"],
            },
            null,
          ],
        };
      else if (method === "getSignatureStatuses")
        result = {
          context: { slot: 125 },
          value: [
            {
              confirmationStatus: "finalized",
              slot: 123,
              err: defect === "success" ? null : meta.err,
            },
          ],
        };
      else if (method === "getTransaction") result = wire;
      else throw Error("UNEXPECTED_RPC");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }) as typeof fetch;
    const run = () =>
      collectExpiredOwnerBarrier(
        providers,
        f.f.context.blockhash,
        "200",
        [f.f.a.deposit, f.f.a.redemption],
        f.signature,
        fetcher,
        {
          wallet: f.f.policy.wallet,
          messageHash: Buffer.from(f.compiled.messageHash, "hex"),
        },
        f.f.a.deposit,
      );
    if (["debit", "signature", "success"].includes(defect))
      await assert.rejects(run);
    else {
      const proof = await run();
      assert.equal(proof.failed, true);
      const normalized = createHash("sha256")
        .update(
          JSON.stringify([
            { address: f.f.a.deposit, value: null },
            { address: f.f.a.redemption, value: null },
          ]),
        )
        .digest();
      if (defect === "initialized")
        assert.notDeepEqual(proof.stateHash, normalized);
    }
  }
});
