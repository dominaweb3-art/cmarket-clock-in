/** Offline compatibility tests; no physical MWA, broadcast or Devnet claim. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { EvaluationClient } from "../../../services/c3-mainnet/src/evaluation-client.ts";
import {
  evaluationAssetMints,
  evaluationShareMint,
} from "../../../services/c3-mainnet/src/evaluation-provisioning.ts";
import {
  evaluationOwnerAccounts,
  reviewEvaluationOwnerPacket,
  verifyEvaluationWalletPacket,
  type EvaluationMoneyAction,
} from "../src/evaluation-owner-review.ts";
const {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} = createRequire(
  new URL("../../../services/c3-mainnet/package.json", import.meta.url),
)("@solana/web3.js");
test("five owner packets match official PDA/ATA derivation and exact Borsh bytes", async () => {
  const wallet = Keypair.generate(),
    now = Date.now(),
    time = BigInt(Math.floor(now / 1000)),
    mints = await evaluationAssetMints(),
    share = await evaluationShareMint(String(wallet.publicKey));
  const idl = JSON.parse(
    readFileSync(
      new URL(
        "../../../services/c3-mainnet/resources/c3_devnet_evaluation_vault.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ConstructorParameters<typeof EvaluationClient>[0];
  const client = new EvaluationClient(idl, {
    wallet: String(wallet.publicKey),
    shareMint: String(share),
    usdcMint: String(mints[0]),
    btcMint: String(mints[1]),
    ethMint: String(mints[2]),
    solMint: String(mints[3]),
    version: 1n,
  });
  const derived = evaluationOwnerAccounts(String(wallet.publicKey)),
    official = client.accounts(client.intent("deposit"));
  for (const [name, value] of Object.entries(official)) {
    if (name === "intent") continue;
    assert.deepEqual(
      Buffer.from(derived[name as keyof typeof derived]),
      value.toBuffer(),
      name,
    );
  }
  assert.deepEqual(
    Buffer.from(derived.redemption),
    client.intent("redemption").toBuffer(),
  );
  const actions: EvaluationMoneyAction[] = [
    "deposit",
    "issue_shares",
    "request_redemption",
    "claim",
    "renew_plan",
  ];
  for (const action of actions) {
    const renewal =
      action === "renew_plan"
        ? { direction: 1 as const, revision: 5n }
        : undefined;
    const build = client.compileOwner(
      action,
      time,
      String(Keypair.generate().publicKey),
      1000,
      renewal,
    );
    const result = {
      action,
      chainTime: String(time),
      expiresAt: new Date(now + 45000).toISOString(),
      packet: build.packet.toString("base64"),
      messageHash: build.messageHash.toString("hex"),
      requestId: "11111111-1111-4111-8111-111111111111",
      cluster: "solana:devnet",
      simulatedAssets: true,
      vault: String(client.vault),
      ...(renewal
        ? {
            renewal: {
              direction: renewal.direction,
              revision: String(renewal.revision),
              expiry: String(time + 110n),
            },
          }
        : {}),
    };
    const prepared = reviewEvaluationOwnerPacket(
      result,
      String(wallet.publicKey),
      action,
      now,
    );
    const tx = VersionedTransaction.deserialize(build.packet);
    tx.sign([wallet]);
    assert.deepEqual(
      verifyEvaluationWalletPacket(
        tx.serialize(),
        prepared,
        String(wallet.publicKey),
      ),
      tx.serialize(),
    );
    const tampered = tx.serialize();
    tampered[1] = tampered[1]! ^ 1;
    assert.throws(() =>
      verifyEvaluationWalletPacket(
        tampered,
        prepared,
        String(wallet.publicKey),
      ),
    );
    for (const update of [
      { action: "claim" === action ? "deposit" : "claim" },
      { cluster: "solana:mainnet" },
      { chainTime: String(time - 61n) },
      { expiresAt: new Date(now).toISOString() },
      { vault: String(Keypair.generate().publicKey) },
    ])
      assert.throws(() =>
        reviewEvaluationOwnerPacket(
          { ...result, ...update },
          String(wallet.publicKey),
          action,
          now,
        ),
      );
    // A malicious server rehashes a altered instruction. The independently derived
    // action policy must still reject it, rather than trust the server's digest.
    const original = client.ownerInstructions(action, time, renewal),
      ix = original[0]!;
    const data = Buffer.from(ix.data);
    data[0] = data[0]! ^ 1;
    const replaced = [
      new TransactionInstruction({
        programId: ix.programId,
        keys: ix.keys,
        data,
      }),
      ...original.slice(1),
    ];
    const rejectRehashed = (instructions: typeof original) => {
      const hostile = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: build.blockhash,
        instructions,
      }).compileToV0Message();
      assert.throws(() =>
        reviewEvaluationOwnerPacket(
          {
            ...result,
            packet: Buffer.from(
              new VersionedTransaction(hostile).serialize(),
            ).toString("base64"),
            messageHash: createHash("sha256")
              .update(hostile.serialize())
              .digest("hex"),
          },
          String(wallet.publicKey),
          action,
          now,
        ),
      );
    };
    rejectRehashed(replaced);
    // Same digest is not sufficient: server substitution of a destination,
    // authority, mint, ordered account, privilege or extra instruction is hostile.
    ix.keys.forEach((_, index) => {
      const keys = ix.keys.map((meta, n) =>
        n === index ? { ...meta, pubkey: Keypair.generate().publicKey } : meta,
      );
      rejectRehashed([
        new TransactionInstruction({
          programId: ix.programId,
          keys,
          data: ix.data,
        }),
        ...original.slice(1),
      ]);
    });
    rejectRehashed([
      new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: ix.keys,
        data: ix.data,
      }),
      ...original.slice(1),
    ]);
    rejectRehashed([...original, ix]);
    if (original.length > 1) rejectRehashed([...original].reverse());
    if (renewal) {
      for (const update of [
        { direction: 2 },
        { revision: "6" },
        { expiry: String(time + 109n) },
      ]) {
        assert.throws(() =>
          reviewEvaluationOwnerPacket(
            { ...result, renewal: { ...result.renewal, ...update } },
            String(wallet.publicKey),
            action,
            now,
          ),
        );
      }
      const saleRenewal = { direction: 2 as const, revision: 5n };
      const sale = client.compileOwner(
        action,
        time,
        build.blockhash,
        1000,
        saleRenewal,
      );
      reviewEvaluationOwnerPacket(
        {
          ...result,
          packet: sale.packet.toString("base64"),
          messageHash: sale.messageHash.toString("hex"),
          renewal: { direction: 2, revision: "5", expiry: String(time + 110n) },
        },
        String(wallet.publicKey),
        action,
        now,
      );
    }
  }
  assert.throws(() =>
    evaluationOwnerAccounts(
      PublicKey.findProgramAddressSync(
        [Buffer.from("test")],
        client.program,
      )[0].toBase58(),
    ),
  );
});
