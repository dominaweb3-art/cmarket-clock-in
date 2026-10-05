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
  reconcileOwnerEconomicsFromSource,
} from "../src/open-owner-effects.ts";
import { completedCompilerFixture } from "./open-owner-compiler.test.ts";
import { compileTrustedOwnerPacket } from "../src/open-owner-compiler.ts";
import { compileEconomicManifest } from "../src/open-owner-service.ts";
import {
  SHARE_TOKEN_PROGRAM,
  type OpenAccount,
} from "../src/open-state-semantics.ts";
import { canonicalize } from "../src/manifest.ts";
import type { SettlementServerPolicy } from "../src/open-leg-factory.ts";
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

type DonationWindow = "prepare/execution" | "execution/snapshot";
const custodyMints = [
  c.usdcMint,
  c.cbBtcMint,
  c.portalEthMint,
  c.wrappedSolMint,
];
const custodyDecimals = [6, 8, 8, 9];
function rewriteAccount(
  accounts: Record<string, OpenAccount | null>,
  address: string,
  change: (bytes: Buffer) => void,
) {
  const raw = accounts[address]!;
  const bytes = Buffer.from(raw.data[0]!, "base64");
  change(bytes);
  accounts[address] = { ...raw, data: [bytes.toString("base64"), "base64"] };
}

/** Real compiler/manifest, ephemeral signature and synthetic finalized effects.
 * Donation bytes are added only after preparation; the manifest stays pinned. */
