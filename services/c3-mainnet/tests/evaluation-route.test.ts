import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import { EvaluationClient } from "../src/evaluation-client.ts";
import {
  evaluationTestRoute,
  type EvaluationPlanContext,
} from "../src/evaluation-route.ts";
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
const context = (
  direction: 1 | 2,
  leg: number,
  budget: bigint,
): EvaluationPlanContext => {
  const intent = client.intent(direction === 1 ? "deposit" : "redemption");
  return {
    plan: client.pda("c3-plan-v1", intent).toBase58(),
    intent: intent.toBase58(),
    direction,
    leg,
    revision: BigInt(leg),
    registryRevision: 1n,
    registryHash: Buffer.alloc(32, 3),
    policyRevision: 1n,
    inputBudget: budget,
    minimumOutput: 1n,
    created: 1800000000n,
    expires: 1800000110n,
    slot: 1000n,
    registryExpiresSlot: 10000n,
  };
};
test("six TEST envelopes derive outputs, PDA custody and exact canonical seals; no signing", () => {
  for (let leg = 0; leg < 3; leg++) {
    const buy = evaluationTestRoute(
      client,
      context(1, leg, [400000n, 300000n, 300000n][leg]!),
      Buffer.alloc(32, leg + 1),
    );
    assert.equal(buy.payload.length, 300);
    assert.equal(buy.seal.minimumOutput, buy.output);
    assert.equal(buy.keys[0]!.pubkey.toBase58(), client.authority.toBase58());
    assert.equal(buy.keys.length, 9);
    const sell = evaluationTestRoute(
      client,
      context(2, leg, buy.output),
      Buffer.alloc(32, leg + 4),
    );
    assert.equal(sell.input, buy.output);
    assert.equal(sell.output, [396000n, 297000n, 297000n][leg]);
    assert.notDeepEqual(buy.payload, sell.payload);
  }
});
test("reject mint-scope plan substitution, unsafe budget, stale context and unattainable floor", () => {
  const base = context(1, 0, 400000n);
  for (const change of [
    { plan: key() },
    { intent: key() },
    { inputBudget: 399999n },
    { minimumOutput: 40001n },
    { expires: base.created },
    { registryExpiresSlot: base.slot },
    { registryRevision: 0n },
    { leg: 3 },
  ])
    assert.throws(() =>
      evaluationTestRoute(client, { ...base, ...change }, Buffer.alloc(32, 1)),
    );
  assert.throws(() => evaluationTestRoute(client, base, Buffer.alloc(31)));
  const a = evaluationTestRoute(client, base, Buffer.alloc(32, 1));
  const b = evaluationTestRoute(
    client,
    { ...base, revision: 1n },
    Buffer.alloc(32, 1),
  );
  assert.notDeepEqual(a.seal.contextHash, b.seal.contextHash);
  assert.notDeepEqual(a.idempotency, b.idempotency);
});
