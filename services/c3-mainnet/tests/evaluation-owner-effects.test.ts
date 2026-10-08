/** Offline hostile RPC evidence tests. In-memory keys sign fixtures only;
 * no wallet callback, network request, submission or economic acquisition. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  Keypair,
  SystemProgram,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import { EvaluationClient, EVAL_TOKEN } from "../src/evaluation-client.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
import { encodeBase58 } from "../src/solana.ts";
import { verifyEvaluationOwnerEffects } from "../src/evaluation-owner-effects.ts";
const idl = JSON.parse(
  readFileSync(
    new URL(
      "../../../artifacts/c3-devnet-evaluation/c3_pilot_vault.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Idl;
function fixture() {
  const wallet = Keypair.generate(),
    mints = Array.from({ length: 5 }, () =>
      Keypair.generate().publicKey.toBase58(),
    );
  const client = new EvaluationClient(idl, {
    wallet: wallet.publicKey.toBase58(),
    version: 1n,
    usdcMint: mints[0]!,
    btcMint: mints[1]!,
    ethMint: mints[2]!,
    solMint: mints[3]!,
    shareMint: mints[4]!,
  });
  const compiled = client.compileOwner(
    "deposit",
    1_800_000_000n,
    mints[1]!,
    99,
  );
  const packet = VersionedTransaction.deserialize(compiled.packet);
  packet.sign([wallet]);
  const signature = encodeBase58(packet.signatures[0]!);
  const names = client.accounts(client.intent("deposit"));
  const index = (key: string) =>
    packet.message.staticAccountKeys.findIndex((v) => v.toBase58() === key);
  const create = Buffer.alloc(52);
  create.writeBigUInt64LE(2_895_360n, 4);
  create.writeBigUInt64LE(288n, 12);
  client.program.toBuffer().copy(create, 20);
  const transfer = Buffer.alloc(10);
  transfer[0] = 12;
  transfer.writeBigUInt64LE(EVALUATION.amount, 1);
  transfer[9] = 6;
  const inner = (program: string, accounts: string[], data: Buffer) => ({
    programIdIndex: index(program),
    accounts: accounts.map(index),
    data: encodeBase58(data),
    stackHeight: 2,
  });
  const token = (name: string, amount: string, owner: string) => ({
    accountIndex: index(names[name]!.toBase58()),
    mint: mints[0]!,
    owner,
    programId: EVAL_TOKEN.toBase58(),
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: Number(amount) / 1e6,
      uiAmountString: "not_trusted",
    },
  });
  const preBalances = packet.message.staticAccountKeys.map(() => 10_000_000);
  preBalances[0] = 100_000_000;
  preBalances[index(names.intent!.toBase58())] = 0;
  const postBalances = [...preBalances];
  postBalances[0]! -= 2_900_360;
  postBalances[index(names.intent!.toBase58())] = 2_895_360;
  const tx: VersionedTransactionResponse = {
    slot: 123,
    blockTime: 1800000000,
    version: 0,
    transaction: { message: packet.message, signatures: [signature] },
    meta: {
      err: null,
      fee: 5000,
      preBalances,
      postBalances,
      innerInstructions: [
        {
          index: 0,
          instructions: [
            inner(
              SystemProgram.programId.toBase58(),
              [client.owner.toBase58(), names.intent!.toBase58()],
              create,
            ),
          ],
        },
        {
          index: 1,
          instructions: [
            inner(
              EVAL_TOKEN.toBase58(),
              [
                names.owner_usdc!.toBase58(),
                mints[0]!,
                names.vault_usdc!.toBase58(),
                client.owner.toBase58(),
              ],
              transfer,
            ),
          ],
        },
      ],
      preTokenBalances: [
        token("owner_usdc", "2000000", client.owner.toBase58()),
        token("vault_usdc", "0", client.authority.toBase58()),
      ],
      postTokenBalances: [
        token("owner_usdc", "1000000", client.owner.toBase58()),
        token("vault_usdc", "1000000", client.authority.toBase58()),
      ],
      logMessages: [],
    },
  };
  return {
    client,
    signature,
    tx,
    approvedHash: compiled.messageHash,
    packet,
    names,
  };
}
test("exact signed owner deposit and complete effect evidence pass only as offline evidence", () => {
  const f = fixture();
  const p = verifyEvaluationOwnerEffects(
    f.client,
    "deposit",
    f.approvedHash,
    f.signature,
    f.tx,
    {},
  );
  assert.equal(p.slot, 123);
  assert.equal(p.evidenceHash.length, 32);
});
test("malicious or incomplete RPC effects fail closed", () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.err = { InstructionError: [1, "InvalidArgument"] };
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.innerInstructions = null;
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.postTokenBalances![0]!.uiTokenAmount.amount = "999999";
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.postTokenBalances![1]!.owner = f.client.owner.toBase58();
    },
    (f: ReturnType<typeof fixture>) => {
      delete f.tx.meta!.preTokenBalances![0]!.owner;
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.preTokenBalances!.pop();
      f.tx.meta!.postTokenBalances!.pop();
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.innerInstructions![1]!.instructions[0]!.accounts.reverse();
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.innerInstructions![1]!.instructions[0]!.data = encodeBase58(
        Buffer.from([4]),
      );
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.meta!.postBalances[0]! += 1;
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.transaction.message.compiledInstructions.reverse();
    },
    (f: ReturnType<typeof fixture>) => {
      f.tx.transaction.signatures[0] = encodeBase58(Buffer.alloc(64));
      f.signature = f.tx.transaction.signatures[0]!;
    },
  ];
  mutations.forEach((mutate) => {
    const f = fixture();
    mutate(f);
    assert.throws(
      () =>
        verifyEvaluationOwnerEffects(
          f.client,
          "deposit",
          f.approvedHash,
          f.signature,
          f.tx,
          {},
        ),
      /EVAL_EFFECT_/,
    );
  });
});
test("the generated IDL declares the exact intent sizes used in custody creation", () => {
  // Anchor account encoding, not only copied test constants, proves layout sizes.
  const f = fixture();
  assert.equal(f.client.coder.accounts.size("DepositIntent"), 288);
  assert.equal(f.client.coder.accounts.size("RedemptionIntent"), 234);
});