function redemptionEffectsFixture(
  action: "request_redemption" | "claim",
  mintIndex = 0,
  window: DonationWindow = "execution/snapshot",
) {
  const f = completedCompilerFixture(action === "claim");
  if (action === "request_redemption") {
    f.cfg[480] = 2;
    f.cfg.writeBigUInt64LE(1000000n, 472);
    f.mint.writeBigUInt64LE(1000000n, 36);
    f.intent[113] = 5;
    f.intent.writeBigUInt64LE(1000000n, 186);
    f.accounts[f.policy.vault] = f.raw(f.cfg, f.policy.program);
    f.accounts[f.policy.shareMint] = f.raw(f.mint, SHARE_TOKEN_PROGRAM);
    f.accounts[f.a.deposit] = f.raw(f.intent, f.policy.program);
    rewriteAccount(f.accounts, f.a.ownerShares, (b) =>
      b.writeBigUInt64LE(1000000n, 64),
    );
    rewriteAccount(f.accounts, f.a.vaultTokens[0]!, (b) =>
      b.writeBigUInt64LE(7n, 64),
    );
    f.context.state = "active";
  } else {
    // Keep positive residual balances so removal by one unit is representable
    // for every custody mint, including those absent from the claim packet.
    f.a.vaultTokens.forEach((address, i) =>
      rewriteAccount(f.accounts, address, (b) =>
        b.writeBigUInt64LE(i === 0 ? 900007n : 7n, 64),
      ),
    );
  }
  const compiled = compileTrustedOwnerPacket(
    f.policy,
    f.context,
    f.idl,
    action,
  );
  const manifest = compileEconomicManifest(
    f.policy,
    f.context,
    compiled,
    action,
    3000000n,
  );
  const tx = VersionedTransaction.deserialize(compiled.packet);
  tx.sign([f.wallet]);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const idx = (address: string) => keys.indexOf(address);
  const donated = f.a.vaultTokens[mintIndex]!;
  const transactionPre = structuredClone(f.accounts);
  if (window === "prepare/execution")
    rewriteAccount(transactionPre, donated, (b) =>
      b.writeBigUInt64LE(b.readBigUInt64LE(64) + 1n, 64),
    );
  const after = structuredClone(transactionPre);
  const returned = action === "claim" ? 900000n : 0n;
  const tokenAddresses = [
    ...new Set([
      ...manifest.tokens.map((t) => t.account),
      ...f.a.vaultTokens.filter((address) => idx(address) >= 0),
    ]),
  ];
  const tokenBalance = (address: string, accounts: typeof f.accounts) => {
    const b = Buffer.from(accounts[address]!.data[0]!, "base64");
    const custodyIndex = f.a.vaultTokens.indexOf(address);
    return {
      accountIndex: idx(address),
      owner:
        address === f.a.ownerShares || address === f.a.ownerUsdc
          ? f.policy.wallet
          : f.a.authority,
      mint:
        address === f.a.ownerShares
          ? f.policy.shareMint
          : custodyIndex >= 0
            ? custodyMints[custodyIndex]!
            : c.usdcMint,
      programId:
        address === f.a.ownerShares ? SHARE_TOKEN_PROGRAM : c.tokenProgram,
      uiTokenAmount: {
        amount: b.readBigUInt64LE(64).toString(),
        decimals: custodyIndex >= 0 ? custodyDecimals[custodyIndex]! : 6,
      },
    };
  };
  for (const effect of manifest.tokens)
    rewriteAccount(after, effect.account, (b) =>
      b.writeBigUInt64LE(b.readBigUInt64LE(64) + BigInt(effect.delta), 64),
    );
  const postTokenBalances = tokenAddresses.map((address) =>
    tokenBalance(address, after),
  );
  const inner = (program: string, accounts: string[], data: Buffer) => {
    assert.ok(
      idx(program) >= 0 && accounts.every((address) => idx(address) >= 0),
    );
    return {
      programIdIndex: idx(program),
      accounts: accounts.map(idx),
      data: encodeBase58(data),
    };
  };
  const preBalances = keys.map(() => 10000000);
  const postBalances = [...preBalances];
  let innerInstructions;
  if (action === "request_redemption") {
    const create = Buffer.alloc(52);
    create.writeBigUInt64LE(3000000n, 4);
    create.writeBigUInt64LE(234n, 12);
    Buffer.from(publicKeyBytes(f.policy.program)).copy(create, 20);
    innerInstructions = [
      {
        index: 0,
        instructions: [
          inner(c.systemProgram, [f.policy.wallet, f.a.redemption], create),
        ],
      },
    ];
    preBalances[idx(f.a.redemption)] = 0;
    postBalances[idx(f.a.redemption)] = 3000000;
    postBalances[0] = preBalances[0]! - 3000000 - 5000;
    const intent = Buffer.alloc(234);
    createHash("sha256")
      .update("account:RedemptionIntent")
      .digest()
      .copy(intent, 0, 0, 8);
    intent[8] = 1;
    intent.writeBigUInt64LE(1n, 9);
    Buffer.from(publicKeyBytes(f.policy.vault)).copy(intent, 17);
    Buffer.from(publicKeyBytes(f.policy.wallet)).copy(intent, 49);
    intent.writeBigUInt64LE(1n, 81);
    intent.writeBigUInt64LE(42n, 89);
    intent.writeBigInt64LE(1000n, 97);
    intent.writeBigInt64LE(1120n, 105);
    intent[113] = 2;
    intent.writeBigUInt64LE(1000000n, 114);
    for (let i = 0; i < 3; i++)
      intent.writeBigUInt64LE(
        f.intent.readBigUInt64LE(162 + i * 8),
        122 + i * 8,
      );
    intent.writeBigUInt64LE(
      Buffer.from(
        transactionPre[f.a.vaultTokens[0]!]!.data[0]!,
        "base64",
      ).readBigUInt64LE(64),
      146,
    );
    after[f.a.redemption] = {
      ...f.raw(intent, f.policy.program),
      lamports: 3000000,
    };
    rewriteAccount(after, f.policy.vault, (b) => {
      b[480] = 3;
      b.writeBigUInt64LE(1n, 464);
    });
  } else {
    const burn = Buffer.alloc(9);
    burn[0] = 8;
    burn.writeBigUInt64LE(1000000n, 1);
    const transfer = Buffer.alloc(10);
    transfer[0] = 12;
    transfer.writeBigUInt64LE(returned, 1);
    transfer[9] = 6;
    innerInstructions = [
      {
        index: 0,
        instructions: [
          inner(
            SHARE_TOKEN_PROGRAM,
            [f.a.ownerShares, f.policy.shareMint, f.policy.wallet],
            burn,
          ),
          inner(
            c.tokenProgram,
            [f.a.vaultTokens[0]!, c.usdcMint, f.a.ownerUsdc, f.a.authority],
            transfer,
          ),
        ],
      },
    ];
    postBalances[0] = preBalances[0]! - 5000;
    rewriteAccount(after, f.policy.vault, (b) => {
      b[480] = 4;
    });
    rewriteAccount(after, f.policy.shareMint, (b) =>
      b.writeBigUInt64LE(0n, 36),
    );
    rewriteAccount(after, f.a.redemption, (b) => {
      b[113] = 6;
      b.writeBigUInt64LE(returned, 162);
    });
  }
  if (window === "execution/snapshot")
    rewriteAccount(after, donated, (b) =>
      b.writeBigUInt64LE(b.readBigUInt64LE(64) + 1n, 64),
    );
  const meta = {
    err: null,
    fee: 5000,
    preBalances,
    postBalances,
    innerInstructions,
    preTokenBalances: tokenAddresses.map((address) =>
      tokenBalance(address, transactionPre),
    ),
    postTokenBalances,
  };
  const signature = encodeBase58(tx.signatures[0]!);
  const json = { slot: 42, meta, transaction: { signatures: [signature] } };
  const wire = {
    slot: 42,
    meta: structuredClone(meta),
    transaction: [Buffer.from(tx.serialize()).toString("base64"), "base64"],
  };
  const snapshot = {
    context: { slot: 43 },
    value: manifest.snapshots.map((s) => after[s.address]!),
  };
  return {
    f,
    compiled,
    manifest,
    signature,
    json,
    wire,
    snapshot,
    donated,
    returned,
  };
}
function verifyRedemptionEffects(
  f: ReturnType<typeof redemptionEffectsFixture>,
) {
  return verifyOwnerEconomicEffects(
    f.manifest,
    f.signature,
    f.wire,
    f.json,
    f.snapshot,
  );
}
function changeOwnerSnapshot(
  f: ReturnType<typeof redemptionEffectsFixture>,
  address: string,
  change: (bytes: Buffer) => void,
) {
  const index = f.manifest.snapshots.findIndex((s) => s.address === address);
  assert.ok(index >= 0);
  const raw = f.snapshot.value[index]!;
  const b = Buffer.from(raw.data[0]!, "base64");
  change(b);
  f.snapshot.value[index] = { ...raw, data: [b.toString("base64"), "base64"] };
}

