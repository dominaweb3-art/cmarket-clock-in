/** Explicit read-only expiry proof. Never signs, sends, or trusts wall clock.
 * Only a plan that provably never existed can be replaced after owner request. */
import { createHash } from "node:crypto";
import {
  VersionedTransaction,
  PublicKey,
  type Connection,
} from "@solana/web3.js";
import { EVALUATION } from "./evaluation-scope.ts";
import { evaluationCanonical } from "./evaluation-canonical.ts";
const check = (value: unknown, code: string) => {
  if (!value) throw Error("EVAL_INITIAL_PLAN_" + code);
};
export async function captureInitialPlanExpiry(
  rpc: Connection,
  op: {
    operation_id: string;
    unsigned_packet: Uint8Array;
    message_hash: Buffer;
    last_valid_height: string;
    signature?: string;
    context: { kind: string; plan: string; direction: number };
  },
  expectedPlan: string,
) {
  check((await rpc.getGenesisHash()) === EVALUATION.genesis, "NETWORK");
  check(
    op.context.kind === "plan" &&
      op.context.plan === expectedPlan &&
      [1, 2].includes(op.context.direction),
    "CONTEXT",
  );
  const tx = VersionedTransaction.deserialize(op.unsigned_packet);
  check(
    createHash("sha256")
      .update(tx.message.serialize())
      .digest()
      .equals(op.message_hash),
    "MESSAGE",
  );
  const valid = await rpc.isBlockhashValid(tx.message.recentBlockhash, {
    commitment: "finalized",
  });
  const height = await rpc.getBlockHeight("finalized");
  check(
    !valid.value && BigInt(height) > BigInt(op.last_valid_height),
    "ORIGINAL_CAN_STILL_EXECUTE",
  );
  // A present signature, failed or successful, must follow original-message
  // reconciliation. This special path accepts only absent history + expiry.
  if (op.signature) {
    const status = (
      await rpc.getSignatureStatuses([op.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    const transaction = await rpc.getTransaction(op.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    check(!status && !transaction, "ORIGINAL_RECONCILE_FIRST");
  }
  const account = await rpc.getAccountInfoAndContext(
    new PublicKey(expectedPlan),
    { commitment: "finalized", minContextSlot: valid.context.slot },
  );
  check(account.value === null, "PLAN_EXISTS_RECONCILE_FIRST");
  return {
    slot: account.context.slot,
    evidenceHash: createHash("sha256")
      .update(
        evaluationCanonical({
          operation: op.operation_id,
          messageHash: op.message_hash.toString("hex"),
          signature: op.signature ?? null,
          plan: expectedPlan,
          height,
          slot: account.context.slot,
          planAbsent: true,
        }),
      )
      .digest(),
  };
}
