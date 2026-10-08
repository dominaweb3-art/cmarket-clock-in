import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import {
  EvaluationClient,
  EVAL_SHARES,
  EVAL_TOKEN,
} from "../src/evaluation-client.ts";
import { EVALUATION, evaluationPdas } from "../src/evaluation-scope.ts";
import {
  assertEvaluationAction,
  verifyEvaluationConfig,
} from "../src/evaluation-state.ts";
import { verifyShareMintForAuthority } from "../src/open-state-semantics.ts";

// Interface built from the exact Devnet Rust feature, not an invented IDL fixture.
const idl = JSON.parse(
  readFileSync(
    new URL(
      "../../../artifacts/c3-devnet-evaluation/c3_pilot_vault.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Idl;
const owner = Keypair.generate().publicKey; // Public-key derivation only; no wallet callback/signing.
const config = {
  wallet: owner.toBase58(),
  version: 1n,
  shareMint: Keypair.generate().publicKey.toBase58(),
  usdcMint: Keypair.generate().publicKey.toBase58(),
  btcMint: Keypair.generate().publicKey.toBase58(),
  ethMint: Keypair.generate().publicKey.toBase58(),
  solMint: Keypair.generate().publicKey.toBase58(),
};
const client = new EvaluationClient(idl, config);
test("evaluation owner messages bind exact scope, one signer, atomic deposit/claim and size", () => {
  for (const action of [
    "deposit",
    "issue_shares",
    "request_redemption",
    "claim",
  ] as const) {
    const compiled = client.compileOwner(
      action,
      1_800_000_000n,
      Keypair.generate().publicKey.toBase58(),
      999,
    );
    const tx = VersionedTransaction.deserialize(compiled.packet);
    assert.ok(compiled.packet.length <= 1232);
    assert.ok(tx.signatures[0]!.every((v) => v === 0));
    assert.equal(tx.message.header.numRequiredSignatures, 1);
    assert.ok(tx.message.staticAccountKeys[0]!.equals(owner));
    assert.equal(
      tx.message.compiledInstructions.length,
      ["deposit", "request_redemption"].includes(action) ? 2 : 1,
    );
    assert.ok(
      tx.message.compiledInstructions.every((ix) =>
        tx.message.staticAccountKeys[ix.programIdIndex]!.equals(client.program),
      ),
    );
    assert.ok(
      compiled.messageHash.equals(
        createHash("sha256").update(tx.message.serialize()).digest(),
      ),
    );
  }
  const deposit = client.ownerInstructions("deposit", 1_800_000_000n)[0]!;
  const decoded = client.coder.instruction.decode(deposit.data)!;
  assert.equal(
    String((decoded.data as Record<string, unknown>).amount),
    "1000000",
  );
  assert.equal(
    String((decoded.data as Record<string, unknown>).expires_at),
    "1800000300",
  );
  assert.throws(
    () => client.compileOwner("claim", -1n, config.btcMint, 1),
    /U64/,
  );
  assert.throws(
    () => new EvaluationClient({ ...idl, address: EVALUATION.router }, config),
    /IDL_PROGRAM/,
  );
  assert.throws(
    () => new EvaluationClient(idl, { ...config, ethMint: config.btcMint }),
    /DISTINCT_MINTS/,
  );
});
test("cross-owner PDAs and program accounts cannot be substituted", () => {
  const accounts = client.accounts(client.intent("deposit"));
  assert.throws(
    () =>
      client.instruction(
        "deposit_usdc",
        {},
        { ...accounts, owner: Keypair.generate().publicKey },
      ),
    /ACCOUNT_SCOPE/,
  );
  assert.throws(
    () =>
      client.instruction(
        "deposit_usdc",
        {},
        { ...accounts, config: evaluationPdas(config.btcMint).vault },
      ),
    /ACCOUNT_SCOPE/,
  );
  assert.throws(
    () =>
      client.instruction(
        "deposit_usdc",
        {},
        { ...accounts, token_program: EVAL_SHARES },
      ),
    /ACCOUNT_IDENTITY/,
  );
  assert.throws(
    () =>
      client.instruction(
        "claim_usdc",
        {},
        { ...accounts, vault_authority: Keypair.generate().publicKey },
      ),
    /ACCOUNT_SCOPE/,
  );
});
test("exact reviewed config bytes reject changed roles, mints, allocation and limits", () => {
  const data = Buffer.alloc(546),
    accounts = client.accounts(client.intent("deposit"));
  createHash("sha256")
    .update("account:VaultConfig")
    .digest()
    .copy(data, 0, 0, 8);
  data[8] = 1;
  data.writeBigUInt64LE(1n, 9);
  [
    EVALUATION.governance,
    EVALUATION.governance,
    EVALUATION.keeper,
    config.wallet,
  ].forEach((k, i) => new PublicKey(k).toBuffer().copy(data, 17 + i * 32));
  [
    config.usdcMint,
    config.btcMint,
    config.ethMint,
    config.solMint,
    config.shareMint,
  ].forEach((k, i) => new PublicKey(k).toBuffer().copy(data, 146 + i * 32));
  ["vault_usdc", "vault_btc", "vault_eth", "vault_wsol"].forEach((k, i) =>
    accounts[k]!.toBuffer().copy(data, 306 + i * 32),
  );
  [4000, 3000, 3000].forEach((w, i) => data.writeUInt16LE(w, 434 + i * 2));
  data.writeBigUInt64LE(1_000_000n, 440);
  data.writeBigUInt64LE(1_000_000n, 448);
  const seed = createHash("sha256")
    .update("c3-authority-v1")
    .update(owner.toBuffer())
    .digest();
  data[481] = PublicKey.findProgramAddressSync([seed], client.program)[1];
  const raw = (b: Buffer) => ({
    owner: EVALUATION.program,
    executable: false,
    data: [b.toString("base64"), "base64"],
  });
  assert.equal(verifyEvaluationConfig(client, raw(data)).deposits, 0n);
  for (const offset of [
    17, 49, 81, 113, 146, 274, 306, 434, 440, 448, 481, 482,
  ]) {
    const changed = Buffer.from(data);
    changed[offset] = changed[offset]! ^ 1;
    assert.throws(() => verifyEvaluationConfig(client, raw(changed)));
  }
});
test("shares stay non-transferable under the evaluation PDA, with no delegate extension", () => {
  const data = Buffer.alloc(170);
  data.writeUInt32LE(1);
  client.authority.toBuffer().copy(data, 4);
  data[44] = 6;
  data[45] = 1;
  data[165] = 1;
  data.writeUInt16LE(9, 166);
  const raw = (b: Buffer) => ({
    owner: EVAL_SHARES.toBase58(),
    executable: false,
    data: [b.toString("base64"), "base64"],
  });
  assert.equal(
    verifyShareMintForAuthority(client.authority.toBase58(), raw(data)).supply,
    0n,
  );
  assert.throws(
    () => verifyShareMintForAuthority(owner.toBase58(), raw(data)),
    /SHARE_MINT/,
  );
  const bad = Buffer.from(data);
  bad.writeUInt16LE(12, 166);
  assert.throws(
    () => verifyShareMintForAuthority(client.authority.toBase58(), raw(bad)),
    /EXTENSION/,
  );
  assert.throws(() =>
    verifyShareMintForAuthority(client.authority.toBase58(), {
      ...raw(data),
      owner: EVAL_TOKEN.toBase58(),
    }),
  );
});
test("unsolicited inventory does not authorize share issuance or another deposit", () => {
  const p = {
    paused: false,
    lifecycle: 1,
    deposits: 1n,
    redemptions: 0n,
    issued: 0n,
    bytes: Buffer.alloc(0),
    shares: 0n,
    shareSupply: 0n,
    inventory: [0n, 10n, 10n, 10n],
    depositStatus: 2,
    redemptionStatus: null,
    claimable: 0n,
    returned: 0n,
    simulatedAssets: true as const,
    cluster: EVALUATION.cluster,
  };
  assert.throws(() => assertEvaluationAction("issue_shares", p), /UNSETTLED/);
  assert.throws(() => assertEvaluationAction("deposit", p), /ONE_LIFETIME/);
  assert.doesNotThrow(() =>
    assertEvaluationAction("issue_shares", { ...p, depositStatus: 3 }),
  );
  assert.throws(
    () =>
      assertEvaluationAction("claim", { ...p, lifecycle: 4, returned: 99n }),
    /NOT_CLAIMABLE/,
  );
});