for (const action of ["request_redemption", "claim"] as const)
  for (const [mintIndex, mint] of custodyMints.entries())
    for (const window of ["prepare/execution", "execution/snapshot"] as const)
      test(`${action}: custody +1 ${mint} donation at ${window} preserves exact effects`, () => {
        const f = redemptionEffectsFixture(action, mintIndex, window);
        const pinned = canonicalize(f.manifest);
        assert.equal(verifyRedemptionEffects(f).slot, 42);
        assert.equal(canonicalize(f.manifest), pinned);
        if (action === "claim") {
          for (const [address, delta] of [
            [f.f.a.vaultTokens[0]!, -900000n],
            [f.f.a.ownerUsdc, 900000n],
            [f.f.a.ownerShares, -1000000n],
          ] as const) {
            const index = f.json.meta.preTokenBalances.findIndex(
              (t) =>
                t.accountIndex ===
                VersionedTransaction.deserialize(
                  Buffer.from(f.wire.transaction[0]!, "base64"),
                ).message.staticAccountKeys.findIndex(
                  (k) => k.toBase58() === address,
                ),
            );
            assert.equal(
              BigInt(
                f.json.meta.postTokenBalances[index]!.uiTokenAmount.amount,
              ) -
                BigInt(
                  f.json.meta.preTokenBalances[index]!.uiTokenAmount.amount,
                ),
              delta,
            );
          }
        }
      });

test("request_redemption records transaction-pre USDC, rejecting prepared and later snapshot balances", () => {
  for (const window of ["prepare/execution", "execution/snapshot"] as const) {
    const f = redemptionEffectsFixture("request_redemption", 0, window);
    assert.equal(verifyRedemptionEffects(f).slot, 42);
    const actual = window === "prepare/execution" ? 8n : 7n;
    for (const incorrect of [actual - 1n, actual + 1n]) {
      const x = { ...f, snapshot: structuredClone(f.snapshot) };
      changeOwnerSnapshot(x, f.f.a.redemption, (b) =>
        b.writeBigUInt64LE(incorrect, 146),
      );
      assert.throws(() => verifyRedemptionEffects(x), /REDEMPTION_INVENTORY/);
    }
  }
});

