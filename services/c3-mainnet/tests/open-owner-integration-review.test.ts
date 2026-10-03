/** Shared server compiler -> independent mobile template -> signed evidence
 * verifier. Ephemeral crypto only, no wallet callback, RPC or broadcast. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { VersionedTransaction } from "@solana/web3.js";
import {
  compilerFixture,
  completedCompilerFixture,
} from "./open-owner-compiler.test.ts";
import { compileTrustedOwnerPacket } from "../src/open-owner-compiler.ts";
import { verifyOwnerRenewalEvidence } from "../src/open-owner-renewal.ts";
import { publicKeyBytes, encodeBase58 } from "../src/solana.ts";
import {
  ownerTemplates,
  type OwnerPolicy,
} from "../../../apps/c3-pilot/src/owner-policy.ts";
import { inspectOwnerTransaction } from "../../../apps/c3-pilot/src/owner-transaction-review.ts";
import { C3_MAINNET } from "../src/constants.ts";
test("the same server owner/renewal packet passes independent mobile review", () => {
  for (const action of [
    "deposit",
    "issue_shares",
    "claim",
    "renew_plan",
  ] as const) {
    const f =
      action === "deposit"
        ? compilerFixture()
        : completedCompilerFixture(action === "claim");
    if (action === "renew_plan") {
      const f2 = f as ReturnType<typeof completedCompilerFixture>;
      f2.plan[714] = 0;
      f2.plan[715] = 1;
      f2.intent[113] = 2;
      for (let i = 0; i < 3; i++) {
        f2.plan.writeBigUInt64LE(0n, 756 + i * 8);
        f2.plan.writeBigUInt64LE(0n, 804 + i * 8);
      }
      f2.accounts[f2.a.depositPlan] = f2.raw(f2.plan, f2.policy.program);
      f2.accounts[f2.a.deposit] = f2.raw(f2.intent, f2.policy.program);
    }
    const compiled = compileTrustedOwnerPacket(
      f.policy,
      f.context,
      f.idl,
      action,
    );
    const policy: OwnerPolicy = {
      wallet: publicKeyBytes(f.policy.wallet),
      program: publicKeyBytes(f.policy.program),
      accounts: Object.fromEntries(
        Object.entries({
          ...compiled.accounts,
          deposit_intent: f.a.deposit,
          redemption_intent: f.a.redemption,
          deposit_plan: f.a.depositPlan,
          redemption_plan: f.a.redemptionPlan,
        }).map(([k, v]) => [k, publicKeyBytes(v)]),
      ),
    };
    const templates = ownerTemplates(
      policy,
      action,
      f.context.expiry,
      f.context.chainNow,
      action === "renew_plan"
        ? { chainRevision: f.context.chainRevision, planDirection: "buy" }
        : undefined,
    );
    assert.ok(
      inspectOwnerTransaction(compiled.packet, policy.wallet, templates),
    );
    if (action === "renew_plan") {
      assert.throws(() =>
        inspectOwnerTransaction(
          compiled.packet,
          policy.wallet,
          ownerTemplates(policy, action, f.context.expiry, f.context.chainNow, {
            chainRevision: "4",
            planDirection: "buy",
          }),
        ),
      );
      assert.throws(() =>
        inspectOwnerTransaction(
          compiled.packet,
          policy.wallet,
          ownerTemplates(policy, action, f.context.expiry, f.context.chainNow, {
            chainRevision: "3",
            planDirection: "sell",
          }),
        ),
      );
    }
  }
});
test("renewal evidence rejects changed inventory, fee drain, CPI, message and signature", () => {
  const f = completedCompilerFixture();
  f.plan[714] = 0;
  f.plan[715] = 1;
  f.intent[113] = 2;
  for (let i = 0; i < 3; i++) {
    f.plan.writeBigUInt64LE(0n, 756 + i * 8);
    f.plan.writeBigUInt64LE(0n, 804 + i * 8);
  }
  f.accounts[f.a.depositPlan] = f.raw(f.plan, f.policy.program);
  f.accounts[f.a.deposit] = f.raw(f.intent, f.policy.program);
  const compiled = compileTrustedOwnerPacket(
      f.policy,
      f.context,
      f.idl,
      "renew_plan",
    ),
    tx = VersionedTransaction.deserialize(compiled.packet);
  tx.sign([f.wallet]);
  const packet = Buffer.from(tx.serialize()),
    signature = encodeBase58(tx.signatures[0]!),
    n = tx.message.staticAccountKeys.length;
  const meta = {
    err: null,
    fee: 5000,
    innerInstructions: [],
    preTokenBalances: [],
    postTokenBalances: [],
    preBalances: Array(n).fill(10000000) as number[],
    postBalances: Array(n).fill(10000000) as number[],
  };
  meta.postBalances[0] = meta.postBalances[0]! - 5000;
  const wire = {
      slot: 42,
      transaction: [packet.toString("base64"), "base64"],
      meta,
    },
    transaction = { slot: 42, transaction: { signatures: [signature] }, meta },
    after = Buffer.from(f.plan);
  after.writeBigInt64LE(BigInt(f.context.expiry), 706);
  after.writeBigUInt64LE(4n, 716);
  after.fill(0, 860, 900);
  const snapshot = {
      context: { slot: 43 },
      value: [f.raw(after, f.policy.program)],
    },
    request = {
      wallet: f.policy.wallet,
      program: f.policy.program,
      plan: f.a.depositPlan,
      signature,
      messageHash: Buffer.from(compiled.messageHash, "hex"),
      preState: f.plan,
      revision: "3",
      expiry: String(f.context.expiry),
      observedSlot: 40,
    };
  assert.equal(
    verifyOwnerRenewalEvidence(request, wire, transaction, snapshot).revision,
    "4",
  );
  for (const defect of ["inventory", "fee", "CPI", "message", "signature"]) {
    const w = structuredClone(wire),
      t = structuredClone(transaction),
      s = structuredClone(snapshot);
    if (defect === "inventory") {
      const b = Buffer.from(after);
      b.writeBigUInt64LE(2n, 780);
      s.value = [f.raw(b, f.policy.program)];
    }
    if (defect === "fee") {
      w.meta.postBalances[1]!--;
      t.meta.postBalances[1]!--;
    }
    if (defect === "CPI") {
      (w.meta.innerInstructions as unknown[]).push({
        instructions: [{ program: C3_MAINNET.tokenProgram }],
      });
      (t.meta.innerInstructions as unknown[]).push({
        instructions: [{ program: C3_MAINNET.tokenProgram }],
      });
    }
    if (defect === "message" || defect === "signature") {
      const b = Buffer.from(packet);
      const index = defect === "message" ? 100 : 1;
      b[index] = b[index]! ^ 1;
      w.transaction[0] = b.toString("base64");
    }
    assert.throws(
      () => verifyOwnerRenewalEvidence(request, w, t, s),
      /C3_/,
      defect,
    );
  }
});
