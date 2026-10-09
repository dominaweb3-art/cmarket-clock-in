/** Hostile Borsh/RPC fixtures only. Not a Devnet or physical-wallet test. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  Keypair,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { evaluationContextFixture } from "./evaluation-leg-context.test.ts";
import { verifyEvaluationRenewal } from "../src/evaluation-renewal.ts";
import { encodeBase58 } from "../src/solana.ts";
export async function renewalFixture(direction: 1 | 2 = 1, leg = 0) {
  const wallet = Keypair.generate(),
    clock = BigInt(Math.floor(Date.now() / 1000)),
    f = await evaluationContextFixture(direction, leg, clock, wallet.publicKey);
  const account = f.accounts.get(String(f.planAddress))!,
    pre = Buffer.from(account.data[0]!, "base64");
  pre.writeBigInt64LE(clock - 1n, 706);
  const revision = pre.readBigUInt64LE(716),
    compiled = f.c.compileOwner(
      "renew_plan",
      clock,
      Keypair.generate().publicKey.toBase58(),
      1000,
      { direction, revision },
    );
  const tx = VersionedTransaction.deserialize(compiled.packet);
  tx.sign([wallet]);
  const signature = encodeBase58(tx.signatures[0]!);
  const post = Buffer.from(pre);
  post.writeBigInt64LE(clock + 110n, 706);
  post.writeBigUInt64LE(revision + 1n, 716);
  post.fill(0, 860, 900);
  const r = {
    direction,
    revision,
    expires_at: String(clock + 110n),
    pre_state: pre,
    expected_chain_revision: String(revision),
    signature,
    message_hash: compiled.messageHash,
    observed_slot: 1000,
    blockhash: compiled.blockhash,
    last_valid_block_height: 1000,
  };
  const balances = tx.message.staticAccountKeys.map(() => 100000000);
  const evidence = {
    slot: 2000,
    blockTime: Number(clock),
    transaction: { message: tx.message, signatures: [signature] },
    meta: {
      err: null,
      fee: 5000,
      innerInstructions: [],
      preTokenBalances: [],
      postTokenBalances: [],
      preBalances: balances,
      postBalances: balances.map((n, i) => n - (i === 0 ? 5000 : 0)),
      logMessages: [],
    },
  } as VersionedTransactionResponse;
  return {
    ...f,
    wallet,
    clock,
    compiled,
    r,
    evidence,
    account: {
      ...account,
      data: [pre.toString("base64"), "base64"] as [string, "base64"],
    },
    post: {
      ...account,
      data: [post.toString("base64"), "base64"] as [string, "base64"],
    },
  };
}
test("renewal preserves partial purchases/sales exactly; hostile messages and effects fail closed", async () => {
  for (const direction of [1, 2] as const)
    for (const leg of [0, 1, 2]) {
      const f = await renewalFixture(direction, leg),
        proof = verifyEvaluationRenewal(f.c, f.r, f.evidence, f.post);
      assert.equal(proof.revision, String(f.r.revision + 1n));
      for (const offset of [146, 434, 440, 450, 500, 724, 772, 820, 859]) {
        const b = Buffer.from(f.post.data[0], "base64");
        b[offset] = b[offset]! ^ 1;
        assert.throws(
          () =>
            verifyEvaluationRenewal(f.c, f.r, f.evidence, {
              ...f.post,
              data: [b.toString("base64"), "base64"],
            }),
          /INVENTORY_OR_HISTORY_CHANGED/,
        );
      }
      for (const bad of [
        {
          ...f.evidence,
          transaction: {
            ...f.evidence.transaction,
            signatures: ["2".repeat(88)],
          },
        },
        {
          ...f.evidence,
          meta: {
            ...f.evidence.meta!,
            innerInstructions: [{ index: 0, instructions: [{}] }],
          },
        },
        {
          ...f.evidence,
          meta: {
            ...f.evidence.meta!,
            postBalances: f.evidence.meta!.postBalances.map((n) => n - 1),
          },
        },
        {
          ...f.evidence,
          meta: { ...f.evidence.meta!, preTokenBalances: [{}] },
        },
      ])
        assert.throws(() =>
          verifyEvaluationRenewal(
            f.c,
            f.r,
            bad as VersionedTransactionResponse,
            f.post,
          ),
        );
      assert.throws(() =>
        verifyEvaluationRenewal(
          f.c,
          { ...f.r, expected_chain_revision: String(f.r.revision + 1n) },
          f.evidence,
          f.post,
        ),
      );
      assert.throws(() => verifyEvaluationRenewal(f.c, f.r, f.evidence, null));
    }
});