for (const action of ["request_redemption", "claim"] as const)
  test(`${action}: donations do not permit negative balances, removals or custody metadata changes`, () => {
    for (const window of ["prepare/execution", "execution/snapshot"] as const)
      for (const [mintIndex] of custodyMints.entries()) {
        const f = redemptionEffectsFixture(action, mintIndex, window);
        assert.equal(verifyRedemptionEffects(f).slot, 42);
        for (const defect of [
          "negative",
          "pre-removal",
          "snapshot-removal",
          "missing-account",
          "mint",
          "authority",
          "delegate",
          "delegate-bytes",
          "native-reserve",
          "close-authority",
        ] as const) {
          const x = {
            ...f,
            json: structuredClone(f.json),
            wire: structuredClone(f.wire),
            snapshot: structuredClone(f.snapshot),
          };
          const custodyIndex = VersionedTransaction.deserialize(
            Buffer.from(x.wire.transaction[0]!, "base64"),
          ).message.staticAccountKeys.findIndex(
            (k) => k.toBase58() === f.donated,
          );
          const token = x.json.meta.preTokenBalances.find(
            (t) => t.accountIndex === custodyIndex,
          );
          if (defect === "negative" || defect === "pre-removal") {
            // Claim packets only include USDC custody; other mints are snapshot-only.
            if (!token) continue;
            const post = x.json.meta.postTokenBalances.find(
              (t) => t.accountIndex === token.accountIndex,
            )!;
            if (defect === "negative") token.uiTokenAmount.amount = "-1";
            else {
              const prepared = Buffer.from(
                f.manifest.baseline![f.donated]!.data[0]!,
                "base64",
              ).readBigUInt64LE(64);
              if (prepared === 0n) continue;
              token.uiTokenAmount.amount = (prepared - 1n).toString();
              post.uiTokenAmount.amount = (
                prepared -
                1n +
                BigInt(
                  f.manifest.tokens.find((t) => t.account === f.donated)
                    ?.delta ?? "0",
                )
              ).toString();
            }
          } else if (defect === "missing-account") {
            x.snapshot.value[
              x.manifest.snapshots.findIndex((s) => s.address === f.donated)
            ] = null as unknown as OpenAccount;
          } else
            changeOwnerSnapshot(x, f.donated, (b) => {
              if (defect === "snapshot-removal") {
                const floor = token
                  ? BigInt(
                      f.json.meta.postTokenBalances.find(
                        (t) => t.accountIndex === token.accountIndex,
                      )!.uiTokenAmount.amount,
                    )
                  : Buffer.from(
                      f.manifest.baseline![f.donated]!.data[0]!,
                      "base64",
                    ).readBigUInt64LE(64);
                b.writeBigUInt64LE(floor - 1n, 64);
              }
              if (defect === "mint") b[0] = b[0]! ^ 1;
              if (defect === "authority") b[32] = b[32]! ^ 1;
              if (defect === "delegate") b.writeUInt32LE(1, 72);
              if (defect === "delegate-bytes") b[76] = 1;
              if (defect === "native-reserve") b[113] = 1;
              if (defect === "close-authority") b.writeUInt32LE(1, 129);
            });
          x.wire.meta = structuredClone(x.json.meta);
          assert.throws(
            () => verifyRedemptionEffects(x),
            /C3_(OWNER_EFFECT|OPEN_STATE)_/,
            `${window}/${mintIndex}/${defect}`,
          );
        }
      }
  });

