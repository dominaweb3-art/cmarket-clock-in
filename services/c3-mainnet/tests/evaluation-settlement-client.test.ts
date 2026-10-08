import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import { EvaluationClient } from "../src/evaluation-client.ts";
import { evaluationTestRoute } from "../src/evaluation-route.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
import {
  compileEvaluationServicePacket,
  evaluationCreatePlan,
  evaluationAuthorizeInstruction,
  evaluationExecuteInstruction,
  evaluationRecordInstruction,
} from "../src/evaluation-settlement-client.ts";
const key = () => Keypair.generate().publicKey.toBase58();
const idl = JSON.parse(
  readFileSync(
    new URL("../resources/c3_devnet_evaluation_vault.json", import.meta.url),
    "utf8",
  ),
) as Idl;
const client = new EvaluationClient(idl, {
  wallet: key(),
  version: 1n,
  shareMint: key(),
  usdcMint: key(),
  btcMint: key(),
  ethMint: key(),
  solMint: key(),
});
test("all six evaluation leg messages compile below 1232 with separated bounded signers", () => {
  const measurements: Record<string, number> = {};
  for (const direction of [1, 2] as const) {
    const p = evaluationCreatePlan(client, direction, 1800000000n, [
      40000n,
      30000n,
      30000n,
    ]);
    const packet = compileEvaluationServicePacket(
      [p.instruction],
      "keeper",
      key(),
    );
    assert.equal(packet.signer, EVALUATION.keeper);
    measurements[`plan-${direction}`] = packet.bytes;
    for (let leg = 0; leg < 3; leg++) {
      const route = evaluationTestRoute(
        client,
        {
          plan: p.plan.toBase58(),
          intent: p.intent.toBase58(),
          direction,
          leg,
          revision: BigInt(leg),
          registryRevision: 1n,
          registryHash: Buffer.alloc(32, 1),
          policyRevision: 1n,
          inputBudget: (direction === 1
            ? [400000n, 300000n, 300000n]
            : [40000n, 30000n, 30000n])[leg]!,
          minimumOutput: p.minimums[leg]!,
          created: 1800000000n,
          expires: 1800000110n,
          slot: 1000n,
          registryExpiresSlot: 10000n,
        },
        Buffer.alloc(32, leg + 1),
      );
      // Placeholder quote signature measures bytes only, NOT Ed25519 execution.
      const auth = compileEvaluationServicePacket(
        evaluationAuthorizeInstruction(client, route, Buffer.alloc(64)),
        "governance",
        key(),
      );
      const execution = compileEvaluationServicePacket(
        [evaluationExecuteInstruction(client, route)],
        "keeper",
        key(),
      );
      assert.ok(auth.bytes <= 1232 && execution.bytes <= 1232);
      assert.equal(auth.signer, EVALUATION.governance);
      for (const wire of [auth.packet, execution.packet])
        assert.ok(
          VersionedTransaction.deserialize(wire).signatures[0]!.every(
            (n) => n === 0,
          ),
        );
      measurements[`auth-${direction}-${leg}`] = auth.bytes;
      measurements[`execute-${direction}-${leg}`] = execution.bytes;
    }
    const recordIx = evaluationRecordInstruction(client, direction);
    const record = compileEvaluationServicePacket([recordIx], "keeper", key());
    measurements[`record-${direction}`] = record.bytes;
    assert.deepEqual(
      recordIx.data.subarray(8),
      createHash("sha256")
        .update(
          Buffer.concat([
            Buffer.from("c3-evaluation-plan-v1"),
            p.plan.toBuffer(),
          ]),
        )
        .digest(),
      "record must bind the real settlement_id, not a missing array encoded as zero",
    );
    assert.throws(
      () =>
        client.instruction(
          direction === 1
            ? "record_deposit_settlement"
            : "record_redemption_settlement",
          { idempotency: Array(32).fill(0) },
          { ...client.accounts(p.intent), keeper: client.owner, plan: p.plan },
        ),
      /ARGUMENTS/,
    );
  }
  console.log("UNSIGNED_SIZE_MEASUREMENT_ONLY", JSON.stringify(measurements));
});
test("sale budgets must come from acquired inventory; cannot request extra wallet signer", () => {
  assert.throws(
    () => evaluationCreatePlan(client, 2, 1800000000n),
    /ACQUIRED_BUDGET/,
  );
  const p = evaluationCreatePlan(client, 1, 1800000000n);
  assert.throws(
    () => compileEvaluationServicePacket([p.instruction], "governance", key()),
    /SIGNERS/,
  );
});
