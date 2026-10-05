/** Hostile economic-amendment fixtures, no RPC, signer or wallet callback. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  proposeMinimumResolution,
  validateMinimumResolution,
  renewalPostimage,
} from "../src/open-minimum-resolution.ts";
import { canonicalize } from "../src/manifest.ts";
import { compileTrustedOwnerPacket } from "../src/open-owner-compiler.ts";
import { completedCompilerFixture } from "./open-owner-compiler.test.ts";
import type {
  StoredQuoteContext,
  ValidatedQuoteMaterial,
} from "../src/open-quote-context.ts";
import { openQuoteContext } from "../src/open-quote-context.ts";
import { validateResolutionReview } from "../../../apps/c3-pilot/src/minimum-resolution.ts";
import { ownerTemplates } from "../../../apps/c3-pilot/src/owner-policy.ts";
import { inspectOwnerTransaction } from "../../../apps/c3-pilot/src/owner-transaction-review.ts";
import { publicKeyBytes } from "../src/solana.ts";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
function fixture(selling = false, bitmap = 1) {
  const f = completedCompilerFixture(selling),
    p = f.plan;
  p[714] = bitmap;
  p[715] = selling ? (bitmap ? 5 : 4) : bitmap ? 2 : 1;
  f.context.state = selling ? "selling" : "buying";
  f.intent[113] = 2;
  for (let n = 0; n < 3; n++)
    if ((bitmap & (1 << n)) === 0) {
      p.writeBigUInt64LE(0n, 756 + 8 * n);
      p.writeBigUInt64LE(0n, 804 + 8 * n);
      p.writeBigUInt64LE(1000n, 672 + 8 * n);
    }
  const plan = selling ? f.a.redemptionPlan : f.a.depositPlan,
    intent = selling ? f.a.redemption : f.a.deposit;
  f.accounts[plan] = f.raw(p, f.policy.program);
  f.accounts[intent] = f.raw(f.intent, f.policy.program);
  const leg = bitmap === 0 ? 0 : bitmap === 1 ? 1 : 2;
  const context = {
    planRevision: "3",
    leg,
    maxSlippageBps: 100,
    economicReviewOnly: true,
  } as StoredQuoteContext;
  const material = {
    quotedOutput: 900n,
    jupiterThreshold: 896n,
    slippageBps: 100,
    expiresAt: 1025n,
    builderTimestamp: 1000n,
    unsignedPacketBytes: 1000,
  } as ValidatedQuoteMaterial;
  const r = proposeMinimumResolution(p, context, material, 1000);
  return { ...f, r, reviewContext: context, material, planBytes: p };
}
test("next-floor proposal preserves all other legs and matches mobile canonical review", () => {
  for (const selling of [false, true])
    for (const bitmap of [0, 1, 3]) {
      const f = fixture(selling, bitmap);
      validateMinimumResolution(f.r, f.planBytes, 1000);
      validateResolutionReview(f.r, 1000);
      assert.equal(f.r.newMinimum, "896");
      const compiled = compileTrustedOwnerPacket(
        f.policy,
        { ...f.context, minimumResolution: f.r },
        f.idl,
        "renew_plan",
      );
      assert.ok(compiled.packet.length <= 1232);
      const policy = {
        wallet: publicKeyBytes(f.policy.wallet),
        program: publicKeyBytes(f.policy.program),
        accounts: Object.fromEntries(
          Object.entries({
            ...compiled.accounts,
            deposit_plan: f.a.depositPlan,
            redemption_plan: f.a.redemptionPlan,
          }).map(([k, v]) => [k, publicKeyBytes(v)]),
        ),
      };
      const review = {
        chainRevision: f.context.chainRevision,
        planDirection: selling ? ("sell" as const) : ("buy" as const),
        minimumResolution: f.r,
      };
      assert.ok(
        inspectOwnerTransaction(
          compiled.packet,
          policy.wallet,
          ownerTemplates(policy, "renew_plan", f.context.expiry, 1000, review),
        ),
      );
      assert.throws(() =>
        inspectOwnerTransaction(
          compiled.packet,
          policy.wallet,
          ownerTemplates(policy, "renew_plan", f.context.expiry, 1000, {
            chainRevision: review.chainRevision,
            planDirection: review.planDirection,
          }),
        ),
      );
      assert.throws(() =>
        ownerTemplates(policy, "renew_plan", f.context.expiry, 1025, review),
      );
      assert.deepEqual(
        compiled.manifest.budgets,
        f.planBytes.subarray(780, 804).length
          ? [0, 1, 2].map((n) =>
              f.planBytes.readBigUInt64LE(780 + 8 * n).toString(),
            )
          : [],
      );
    }
});
test("review metadata cannot become a swap authorization", () => {
  assert.throws(
    () => openQuoteContext(fixture().reviewContext),
    /REVIEW_NOT_EXECUTABLE/,
  );
});
test("threshold alone below old floor never allows reducing an achievable floor", () => {
  const f = fixture();
  assert.throws(
    () =>
      proposeMinimumResolution(
        f.planBytes,
        f.reviewContext,
        { ...f.material, quotedOutput: 1100n },
        1000,
      ),
    /NOT_REQUIRED/,
  );
  for (const m of [
    { ...f.material, expiresAt: 1000n },
    { ...f.material, unsignedPacketBytes: 1233 },
    { ...f.material, slippageBps: 101 },
    { ...f.material, jupiterThreshold: 901n },
  ])
    assert.throws(() =>
      proposeMinimumResolution(f.planBytes, f.reviewContext, m, 1000),
    );
});
test("metadata mutation, malformed integers, stale/preimage/revision and unapproved leg fail closed", () => {
  const f = fixture();
  for (const change of [
    { newMinimum: "895" },
    { quotedOutput: "1100" },
    { jupiterThreshold: "899" },
    { leg: 2 },
    { planHash: "f".repeat(64) },
    { quoteExpiresAt: 1000 },
    { minima: ["1", "896", "999"] },
    { newMinimum: "18446744073709551616" },
  ]) {
    const r = { ...f.r, ...change };
    const { evidenceHash: _h, ...body } = r;
    void _h;
    const changed = { ...r, evidenceHash: hash(canonicalize(body)) };
    assert.throws(
      () => validateMinimumResolution(changed, f.planBytes, 1000),
      /C3_/,
      JSON.stringify(change),
    );
  }
  const changed = Buffer.from(f.planBytes);
  changed.writeBigUInt64LE(1001n, 680);
  assert.throws(() => validateMinimumResolution(f.r, changed, 1000));
  assert.throws(() =>
    proposeMinimumResolution(
      f.planBytes,
      { ...f.reviewContext, planRevision: "2" },
      f.material,
      1000,
    ),
  );
});
test("signed economic postimage permits ONLY the next floor, expiry, revision and retired seal", () => {
  const f = fixture(),
    data = Buffer.alloc(120);
  createHash("sha256")
    .update("global:resolve_settlement_minimums")
    .digest()
    .copy(data, 0, 0, 8);
  data.writeBigUInt64LE(3n, 8);
  data.writeBigInt64LE(1120n, 16);
  Buffer.from(f.r.planHash, "hex").copy(data, 24);
  f.r.minima.forEach((v, n) => data.writeBigUInt64LE(BigInt(v), 56 + 8 * n));
  Buffer.from(f.r.evidenceHash, "hex").copy(data, 80);
  data.writeBigInt64LE(1025n, 112);
  const post = renewalPostimage(f.planBytes, data, 3n, 1120n);
  assert.equal(post.readBigUInt64LE(680), 896n);
  assert.equal(post.readBigUInt64LE(716), 4n);
  assert.deepEqual(post.subarray(756, 860), f.planBytes.subarray(756, 860));
  for (const offset of [8, 24, 56, 72]) {
    const d = Buffer.from(data);
    d[offset] = d[offset]! ^ 1;
    assert.throws(() => renewalPostimage(f.planBytes, d, 3n, 1120n));
  }
  const stale = Buffer.from(data);
  stale.writeBigInt64LE(990n, 112);
  assert.throws(() => renewalPostimage(f.planBytes, stale, 3n, 1120n));
  assert.throws(() =>
    renewalPostimage(f.planBytes, Buffer.alloc(0), 3n, 1120n),
  );
});