test("claim with snapshot donations rejects debit/credit ±1, wrong burn, mint authority and hostile inner instructions", () => {
  const f = redemptionEffectsFixture("claim");
  assert.equal(verifyRedemptionEffects(f).slot, 42);
  for (const address of [
    f.f.a.ownerUsdc,
    f.f.a.vaultTokens[0]!,
    f.f.a.ownerShares,
  ])
    for (const difference of [-1n, 1n]) {
      const x = {
        ...f,
        json: structuredClone(f.json),
        wire: structuredClone(f.wire),
      };
      const keys = VersionedTransaction.deserialize(
        Buffer.from(x.wire.transaction[0]!, "base64"),
      ).message.staticAccountKeys;
      const token = x.json.meta.postTokenBalances.find(
        (t) => keys[t.accountIndex]!.toBase58() === address,
      )!;
      token.uiTokenAmount.amount = (
        BigInt(token.uiTokenAmount.amount) + difference
      ).toString();
      x.wire.meta = structuredClone(x.json.meta);
      assert.throws(
        () => verifyRedemptionEffects(x),
        /C3_OWNER_EFFECT_(TOKEN_EFFECT|INTEGER)/,
      );
    }
  for (const defect of [
    "burn-supply",
    "mint-authority",
    "burn-amount",
    "transfer-amount",
    "inner-order",
    "extra-inner",
  ] as const) {
    const x = {
      ...f,
      json: structuredClone(f.json),
      wire: structuredClone(f.wire),
      snapshot: structuredClone(f.snapshot),
    };
    if (defect === "burn-supply")
      changeOwnerSnapshot(x, f.f.policy.shareMint, (b) =>
        b.writeBigUInt64LE(1n, 36),
      );
    if (defect === "mint-authority")
      changeOwnerSnapshot(x, f.f.policy.shareMint, (b) => {
        b[4] = b[4]! ^ 1;
      });
    const instructions = x.json.meta.innerInstructions[0]!.instructions;
    if (defect === "burn-amount" || defect === "transfer-amount") {
      const b = Buffer.alloc(defect === "burn-amount" ? 9 : 10);
      b[0] = defect === "burn-amount" ? 8 : 12;
      b.writeBigUInt64LE(
        (defect === "burn-amount" ? 1000000n : 900000n) - 1n,
        1,
      );
      if (b.length === 10) b[9] = 6;
      instructions[defect === "burn-amount" ? 0 : 1]!.data = encodeBase58(b);
    }
    if (defect === "inner-order") instructions.reverse();
    if (defect === "extra-inner")
      instructions.push(structuredClone(instructions[0]!));
    x.wire.meta = structuredClone(x.json.meta);
    assert.throws(
      () => verifyRedemptionEffects(x),
      /C3_(OWNER_EFFECT|OPEN_STATE)_/,
      defect,
    );
  }
});

