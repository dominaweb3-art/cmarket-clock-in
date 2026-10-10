import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SystemProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { captureInitialPlanExpiry } from "../src/evaluation-initial-plan-expiry.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
test("initial plan recovery requires finalized expiry AND absent original signature/effects; no send or signing", async () => {
  const payer = new PublicKey(EVALUATION.keeper),
    plan = EVALUATION.program;
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: payer,
          lamports: 0,
        }),
      ],
    }).compileToV0Message(),
  );
  const op = {
    operation_id: "a".repeat(64),
    unsigned_packet: tx.serialize(),
    message_hash: createHash("sha256").update(tx.message.serialize()).digest(),
    last_valid_height: "10",
    signature: "test-public-signature",
    context: { kind: "plan", plan, direction: 1 },
  };
  let valid = false,
    height = 11,
    present = false,
    exists = false,
    network: string = EVALUATION.genesis;
  const rpc = {
    getGenesisHash: async () => network,
    isBlockhashValid: async () => ({ value: valid, context: { slot: 20 } }),
    getBlockHeight: async () => height,
    getSignatureStatuses: async () => ({
      value: [present ? { confirmationStatus: "finalized" } : null],
    }),
    getTransaction: async () => null,
    getAccountInfoAndContext: async () => ({
      value: exists ? {} : null,
      context: { slot: 21 },
    }),
    sendRawTransaction: () => {
      throw Error("MUST_NOT_SEND");
    },
  } as unknown as Connection;
  assert.equal((await captureInitialPlanExpiry(rpc, op, plan)).slot, 21);
  valid = true;
  await assert.rejects(
    () => captureInitialPlanExpiry(rpc, op, plan),
    /ORIGINAL_CAN_STILL_EXECUTE/,
  );
  valid = false;
  height = 10;
  await assert.rejects(
    () => captureInitialPlanExpiry(rpc, op, plan),
    /ORIGINAL_CAN_STILL_EXECUTE/,
  );
  height = 11;
  present = true;
  await assert.rejects(
    () => captureInitialPlanExpiry(rpc, op, plan),
    /ORIGINAL_RECONCILE_FIRST/,
  );
  present = false;
  exists = true;
  await assert.rejects(
    () => captureInitialPlanExpiry(rpc, op, plan),
    /PLAN_EXISTS_RECONCILE_FIRST/,
  );
  exists = false;
  await assert.rejects(
    () =>
      captureInitialPlanExpiry(
        rpc,
        { ...op, message_hash: Buffer.alloc(32) },
        plan,
      ),
    /MESSAGE/,
  );
  await assert.rejects(
    () => captureInitialPlanExpiry(rpc, op, EVALUATION.router),
    /CONTEXT/,
  );
  network = "wrong";
  await assert.rejects(
    () => captureInitialPlanExpiry(rpc, op, plan),
    /NETWORK/,
  );
});
