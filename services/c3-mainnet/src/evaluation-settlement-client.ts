/** Unsigned evaluation-only keeper messages. Quotes must first be durably
 * stored/signed by the server; this compiler never signs, sends or promotes PG. */
import { createHash } from "node:crypto";
import { BN } from "@coral-xyz/anchor";
import {
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { EvaluationClient, EVAL_TOKEN } from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import { evaluationTestRoute } from "./evaluation-route.ts";

type Route = ReturnType<typeof evaluationTestRoute>;
const bn = (n: bigint) => {
  if (n < 0n || n > (1n << 64n) - 1n) throw Error("EVAL_SETTLEMENT_U64");
  return new BN(n.toString());
};
const digest = (...b: Uint8Array[]) =>
  createHash("sha256").update(Buffer.concat(b)).digest();
export function compileEvaluationServicePacket(
  instructions: readonly TransactionInstruction[],
  signer: "governance" | "keeper",
  blockhash: string,
) {
  if (!instructions.length || instructions.length > 3)
    throw Error("EVAL_SETTLEMENT_INSTRUCTION_COUNT");
  const payer = new PublicKey(EVALUATION[signer]);
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...instructions],
  }).compileToV0Message();
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.staticAccountKeys[0]?.equals(payer) ||
    message.addressTableLookups.length !== 0
  )
    throw Error("EVAL_SETTLEMENT_SIGNERS");
  let packet: Uint8Array;
  try {
    packet = new VersionedTransaction(message).serialize();
  } catch {
    throw Error("EVAL_SETTLEMENT_TRANSACTION_TOO_LARGE");
  }
  if (packet.length > 1232)
    throw Error("EVAL_SETTLEMENT_TRANSACTION_TOO_LARGE");
  return {
    packet: Buffer.from(packet),
    messageHash: digest(message.serialize()),
    signer: payer.toBase58(),
    bytes: packet.length,
  };
}
export function evaluationCreatePlan(
  client: EvaluationClient,
  direction: 1 | 2,
  chainTime: bigint,
  acquiredBudgets?: readonly bigint[],
) {
  if (direction !== 1 && direction !== 2)
    throw Error("EVAL_SETTLEMENT_DIRECTION");
  const intent = client.intent(direction === 1 ? "deposit" : "redemption");
  const plan = client.pda("c3-plan-v1", intent);
  if (
    direction === 2 &&
    (!acquiredBudgets ||
      acquiredBudgets.length !== 3 ||
      acquiredBudgets.some((n) => n <= 0n))
  )
    throw Error("EVAL_SETTLEMENT_ACQUIRED_BUDGET_REQUIRED");
  const budgets =
    direction === 1 ? [400000n, 300000n, 300000n] : [...acquiredBudgets!];
  const minimums = budgets.map((n) =>
    direction === 1 ? n / 10n : (n * 99n) / 10n,
  );
  const idempotency = digest(
    Buffer.from("c3-evaluation-plan-v1"),
    plan.toBuffer(),
  );
  const routes = budgets.map((budget, leg) => {
    const data = Buffer.alloc(25);
    digest(Buffer.from("global:swap")).copy(data, 0, 0, 8);
    data.writeBigUInt64LE(budget, 8);
    data.writeBigUInt64LE(minimums[leg]!, 16);
    return [...digest(Buffer.from("c3-evaluation-test-route-v1"), data)];
  });
  const instruction = client.instruction(
    direction === 1
      ? "create_deposit_settlement_plan"
      : "create_redemption_settlement_plan",
    {
      route_hashes: routes,
      minimum_outputs: minimums.map(bn),
      quote_created_at: bn(chainTime),
      expires_at: bn(chainTime + 110n),
      max_slippage_bps: 100,
      idempotency: [...idempotency],
    },
    {
      ...client.accounts(intent),
      keeper: new PublicKey(EVALUATION.keeper),
      plan,
    },
  );
  return { instruction, plan, intent, minimums, idempotency };
}
export function evaluationAuthorizeInstruction(
  client: EvaluationClient,
  route: Route,
  signature: Uint8Array,
) {
  if (signature.length !== 64) throw Error("EVAL_QUOTE_SIGNATURE_SHAPE");
  const ed25519 = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(EVALUATION.quotes).toBytes(),
    signature,
    message: route.payload,
  });
  const instruction = client.instruction(
    "authorize_swap_leg",
    {
      args: {
        idempotency: [...route.idempotency],
        quote_id: [...route.seal.quoteId],
      },
    },
    {
      ...client.accounts(route.intent),
      governance: new PublicKey(EVALUATION.governance),
      registry: route.registry,
      policy: route.policy,
      plan: route.plan,
      source: route.source,
      destination: route.destination,
      router_program: route.router,
      authorization: route.authorization,
      quote_receipt: route.quoteReceipt,
      instructions_sysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    },
  );
  return [ed25519, instruction];
}
export function evaluationExecuteInstruction(
  client: EvaluationClient,
  route: Route,
) {
  const instruction = client.instruction(
    "execute_swap_leg",
    { instruction_data: route.data, flags: route.flags },
    {
      ...client.accounts(route.intent),
      keeper: new PublicKey(EVALUATION.keeper),
      registry: route.registry,
      policy: route.policy,
      plan: route.plan,
      authorization: route.authorization,
      quote_receipt: route.quoteReceipt,
      source: route.source,
      destination: route.destination,
      router_program: route.router,
      token_program: EVAL_TOKEN,
    },
  );
  // Inner PDA signer is NOT an outer wallet signer. Preserve account positions.
  instruction.keys.push(...route.keys.map((k) => ({ ...k, isSigner: false })));
  return instruction;
}
export function evaluationRecordInstruction(
  client: EvaluationClient,
  direction: 1 | 2,
) {
  if (direction !== 1 && direction !== 2)
    throw Error("EVAL_SETTLEMENT_DIRECTION");
  const intent = client.intent(direction === 1 ? "deposit" : "redemption");
  const plan = client.pda("c3-plan-v1", intent);
  const idempotency = digest(
    Buffer.from("c3-evaluation-plan-v1"),
    plan.toBuffer(),
  );
  return client.instruction(
    direction === 1
      ? "record_deposit_settlement"
      : "record_redemption_settlement",
    { settlement_id: [...idempotency] },
    {
      ...client.accounts(intent),
      keeper: new PublicKey(EVALUATION.keeper),
      plan,
      system_program: SystemProgram.programId,
    },
  );
}