for (const action of ["request_redemption", "claim"] as const)
  test(`${action}: writer accepts only an existing message receipt with the exact finalized slot and evidence hash`, async () => {
    const f = redemptionEffectsFixture(action);
    const proof = verifyRedemptionEffects(f);
    const policy: SettlementServerPolicy = {
      ...f.f.policy,
      programId: f.f.policy.program,
      registry: f.f.policy.governance,
      registryHash: "b".repeat(64),
      quotePolicy: f.f.policy.keeper,
      quoteAuthority: f.f.policy.governance,
    };
    const requestId = "12345678-1234-1234-1234-123456789def";
    const row = {
      request_id: requestId,
      intent_id: f.f.context.intentId,
      action,
      signature: f.signature,
      wallet: policy.wallet,
      vault: policy.vault,
      share_mint: policy.shareMint,
      configuration_hash: policy.configurationHash,
      state: f.f.context.state,
      deposit_plan: f.f.a.depositPlan,
      redemption_plan: action === "claim" ? f.f.a.redemptionPlan : null,
      expected_db_revision: f.f.context.dbRevision,
      expected_chain_revision: f.f.context.chainRevision,
      message_hash: Buffer.from(f.manifest.messageHash, "hex"),
      manifest: f.manifest,
      manifest_hash: Buffer.from(
        hash(Buffer.from(canonicalize(f.manifest))),
        "hex",
      ),
      authorization_manifest: f.compiled.manifest,
      authorization_hash: Buffer.from(
        hash(Buffer.from(canonicalize(f.compiled.manifest))),
        "hex",
      ),
      pre_accounts: f.manifest.baseline,
    };
    const paired = <T>(v: T) => ({
      status: "AGREED_UNVERIFIED_EFFECTS" as const,
      primary: v,
      secondary: structuredClone(v),
    });
    for (const mode of [
      "matching",
      "hash-conflict",
      "slot-conflict",
      "missing",
      "malformed-hash",
    ] as const) {
      const receipt =
        mode === "missing"
          ? undefined
          : {
              // PostgreSQL bigint may arrive as a decimal string.
              slot: String(
                mode === "slot-conflict" ? proof.slot + 1 : proof.slot,
              ),
              evidence_hash:
                mode === "malformed-hash"
                  ? proof.evidenceHash
                  : Buffer.from(
                      mode === "hash-conflict"
                        ? "0".repeat(64)
                        : proof.evidenceHash,
                      "hex",
                    ),
            };
      const before = canonicalize(receipt ?? null);
      const statements: { sql: string; params: unknown[] | undefined }[] = [];
      let releases = 0;
      const query = async (sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql))
          return { rows: [], rowCount: 0 };
        if (
          sql === "SELECT * FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE"
        )
          return {
            rows: [
              {
                db_revision: row.expected_db_revision,
                chain_revision: row.expected_chain_revision,
                state: row.state,
              },
            ],
            rowCount: 1,
          };
        if (
          sql.startsWith(
            "SELECT evidence_hash FROM c3_open.owner_effect_receipts",
          )
        )
          return { rows: [], rowCount: 0 };
        if (sql.startsWith("SELECT 1 FROM c3_open.legs"))
          return { rows: [{}, {}, {}], rowCount: 3 };
        if (sql.startsWith("SELECT 1 FROM c3_open.owner_request_outcomes"))
          return { rows: [], rowCount: 0 };
        if (sql.startsWith("INSERT INTO c3_open.owner_message_receipts")) {
          assert.ok(sql.endsWith("ON CONFLICT(request_id) DO NOTHING"));
          assert.deepEqual(params, [
            requestId,
            proof.slot,
            Buffer.from(proof.evidenceHash, "hex"),
          ]);
          return { rows: [], rowCount: 0 }; // An immutable receipt already exists.
        }
        if (
          sql.startsWith(
            "SELECT slot,evidence_hash FROM c3_open.owner_message_receipts",
          )
        ) {
          assert.ok(sql.endsWith("FOR UPDATE"));
          return { rows: receipt ? [receipt] : [], rowCount: receipt ? 1 : 0 };
        }
        if (
          sql.startsWith("INSERT INTO c3_open.owner_effect_receipts") ||
          sql.startsWith("UPDATE c3_open.intents") ||
          sql.startsWith("INSERT INTO c3_open.events")
        )
          return { rows: [], rowCount: 1 };
        throw Error("UNEXPECTED_SYNTHETIC_WRITER_QUERY: " + sql);
      };
      const pool = {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith("SELECT r.*,s.signature,m.manifest"))
            return { rows: [row], rowCount: 1 };
          return query(sql, params);
        },
        connect: async () => ({
          query,
          release: () => {
            releases++;
          },
        }),
      } as unknown as Pool;
      const reconcile = () =>
        reconcileOwnerEconomicsFromSource(pool, policy, requestId, {
          genesis: async () => f.f.context.blockhash,
          collect: async (signature, accounts) => {
            assert.equal(signature, f.signature);
            assert.deepEqual(
              accounts,
              f.manifest.snapshots.map((s) => s.address),
            );
            return {
              status:
                "FINALIZED_QUORUM_REQUIRES_SEMANTIC_VERIFICATION" as const,
              signature,
              slot: proof.slot,
              accounts,
              statuses: paired({
                value: [
                  {
                    slot: proof.slot,
                    err: null,
                    confirmationStatus: "finalized",
                  },
                ],
              }),
              transaction: paired(f.json),
              snapshots: paired(f.snapshot),
            };
          },
          wire: async () => paired(f.wire),
        });
      if (mode === "matching") {
        assert.deepEqual(await reconcile(), {
          status: "economic_effects_reconciled",
          evidenceHash: proof.evidenceHash,
        });
        for (const prefix of [
          "INSERT INTO c3_open.owner_effect_receipts",
          "UPDATE c3_open.intents",
          "INSERT INTO c3_open.events",
        ])
          assert.equal(
            statements.filter(({ sql }) => sql.startsWith(prefix)).length,
            1,
          );
        assert.equal(statements.at(-1)!.sql, "COMMIT");
      } else {
        await assert.rejects(
          reconcile,
          /C3_OWNER_EFFECT_MESSAGE_RECEIPT_CONFLICT/,
          mode,
        );
        assert.equal(statements.at(-1)!.sql, "ROLLBACK");
        assert.ok(
          !statements.some(
            ({ sql }) =>
              sql === "COMMIT" ||
              sql.startsWith("INSERT INTO c3_open.owner_effect_receipts") ||
              sql.startsWith("UPDATE c3_open.intents") ||
              sql.startsWith("INSERT INTO c3_open.events"),
          ),
          mode,
        );
      }
      assert.equal(canonicalize(receipt ?? null), before, mode);
      assert.equal(releases, 1, mode);
    }
  });
