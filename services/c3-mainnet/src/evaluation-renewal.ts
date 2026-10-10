/** SHARED. Devnet owner renewal only. Finalized expiry barriers and exact plan
 * postimage preserve inventory, original signatures, budgets and minimums. */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  VersionedTransaction,
  type Connection,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import type { Pool, PoolClient } from "pg";
import {
  EvaluationClient,
  type EvaluationRenewal,
} from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import { accountBytes, type OpenAccount } from "./open-state-semantics.ts";
import { decodeBase58 } from "./solana.ts";
import { evaluationCanonical } from "./evaluation-canonical.ts";
const check = (v: unknown, c: string): void => {
  if (!v) throw Error("EVAL_RENEWAL_" + c);
};
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
export const evaluationPendingOperationsSql = `SELECT c.operation_id,c.context,c.context_hash,p.unsigned_packet,p.message_hash,p.last_valid_height,s.signature,r.outcome FROM c3_eval.service_contexts c JOIN c3_eval.service_packets p USING(operation_id) LEFT JOIN c3_eval.service_submissions s USING(operation_id) LEFT JOIN c3_eval.service_receipts r USING(operation_id) WHERE c.intent_id=$1 AND NOT EXISTS(SELECT 1 FROM c3_eval.service_retirements t WHERE t.operation_id=c.operation_id) AND NOT EXISTS(SELECT 1 FROM c3_eval.initial_plan_expirations t WHERE t.operation_id=c.operation_id) AND (r.operation_id IS NULL OR (p.purpose<>'authorize' AND NOT EXISTS(SELECT 1 FROM c3_eval.events e WHERE e.idempotency_hash=c.operation_id))) ORDER BY c.operation_id`;
/** Never treats wall clock alone, a missing transaction or a signature as success. */
export async function captureEvaluationRenewal(
  pool: Pool,
  rpc: Connection,
  client: EvaluationClient,
  row: Record<string, unknown>,
  clock: number,
  slot: number,
) {
  check(row && (row.state === "buying" || row.state === "selling"), "STATE");
  check((await rpc.getGenesisHash()) === EVALUATION.genesis, "NETWORK");
  const direction: 1 | 2 = row.state === "buying" ? 1 : 2,
    plan = client.pda(
      "c3-plan-v1",
      client.intent(direction === 1 ? "deposit" : "redemption"),
    );
  const ops = (
    await pool.query(evaluationPendingOperationsSql, [row.intent_id])
  ).rows;
  let barrierSlot = slot;
  const evidence: unknown[] = [];
  for (const op of ops) {
    const context = op.context;
    check(
      hash(evaluationCanonical(context)).equals(op.context_hash) &&
        context.plan === String(plan) &&
        context.direction === direction &&
        ["authorize", "execute"].includes(context.kind),
      "UNPROMOTED_OPERATION_RECONCILE_FIRST",
    );
    check(op.outcome !== "effects_verified", "SUCCESS_RECONCILE_FIRST");
    const tx = VersionedTransaction.deserialize(op.unsigned_packet);
    check(hash(tx.message.serialize()).equals(op.message_hash), "PACKET_HASH");
    const valid = await rpc.isBlockhashValid(tx.message.recentBlockhash, {
        commitment: "finalized",
      }),
      height = await rpc.getBlockHeight("finalized");
    check(
      !valid.value && BigInt(height) > BigInt(op.last_valid_height),
      "ORIGINAL_PACKET_CAN_STILL_EXECUTE",
    );
    barrierSlot = Math.max(barrierSlot, valid.context.slot);
    if (op.signature) {
      const s = (
        await rpc.getSignatureStatuses([op.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (s) {
        check(
          s.confirmationStatus === "finalized" && s.err,
          "UNCERTAIN_OR_SUCCESS_RECONCILE_FIRST",
        );
        const failed = await rpc.getTransaction(op.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
        check(
          failed?.meta?.err &&
            failed.slot === s.slot &&
            failed.transaction.signatures[0] === op.signature &&
            hash(failed.transaction.message.serialize()).equals(
              op.message_hash,
            ),
          "FAILED_MESSAGE",
        );
        barrierSlot = Math.max(barrierSlot, s.slot);
      }
    }
    evidence.push({
      operation: op.operation_id,
      signature: op.signature ?? null,
      height,
      slot: valid.context.slot,
      messageHash: op.message_hash.toString("hex"),
    });
  }
  const raw = await rpc.getAccountInfoAndContext(plan, {
    commitment: "finalized",
    minContextSlot: barrierSlot,
  });
  check(raw.value, "PLAN_MISSING");
  const account: OpenAccount = {
    owner: raw.value!.owner.toBase58(),
    executable: raw.value!.executable,
    lamports: raw.value!.lamports,
    data: [raw.value!.data.toString("base64"), "base64"],
  };
  const preState = accountBytes(
      account,
      EVALUATION.program,
      901,
      "SettlementPlan",
    ),
    p = client.coder.accounts.decode("SettlementPlan", preState) as Record<
      string,
      unknown
    >;
  const revision = BigInt(String(p.revision)),
    bitmap = Number(p.executed_bitmap);
  check(
    p.schema_version === 2 &&
      String(p.vault) === String(client.vault) &&
      String(p.wallet) === String(client.owner) &&
      String(p.intent) ===
        String(client.intent(direction === 1 ? "deposit" : "redemption")) &&
      p.direction === direction &&
      String(p.router_program) === EVALUATION.router &&
      revision === BigInt(String(row.chain_revision)) &&
      revision < (1n << 64n) - 1n,
    "PLAN_BINDING",
  );
  const finalClock = await rpc.getBlockTime(raw.context.slot);
  check(
    finalClock &&
      Math.abs(Date.now() / 1000 - finalClock) < 60 &&
      finalClock >= clock &&
      BigInt(finalClock) >= BigInt(String(p.expires_at)),
    "NOT_EXPIRED",
  );
  check(
    [0, 1, 3].includes(bitmap) && [1, 2, 4, 5, 6].includes(Number(p.lifecycle)),
    "PROGRESS",
  );
  const legs = (
    await pool.query(
      "SELECT ordinal,state FROM c3_eval.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 ORDER BY ordinal",
      [row.intent_id, direction === 1 ? 0 : 3, direction === 1 ? 2 : 5],
    )
  ).rows;
  check(
    legs.length === 3 &&
      legs.every(
        (l, n) =>
          l.ordinal === (direction === 1 ? 0 : 3) + n &&
          (l.state === "confirmed") === !!(bitmap & (1 << n)) &&
          ["confirmed", "pending", "prepared"].includes(l.state),
      ),
    "DURABLE_PROGRESS",
  );
  const expiry = BigInt(finalClock!) + 110n;
  return {
    direction,
    revision,
    plan: String(plan),
    preState,
    account,
    clock: finalClock!,
    expiry,
    slot: raw.context.slot,
    barrierSlot,
    operations: ops.map((o) => o.operation_id as string),
    evidenceHash: hash(
      evaluationCanonical({
        evidence,
        plan: String(plan),
        preState: preState.toString("base64"),
        slot: raw.context.slot,
        revision: String(revision),
      }),
    ),
  };
}
export async function assertRenewalOperationsUnchanged(
  c: PoolClient,
  intentId: string,
  operations: string[],
) {
  const now = (await c.query(evaluationPendingOperationsSql, [intentId])).rows
    .map((r) => r.operation_id)
    .sort();
  check(
    evaluationCanonical(now) === evaluationCanonical([...operations].sort()),
    "CONCURRENT_OPERATION",
  );
}
/** Exactly the already approved, owner-signed renewal. No token CPI permitted. */
export function verifyEvaluationRenewal(
  client: EvaluationClient,
  r: {
    pre_state: Buffer;
    observed_slot: string | number;
    signature: string;
    message_hash: Buffer;
    direction: 1 | 2;
    expected_chain_revision: string;
    expires_at: string;
    blockhash: string;
    last_valid_block_height: string | number;
  },
  tx: VersionedTransactionResponse,
  post: OpenAccount | null,
) {
  const msg = tx.transaction.message,
    meta = tx.meta,
    pre = Buffer.from(r.pre_state);
  check(
    meta &&
      meta.err === null &&
      tx.slot >= Number(r.observed_slot) &&
      msg.version === 0 &&
      msg.addressTableLookups.length === 0 &&
      msg.header.numRequiredSignatures === 1 &&
      msg.staticAccountKeys[0]?.equals(client.owner) &&
      tx.transaction.signatures.length === 1 &&
      tx.transaction.signatures[0] === r.signature &&
      hash(msg.serialize()).equals(r.message_hash),
    "MESSAGE",
  );
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      client.owner.toBuffer(),
    ]),
    format: "der",
    type: "spki",
  });
  check(
    verify(null, msg.serialize(), key, decodeBase58(r.signature)),
    "SIGNATURE",
  );
  const renewal: EvaluationRenewal = {
    direction: r.direction,
    revision: BigInt(r.expected_chain_revision),
  };
  const expected = client.compileOwner(
    "renew_plan",
    BigInt(r.expires_at) - 110n,
    r.blockhash,
    Number(r.last_valid_block_height),
    renewal,
  );
  check(
    expected.messageHash.equals(r.message_hash) &&
      msg.compiledInstructions.length === 1,
    "APPROVED_INSTRUCTION",
  );
  check(
    meta!.innerInstructions?.every((g) => g.instructions.length === 0) &&
      meta!.preTokenBalances?.length === 0 &&
      meta!.postTokenBalances?.length === 0,
    "UNEXPECTED_CPI",
  );
  check(
    Number.isSafeInteger(meta!.fee) &&
      meta!.fee > 0 &&
      meta!.fee <= 10000 &&
      meta!.preBalances.length === msg.staticAccountKeys.length &&
      meta!.postBalances.length === meta!.preBalances.length &&
      meta!.preBalances.every(
        (v, i) =>
          Number.isSafeInteger(v) &&
          v >= 0 &&
          Number.isSafeInteger(meta!.postBalances[i]) &&
          meta!.postBalances[i]! >= 0 &&
          v - meta!.postBalances[i]! === (i === 0 ? meta!.fee : 0),
      ),
    "LAMPORT_EFFECTS",
  );
  const after = accountBytes(post, EVALUATION.program, 901, "SettlementPlan");
  check(
    pre.length === 901 &&
      pre.readBigUInt64LE(716) === renewal.revision &&
      [0, 1, 3].includes(pre[714]!) &&
      BigInt(r.expires_at) > pre.readBigInt64LE(706),
    "PREIMAGE",
  );
  const expectedPost = Buffer.from(pre);
  expectedPost.writeBigInt64LE(BigInt(r.expires_at), 706);
  expectedPost.writeBigUInt64LE(renewal.revision + 1n, 716);
  expectedPost.fill(0, 860, 900);
  check(after.equals(expectedPost), "INVENTORY_OR_HISTORY_CHANGED");
  return {
    slot: tx.slot,
    postState: after,
    revision: String(renewal.revision + 1n),
    evidenceHash: hash(
      evaluationCanonical({
        signature: r.signature,
        messageHash: r.message_hash.toString("hex"),
        pre: pre.toString("base64"),
        post: after.toString("base64"),
        slot: tx.slot,
      }),
    ),
  };
}
