/** Adversarial signed v0 fixtures, not Mainnet transactions or funded wallets. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  verifyOwnerEconomicEffects,
  type OwnerEffectManifest,
  reconcileProductionOwnerEconomics,
} from "../src/open-owner-effects.ts";
import { C3_MAINNET as c } from "../src/constants.ts";
import {
  encodeBase58,
  deriveAssociatedTokenAddress,
  findProgramAddress,
  publicKeyBytes,
} from "../src/solana.ts";
import { PublicKey } from "@solana/web3.js";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};
function fixture() {
  const wallet = Keypair.generate(),
    program = Keypair.generate().publicKey;
  const authority = findProgramAddress(
    [Buffer.from("c3-authority-v1")],
    program.toBase58(),
  ).address;
  const source = new PublicKey(
      deriveAssociatedTokenAddress(wallet.publicKey.toBase58(), c.usdcMint),
    ),
    destination = new PublicKey(
      deriveAssociatedTokenAddress(authority, c.usdcMint),
    ),
    vault = Keypair.generate().publicKey.toBase58(),
    onchainIntent = Keypair.generate().publicKey.toBase58(),
    shareMint = Keypair.generate().publicKey.toBase58();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        new TransactionInstruction({
          programId: program,
          keys: [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: destination, isSigner: false, isWritable: true },
          ],
          data: Buffer.from([1]),
        }),
      ],
    }).compileToV0Message(),
  );
  tx.sign([wallet]);
  const addresses = tx.message.staticAccountKeys.map((k) => k.toBase58()),
    idx = (a: string) => addresses.indexOf(a),
    signature = encodeBase58(tx.signatures[0]!);
  const token = (account: string, owner: string, amount: string) => ({
    accountIndex: idx(account),
    mint: String(c.usdcMint),
    owner,
    programId: c.tokenProgram,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const innerData = Buffer.alloc(10);
  innerData[0] = 12;
  innerData.writeBigUInt64LE(1000000n, 1);
  innerData[9] = 6;
  // Program deliberately bound through an existing static key; hostile tests
  // cannot silently substitute an arbitrary inner ID or account order.
  const inner = {
    index: 0,
    instructions: [
      {
        programIdIndex: idx(program.toBase58()),
        accounts: [idx(source.toBase58()), idx(destination.toBase58())],
        data: encodeBase58(innerData),
      },
    ],
  };
  const meta = {
    err: null,
    fee: 5000,
    innerInstructions: [inner],
    preTokenBalances: [
      token(source.toBase58(), wallet.publicKey.toBase58(), "2000000"),
      token(destination.toBase58(), authority, "0"),
    ],
    postTokenBalances: [
      token(source.toBase58(), wallet.publicKey.toBase58(), "1000000"),
      token(destination.toBase58(), authority, "1000000"),
    ],
    preBalances: addresses.map(() => 10000),
    postBalances: addresses.map((_, i): number => (i === 0 ? 5000 : 10000)),
  };
  const response = {
      slot: 100,
      meta,
      transaction: { signatures: [signature] },
    },
    wire = {
      slot: 100,
      meta,
      transaction: [Buffer.from(tx.serialize()).toString("base64"), "base64"],
    };
  const cfg = Buffer.alloc(546),
    intent = Buffer.alloc(288),
    put = (b: Buffer, o: number, k: string) =>
      Buffer.from(publicKeyBytes(k)).copy(b, o);
  createHash("sha256")
    .update("account:VaultConfig")
    .digest()
    .copy(cfg, 0, 0, 8);
  cfg[8] = 1;
  cfg.writeBigUInt64LE(1n, 9);
  put(cfg, 113, wallet.publicKey.toBase58());
  put(cfg, 274, shareMint);
  for (const [o, mint] of [
    [146, c.usdcMint],
    [178, c.cbBtcMint],
    [210, c.portalEthMint],
    [242, c.wrappedSolMint],
  ] as const)
    put(cfg, o, mint);
  cfg.writeUInt16LE(4000, 434);
  cfg.writeUInt16LE(3000, 436);
  cfg.writeUInt16LE(3000, 438);
  cfg[480] = 1;
  createHash("sha256")
    .update("account:DepositIntent")
    .digest()
    .copy(intent, 0, 0, 8);
  intent[8] = 1;
  intent.writeBigUInt64LE(1n, 9);
  put(intent, 17, vault);
  put(intent, 49, wallet.publicKey.toBase58());
  intent.writeBigUInt64LE(1n, 81);
  intent[113] = 2;
  intent.writeBigUInt64LE(1000000n, 114);
  intent.writeBigUInt64LE(1000000n, 122);
  const buffers = [cfg, intent],
    snapshotAddresses = [vault, onchainIntent];
  const snapshots = {
    context: { slot: 101 },
    value: buffers.map((b) => ({
      owner: program.toBase58(),
      executable: false,
      data: [b.toString("base64"), "base64"],
    })),
  };
  const manifest: OwnerEffectManifest = {
    version: "c3-owner-effects/v1",
    action: "deposit",
    program: program.toBase58(),
    vault,
    shareMint,
    onchainIntent,
    plan: Keypair.generate().publicKey.toBase58(),
    planRevision: "0",
    wallet: wallet.publicKey.toBase58(),
    messageHash: hash(tx.message.serialize()),
    inner: [
      {
        index: 0,
        instructions: [
          {
            program: program.toBase58(),
            accounts: [source.toBase58(), destination.toBase58()],
            dataHash: hash(innerData),
          },
        ],
      },
    ],
    tokens: [
      {
        account: source.toBase58(),
        owner: wallet.publicKey.toBase58(),
        mint: c.usdcMint,
        program: c.tokenProgram,
        decimals: 6,
        delta: "-1000000",
      },
      {
        account: destination.toBase58(),
        owner: authority,
        mint: c.usdcMint,
        program: c.tokenProgram,
        decimals: 6,
        delta: "1000000",
      },
    ],
    lamports: [
      {
        account: wallet.publicKey.toBase58(),
        minimum: "-5000",
        maximum: "-5000",
      },
    ],
    snapshots: buffers.map((b, i) => ({
      address: snapshotAddresses[i]!,
      owner: program.toBase58(),
      bytes: b.length,
      dataHash: hash(b),
      checks: [{ offset: 0, base64: b.toString("base64") }],
    })),
  };
  return { manifest, signature, wire, response, snapshots };
}
test("exact signed message + every inner/token/SOL effect + state evidence required", async () => {
  const f = fixture();
  assert.equal(
    verifyOwnerEconomicEffects(
      f.manifest,
      f.signature,
      f.wire,
      f.response,
      f.snapshots,
    ).slot,
    100,
  );
  for (const mutation of [
    "mint",
    "debit",
    "inner",
    "inner-account",
    "missing-token",
    "sol",
    "snapshot",
    "signature",
    "message",
    "missing-snapshot",
    "fee",
  ]) {
    const x = structuredClone(f) as Mutable<typeof f>;
    switch (mutation) {
      case "mint":
        x.response.meta.postTokenBalances[0]!.mint = c.cbBtcMint;
        break;
      case "debit":
        x.response.meta.postTokenBalances[0]!.uiTokenAmount.amount = "0";
        break;
      case "inner":
        x.response.meta.innerInstructions[0]!.instructions[0]!.data =
          encodeBase58(Buffer.from([6]));
        break;
      case "inner-account":
        x.response.meta.innerInstructions[0]!.instructions[0]!.accounts.reverse();
        break;
      case "missing-token":
        x.response.meta.preTokenBalances = [];
        break;
      case "sol":
        x.response.meta.postBalances[1] = 9999;
        break;
      case "snapshot":
        x.snapshots.value[0]!.data[0] = "AAI=";
        break;
      case "signature":
        x.signature = encodeBase58(new Uint8Array(64).fill(3));
        break;
      case "message":
        x.manifest.messageHash = "a".repeat(64);
        break;
      case "missing-snapshot":
        x.snapshots.value.pop();
        break;
      case "fee":
        x.response.meta.postBalances[0] = 0;
        break;
    }
    // Identical malicious replies from both operators still must not confirm.
    x.wire.meta = x.response.meta;
    assert.throws(
      () =>
        verifyOwnerEconomicEffects(
          x.manifest,
          x.signature,
          x.wire,
          x.response,
          x.snapshots,
        ),
      /C3_OWNER_EFFECT|message/,
      mutation,
    );
  }
  let queries = 0;
  await assert.rejects(
    () =>
      reconcileProductionOwnerEconomics(
        {
          query: () => {
            queries++;
          },
        } as unknown as Pool,
        "irrelevant",
      ),
    /NOT_APPROVED/,
  );
  assert.equal(queries, 0);
});
test("semantic account offsets agree with the actual generated Anchor IDL", () => {
  const f = fixture(),
    idl = JSON.parse(
      readFileSync(
        new URL(
          "../../../programs/c3-pilot-vault/target/idl/c3_pilot_vault.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Idl,
    coder = new BorshCoder(idl);
  const cfg = coder.accounts.decode(
    "VaultConfig",
    Buffer.from(f.snapshots.value[0]!.data[0]!, "base64"),
  );
  const intent = coder.accounts.decode(
    "DepositIntent",
    Buffer.from(f.snapshots.value[1]!.data[0]!, "base64"),
  );
  assert.equal(cfg.allowlisted_owner.toBase58(), f.manifest.wallet);
  assert.equal(cfg.share_mint.toBase58(), f.manifest.shareMint);
  assert.equal(cfg.btc_bps, 4000);
  assert.equal(cfg.eth_bps, 3000);
  assert.equal(cfg.sol_bps, 3000);
  assert.equal(cfg.config_version.toString(), "1");
  assert.equal(intent.vault.toBase58(), f.manifest.vault);
  assert.equal(intent.wallet.toBase58(), f.manifest.wallet);
  assert.equal(intent.status, 2);
  assert.equal(intent.amount.toString(), "1000000");
  assert.equal(intent.deposited.toString(), "1000000");
});
