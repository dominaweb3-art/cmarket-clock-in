import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Idl } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  EvaluationClient,
  EVAL_TOKEN,
  EVAL_SHARES,
  evaluationAta,
} from "../src/evaluation-client.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
import {
  evaluationAssetMints,
  evaluationShareMint,
  evaluationCreateMint,
  evaluationCreateAta,
  evaluationMintTestTokens,
  evaluationInitializeWallet,
  compileEvaluationProvisioning,
  EVALUATION_MINT_AUTHORITY,
} from "../src/evaluation-provisioning.ts";
import { inspectEvaluationServicePacket } from "../src/evaluation-service-journal.ts";

test("evaluation mint addresses are deterministic, distinct and per-wallet shares", async () => {
  const a = await evaluationAssetMints(),
    b = await evaluationAssetMints();
  assert.deepEqual(a.map(String), b.map(String));
  assert.equal(new Set(a.map(String)).size, 4);
  const wallet = Keypair.generate().publicKey.toBase58();
  assert.equal(
    String(await evaluationShareMint(wallet)),
    String(await evaluationShareMint(wallet)),
  );
  assert.notEqual(
    String(await evaluationShareMint(wallet)),
    String(await evaluationShareMint(Keypair.generate().publicKey.toBase58())),
  );
  await assert.rejects(() =>
    evaluationShareMint(
      PublicKey.findProgramAddressSync(
        [Buffer.from("test")],
        EVAL_TOKEN,
      )[0].toBase58(),
    ),
  );
});
test("legacy and nontransferable share mint layouts follow official SPL encoding", async () => {
  const [usdc] = await evaluationAssetMints();
  const mintAuth = new PublicKey(EVALUATION_MINT_AUTHORITY);
  const legacy = evaluationCreateMint(
    "usdc",
    usdc!,
    undefined,
    mintAuth,
    1_000_000,
  );
  assert.equal(legacy.length, 2);
  assert.equal(
    legacy[0]!.programId.toBase58(),
    SystemProgram.programId.toBase58(),
  );
  const data = legacy[1]!.data;
  assert.equal(data.length, 67);
  assert.equal(data[0], 20);
  assert.equal(data[1], 6);
  assert.deepEqual(data.subarray(2, 34), mintAuth.toBuffer());
  assert.equal(data[34], 0);
  const wallet = Keypair.generate().publicKey.toBase58(),
    share = await evaluationShareMint(wallet);
  const authority = Keypair.generate().publicKey;
  const shares = evaluationCreateMint(
    "shares",
    share,
    wallet,
    authority,
    1_000_000,
  );
  assert.deepEqual(shares[1]!.data, Buffer.from([32]));
  assert.equal(shares[2]!.programId.toBase58(), EVAL_SHARES.toBase58());
  assert.equal(shares[2]!.data[34], 1);
  assert.deepEqual(shares[2]!.data.subarray(35), authority.toBuffer());
  assert.throws(
    () => evaluationCreateMint("usdc", share, undefined, mintAuth, 1),
    /ADDRESS/,
  );
  assert.throws(
    () => evaluationCreateMint("shares", share, undefined, authority, 1),
    /CONFIG/,
  );
});
test("ATA metas, bounded test minting and initialization cannot add wallet signers", async () => {
  const mints = await evaluationAssetMints(),
    owner = Keypair.generate().publicKey;
  const payer = new PublicKey(EVALUATION.governance);
  const share = await evaluationShareMint(owner.toBase58());
  const ata = evaluationCreateAta(payer, share, owner, EVAL_SHARES);
  assert.deepEqual(ata.data, Buffer.from([1]));
  assert.equal(
    ata.keys[1]!.pubkey.toBase58(),
    evaluationAta(share, owner, EVAL_SHARES).toBase58(),
  );
  assert.equal(ata.keys[5]!.pubkey.toBase58(), EVAL_SHARES.toBase58());
  const mint = evaluationMintTestTokens(mints[0]!, owner, 1_000_000n);
  assert.equal(mint.data.readBigUInt64LE(1), 1_000_000n);
  assert.throws(
    () => evaluationMintTestTokens(mints[0]!, owner, 100_000_001n),
    /LIMIT/,
  );
  const idl = JSON.parse(
    readFileSync(
      new URL("../resources/c3_devnet_evaluation_vault.json", import.meta.url),
      "utf8",
    ),
  ) as Idl;
  const c = new EvaluationClient(idl, {
    wallet: owner.toBase58(),
    shareMint: share.toBase58(),
    usdcMint: String(mints[0]),
    btcMint: String(mints[1]),
    ethMint: String(mints[2]),
    solMint: String(mints[3]),
    version: 1n,
  });
  const init = evaluationInitializeWallet(c);
  const packet = compileEvaluationProvisioning(
    [init],
    EVALUATION.governance,
    PublicKey.default.toBase58(),
  ).packet;
  assert.equal(
    inspectEvaluationServicePacket(packet, EVALUATION.governance).tx.message
      .header.numRequiredSignatures,
    1,
  );
  assert.throws(
    () =>
      compileEvaluationProvisioning(
        [mint],
        EVALUATION.governance,
        PublicKey.default.toBase58(),
      ),
    /SIGNERS/,
  );
  const decoded = VersionedTransaction.deserialize(packet);
  decoded.signatures[0]!.fill(1);
  assert.throws(
    () =>
      inspectEvaluationServicePacket(
        decoded.serialize(),
        EVALUATION.governance,
      ),
    /ALREADY_SIGNED/,
  );
});
