/** Real reviewed IDL + official web3 byte-equivalence; no wallet/RPC invocation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  compileTrustedOwnerPacket,
  type OpenCompilerPolicy,
  type OpenOwnerContext,
} from "../src/open-owner-compiler.ts";
import {
  openAddresses,
  SHARE_TOKEN_PROGRAM,
  verifyOpenShareMint,
  verifyOpenToken,
  verifyOpenPlan,
  type OpenAccount,
} from "../src/open-state-semantics.ts";
import { C3_MAINNET as c } from "../src/constants.ts";
import { findProgramAddress, publicKeyBytes } from "../src/solana.ts";
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest("hex");
export function compilerFixture() {
  const idl = readFileSync(
      new URL(
        "../../../programs/c3-pilot-vault/target/idl/c3_pilot_vault.json",
        import.meta.url,
      ),
    ),
    program = (JSON.parse(idl.toString()) as { address: string }).address;
  const wallet = Keypair.generate(),
    shareMint = Keypair.generate().publicKey.toBase58();
  const policy: OpenCompilerPolicy = {
    version: "c3-owner-compiler/v1",
    program,
    vault: findProgramAddress([Buffer.from("c3-vault-v1")], program).address,
    wallet: wallet.publicKey.toBase58(),
    shareMint,
    governance: Keypair.generate().publicKey.toBase58(),
    keeper: Keypair.generate().publicKey.toBase58(),
    maxSlippageBps: 100,
    idlHash: hash(idl),
    configurationHash: "a".repeat(64),
    registryRevision: "1",
    quotePolicyRevision: "1",
  };
  const a = openAddresses(policy),
    accounts: Record<string, OpenAccount | null> = {},
    raw = (b: Buffer, owner: string) => ({
      owner,
      executable: false,
      data: [b.toString("base64"), "base64"],
    });
  const cfg = Buffer.alloc(546),
    put = (b: Buffer, offset: number, k: string) =>
      Buffer.from(publicKeyBytes(k)).copy(b, offset);
  createHash("sha256")
    .update("account:VaultConfig")
    .digest()
    .copy(cfg, 0, 0, 8);
  cfg[8] = 1;
  cfg.writeBigUInt64LE(1n, 9);
  [
    [17, policy.governance],
    [81, policy.keeper],
    [113, policy.wallet],
    [274, shareMint],
  ].forEach(([offset, k]) => put(cfg, Number(offset), String(k)));
  [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint].forEach(
    (mint, i) => {
      put(cfg, 146 + i * 32, mint);
      put(cfg, 306 + i * 32, a.vaultTokens[i]!);
      cfg.writeUInt16LE([4000, 3000, 3000][i] ?? 0, 434 + i * 2);
    },
  );
  cfg.writeBigUInt64LE(1000000n, 440);
  cfg.writeBigUInt64LE(1000000n, 448);
  cfg[481] = findProgramAddress([Buffer.from("c3-authority-v1")], program).bump;
  accounts[policy.vault] = raw(cfg, program);
  const mint = Buffer.alloc(170);
  mint.writeUInt32LE(1);
  put(mint, 4, a.authority);
  mint[44] = 6;
  mint[45] = 1;
  mint[165] = 1;
  mint.writeUInt16LE(9, 166);
  accounts[shareMint] = raw(mint, SHARE_TOKEN_PROGRAM);
  const token = (
    mint: string,
    owner: string,
    amount: bigint,
    program: string,
  ) => {
    const b = Buffer.alloc(program === SHARE_TOKEN_PROGRAM ? 174 : 165);
    put(b, 0, mint);
    put(b, 32, owner);
    b.writeBigUInt64LE(amount, 64);
    b[108] = 1;
    if (program === SHARE_TOKEN_PROGRAM) {
      b[165] = 2;
      b.writeUInt16LE(7, 166);
      b.writeUInt16LE(13, 170);
    }
    return raw(b, program);
  };
  accounts[a.ownerUsdc] = token(
    c.usdcMint,
    policy.wallet,
    1000000n,
    c.tokenProgram,
  );
  accounts[a.ownerShares] = token(
    shareMint,
    policy.wallet,
    0n,
    SHARE_TOKEN_PROGRAM,
  );
  a.vaultTokens.forEach(
    (addr, i) =>
      (accounts[addr] = token(
        [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i]!,
        a.authority,
        0n,
        c.tokenProgram,
      )),
  );
  [a.deposit, a.redemption, a.depositPlan, a.redemptionPlan].forEach(
    (addr) => (accounts[addr] = null),
  );
  accounts[policy.wallet] = raw(Buffer.alloc(0), c.systemProgram);
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(1000n, 32);
  accounts["SysvarC1ock11111111111111111111111111111111"] = raw(
    clock,
    "Sysvar1111111111111111111111111111111111111",
  );
  const context: OpenOwnerContext = {
    intentId: "12345678-1234-1234-1234-123456789abc",
    wallet: policy.wallet,
    vault: policy.vault,
    shareMint,
    configurationHash: policy.configurationHash,
    state: "draft",
    dbRevision: "1",
    chainRevision: "0",
    generation: "1",
    expiry: 1120,
    chainNow: 1000,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidHeight: 200,
    accounts,
  };
  return { idl, policy, context, wallet, accounts, cfg, mint, a, raw };
}
export function completedCompilerFixture(selling = false) {
  const f = compilerFixture(),
    put = (b: Buffer, o: number, k: string) =>
      Buffer.from(publicKeyBytes(k)).copy(b, o);
  const p = Buffer.alloc(901),
    d = Buffer.alloc(selling ? 234 : 288),
    amounts = [11n, 22n, 33n];
  createHash("sha256")
    .update("account:SettlementPlan")
    .digest()
    .copy(p, 0, 0, 8);
  p[8] = 2;
  p.writeBigUInt64LE(1n, 9);
  [
    [17, f.policy.vault],
    [49, selling ? f.a.redemption : f.a.deposit],
    [81, f.policy.wallet],
    [113, f.policy.shareMint],
    [544, c.jupiterProgram],
  ].forEach(([o, k]) => put(p, Number(o), String(k)));
  p[145] = selling ? 2 : 1;
  p.writeBigUInt64LE(1000000n, 146);
  p.writeUInt16LE(50, 696);
  p.writeBigInt64LE(900n, 698);
  p.writeBigInt64LE(990n, 706);
  p[714] = 7;
  p[715] = selling ? 6 : 3;
  p.writeBigUInt64LE(3n, 716);
  p.fill(1, 724, 756);
  const assets = [c.cbBtcMint, c.portalEthMint, c.wrappedSolMint];
  for (let i = 0; i < 3; i++) {
    p.writeUInt16LE([4000, 3000, 3000][i]!, 154 + i * 2);
    put(p, 160 + i * 32, selling ? assets[i]! : c.usdcMint);
    put(p, 256 + i * 32, selling ? c.usdcMint : assets[i]!);
    put(
      p,
      352 + i * 32,
      selling ? f.a.vaultTokens[i + 1]! : f.a.vaultTokens[0]!,
    );
    put(
      p,
      448 + i * 32,
      selling ? f.a.vaultTokens[0]! : f.a.vaultTokens[i + 1]!,
    );
    p.writeBigUInt64LE(1n, 672 + i * 8);
    p.writeBigUInt64LE(
      selling ? amounts[i]! : [400000n, 300000n, 300000n][i]!,
      756 + i * 8,
    );
    p.writeBigUInt64LE(p.readBigUInt64LE(756 + i * 8), 780 + i * 8);
    p.writeBigUInt64LE(selling ? 300000n : amounts[i]!, 804 + i * 8);
  }
  p[900] = findProgramAddress(
    [
      Buffer.from("c3-plan-v1"),
      publicKeyBytes(selling ? f.a.redemption : f.a.deposit),
    ],
    f.policy.program,
  ).bump;
  createHash("sha256")
    .update("account:" + (selling ? "RedemptionIntent" : "DepositIntent"))
    .digest()
    .copy(d, 0, 0, 8);
  d[8] = 1;
  d.writeBigUInt64LE(1n, 9);
  put(d, 17, f.policy.vault);
  put(d, 49, f.policy.wallet);
  d.writeBigUInt64LE(1n, 81);
  d.writeBigUInt64LE(1n, 89);
  d.writeBigInt64LE(900n, 97);
  d.writeBigInt64LE(990n, 105);
  d[113] = selling ? 4 : 3;
  d.writeBigUInt64LE(1000000n, 114);
  d.fill(1, selling ? 170 : 224, selling ? 202 : 256);
  if (selling) {
    amounts.forEach((n, i) => d.writeBigUInt64LE(n, 122 + i * 8));
    d.writeBigUInt64LE(900000n, 154);
  } else {
    d.writeBigUInt64LE(1000000n, 122);
    amounts.forEach((n, i) => {
      d.writeBigUInt64LE(n, 162 + i * 8);
      d.writeUInt16LE([4000, 3000, 3000][i]!, 194 + i * 2);
      d.writeBigUInt64LE([400000n, 300000n, 300000n][i]!, 200 + i * 8);
    });
  }
  f.cfg[480] = selling ? 3 : 1;
  f.cfg.writeBigUInt64LE(1n, 456);
  if (selling) {
    f.cfg.writeBigUInt64LE(1n, 464);
    f.cfg.writeBigUInt64LE(1000000n, 472);
    f.mint.writeBigUInt64LE(1000000n, 36);
    const shares = Buffer.from(f.accounts[f.a.ownerShares]!.data[0]!, "base64");
    shares.writeBigUInt64LE(1000000n, 64);
    f.accounts[f.a.ownerShares] = f.raw(shares, SHARE_TOKEN_PROGRAM);
  }
  f.accounts[f.policy.vault] = f.raw(f.cfg, f.policy.program);
  f.accounts[f.policy.shareMint] = f.raw(f.mint, SHARE_TOKEN_PROGRAM);
  f.a.vaultTokens.forEach((addr, i) => {
    const b = Buffer.from(f.accounts[addr]!.data[0]!, "base64");
    b.writeBigUInt64LE(
      selling ? (i === 0 ? 900000n : 0n) : i === 0 ? 0n : amounts[i - 1]!,
      64,
    );
    f.accounts[addr] = f.raw(b, c.tokenProgram);
  });
  f.accounts[selling ? f.a.redemptionPlan : f.a.depositPlan] = f.raw(
    p,
    f.policy.program,
  );
  f.accounts[selling ? f.a.redemption : f.a.deposit] = f.raw(
    d,
    f.policy.program,
  );
  return {
    ...f,
    plan: p,
    intent: d,
    context: {
      ...f.context,
      state: selling ? "claimable" : "buying",
      chainRevision: "3",
    },
  };
}
test("server-derived owner packet is byte-equivalent to official v0 construction", () => {
  const f = compilerFixture(),
    r = compileTrustedOwnerPacket(f.policy, f.context, f.idl, "deposit");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: f.wallet.publicKey,
      recentBlockhash: f.context.blockhash,
      instructions: r.instructions.map(
        (ix) =>
          new TransactionInstruction({
            programId: new PublicKey(ix.programId),
            keys: ix.accounts.map((k) => ({
              pubkey: new PublicKey(k.address),
              isSigner: k.signer,
              isWritable: k.writable,
            })),
            data: Buffer.from(ix.dataBase64, "base64"),
          }),
      ),
    }).compileToV0Message(),
  );
  assert.deepEqual(Buffer.from(tx.serialize()), r.packet);
  assert.equal(r.manifest.generation, "1");
  assert.equal(r.instructions.length, 2);
  assert.ok(r.packet.length <= 1232);
});
test("wallet, revision, IDL, authority, extension and quote expiry cannot be self-certified", () => {
  for (const failure of [
    "wallet",
    "vault",
    "generation",
    "expiry",
    "idl",
    "authority",
    "extension",
    "delegate",
    "limit",
  ]) {
    const f = compilerFixture();
    const context = { ...f.context, accounts: { ...f.accounts } };
    let idl = f.idl;
    if (failure === "wallet")
      context.wallet = Keypair.generate().publicKey.toBase58();
    if (failure === "vault")
      context.vault = Keypair.generate().publicKey.toBase58();
    if (failure === "generation") context.generation = "0";
    if (failure === "expiry") context.expiry = 999;
    if (failure === "idl") idl = Buffer.from("{}");
    if (failure === "authority") {
      f.mint.fill(0, 4, 36);
      context.accounts[f.policy.shareMint] = f.raw(f.mint, SHARE_TOKEN_PROGRAM);
    }
    if (failure === "extension") {
      f.mint.writeUInt16LE(18, 166);
      context.accounts[f.policy.shareMint] = f.raw(f.mint, SHARE_TOKEN_PROGRAM);
    }
    if (failure === "delegate") {
      const b = Buffer.from(
        context.accounts[f.a.ownerUsdc]!.data[0]!,
        "base64",
      );
      b.writeUInt32LE(1, 72);
      context.accounts[f.a.ownerUsdc] = f.raw(b, c.tokenProgram);
    }
    if (failure === "limit") {
      f.cfg.writeBigUInt64LE(2000000n, 448);
      context.accounts[f.policy.vault] = f.raw(f.cfg, f.policy.program);
    }
    assert.throws(
      () => compileTrustedOwnerPacket(f.policy, context, idl, "deposit"),
      /C3_/,
      failure,
    );
  }
});
test("mint and token extension evidence is mandatory, not symbol or hash", () => {
  const f = compilerFixture();
  assert.equal(
    verifyOpenShareMint(f.policy, f.accounts[f.policy.shareMint]!).supply,
    0n,
  );
  assert.equal(
    verifyOpenToken(
      f.accounts[f.a.ownerShares]!,
      f.policy.wallet,
      f.policy.shareMint,
      SHARE_TOKEN_PROGRAM,
    ),
    0n,
  );
  assert.throws(() =>
    verifyOpenPlan(f.policy, f.a.depositPlan, f.accounts[f.policy.vault]!, "0"),
  );
});
test("completed shares/claim require actual intent, inventory and exact plan settlement id", () => {
  for (const selling of [false, true]) {
    const f = completedCompilerFixture(selling),
      action = selling ? "claim" : "issue_shares",
      address = selling ? f.a.redemption : f.a.deposit;
    assert.ok(
      compileTrustedOwnerPacket(f.policy, f.context, f.idl, action).packet
        .length <= 1232,
    );
    for (const defect of [
      "missing",
      "status",
      "settlement",
      "inventory",
      "revision",
    ]) {
      const accounts = { ...f.accounts },
        intent = Buffer.from(f.intent),
        plan = Buffer.from(f.plan);
      if (defect === "missing") accounts[address] = null;
      else if (defect === "revision") {
        plan.writeBigUInt64LE(0n, 716);
        accounts[selling ? f.a.redemptionPlan : f.a.depositPlan] = f.raw(
          plan,
          f.policy.program,
        );
      } else {
        if (defect === "status") intent[113] = 0;
        if (defect === "settlement") intent[selling ? 170 : 224] = 2;
        if (defect === "inventory")
          intent.writeBigUInt64LE(1n, selling ? 154 : 162);
        accounts[address] = f.raw(intent, f.policy.program);
      }
      assert.throws(
        () =>
          compileTrustedOwnerPacket(
            f.policy,
            { ...f.context, accounts },
            f.idl,
            action,
          ),
        /C3_/,
        defect,
      );
    }
  }
});
test("expired partial plan may renew while paused; preserves old seal until onchain owner renewal", () => {
  const f = completedCompilerFixture();
  f.plan[714] = 1;
  f.plan[715] = 9;
  for (const i of [1, 2]) {
    f.plan.writeBigUInt64LE(0n, 756 + i * 8);
    f.plan.writeBigUInt64LE(0n, 804 + i * 8);
  }
  f.plan.fill(2, 860, 892);
  f.plan.writeBigInt64LE(995n, 892);
  f.cfg[145] = 1;
  f.intent[113] = 2;
  f.accounts[f.a.deposit] = f.raw(f.intent, f.policy.program);
  f.accounts[f.policy.vault] = f.raw(f.cfg, f.policy.program);
  f.accounts[f.a.depositPlan] = f.raw(f.plan, f.policy.program);
  assert.ok(
    compileTrustedOwnerPacket(f.policy, f.context, f.idl, "renew_plan").packet
      .length <= 1232,
  );
  f.plan.writeBigInt64LE(1100n, 892);
  f.accounts[f.a.depositPlan] = f.raw(f.plan, f.policy.program);
  assert.throws(
    () => compileTrustedOwnerPacket(f.policy, f.context, f.idl, "renew_plan"),
    /RENEWAL_PENDING_OR_LIVE/,
  );
});
