/** Authorized Devnet technical acceptance using the EXISTING evaluation
 * deployer identity, never the owner's Phantom key or Mainnet. Same HTTPS
 * compiler, journals and reconciliation as the APK. NOT physical MWA QA.
 * No uncertain operation is automatically signed or submitted again. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { encodeBase58 } from "../services/c3-mainnet/src/solana.ts";
import {
  reviewEvaluationOwnerPacket,
  verifyEvaluationWalletPacket,
} from "../apps/c3-pilot/src/evaluation-owner-review.ts";
if (process.argv[2] !== "--authorized-devnet-evaluation")
  throw Error("EXPLICIT_DEVNET_EVALUATION_REQUIRED");
const root = new URL("../", import.meta.url);
const bytes = Buffer.from(
  JSON.parse(
    readFileSync(
      new URL("artifacts/c3-devnet-evaluation/private/deployer.json", root),
      "utf8",
    ),
  ),
);
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    bytes.subarray(0, 32),
  ]),
  format: "der",
  type: "pkcs8",
});
bytes.fill(0);
const wallet = encodeBase58(
  createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32),
);
assert.equal(wallet, "6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC");
const origin = "https://cmarket-nine.vercel.app";
const report = {
  cluster: "solana:devnet",
  simulatedAssets: true,
  physicalMWA: false,
  startedAt: new Date().toISOString(),
  wallet,
  operations: [],
  complete: false,
};
let token;
const wait = () => new Promise((r) => setTimeout(r, 5000));
async function call(body) {
  const r = await fetch(origin + "/api/evaluation", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(50000),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok)
    throw Error(
      /^[A-Z0-9_]+$/.test(value.error) ? value.error : "HOSTED_REQUEST_FAILED",
    );
  return value;
}
async function ownerAction(action) {
  let position = await call({ operation: "position" });
  // Explicit expiry recovery of the ORIGINAL request, never a blind resend.
  // The server proves finalized blockhash expiry and unchanged chain effects.
  for (const pending of position.pendingRequests) {
    assert.equal(
      pending.signature,
      null,
      "SIGNED_OR_UNCERTAIN_REQUEST_REQUIRES_RECONCILIATION",
    );
    const closed = await call({
      operation: "close_expired",
      requestId: pending.request_id,
    });
    assert.equal(closed.status, "closed_unexecuted");
    report.operations.push({
      action: "close_expired_unsigned",
      requestId: pending.request_id,
    });
  }
  position = await call({ operation: "position" });
  assert.deepEqual(
    position.pendingRequests,
    [],
    "ORIGINAL_OWNER_REQUEST_REQUIRES_RECONCILIATION",
  );
  assert.ok(position.allowedActions.includes(action));
  const packet = await call({ operation: "prepare", action });
  const prepared = reviewEvaluationOwnerPacket(packet, wallet, action);
  const signed = prepared.packet.slice();
  assert.equal(signed[0], 1);
  signed.set(sign(null, prepared.review.message, key), 1);
  verifyEvaluationWalletPacket(signed, prepared, wallet);
  const submitted = await call({
    operation: "submit",
    requestId: packet.requestId,
    packet: Buffer.from(signed).toString("base64"),
  });
  report.operations.push({
    action,
    requestId: packet.requestId,
    signature: submitted.signature,
  });
  console.log(
    JSON.stringify({
      action,
      status: "SIGNED_ONCE_BY_TEST_IDENTITY",
      signature: submitted.signature,
    }),
  );
  for (let i = 0; i < 15; i++) {
    const result = await call({
      operation: "reconcile",
      requestId: packet.requestId,
    });
    if (["effects_verified", "already_reconciled"].includes(result.status)) {
      console.log(JSON.stringify({ action, status: result.status }));
      return;
    }
    if (result.status === "failed") throw Error("FINALIZED_OWNER_FAILURE");
    await wait();
  }
  throw Error("ORIGINAL_SIGNATURE_UNCERTAIN_NO_RESEND");
}
async function settlement(expected) {
  for (let i = 0; i < 55; i++) {
    const p = await call({ operation: "position" });
    if (p.allowedActions.includes(expected)) return;
    assert.deepEqual(p.pendingRequests, []);
    const value = await call({ operation: "advance" });
    console.log(
      JSON.stringify({
        stage: value.stage,
        state: value.state,
        signature: value.signature,
      }),
    );
    if (value.stage === "failed") throw Error("FINALIZED_SERVICE_FAILURE");
    if (!value.stage?.endsWith("effects_verified")) await wait();
  }
  throw Error("BOUNDED_SETTLEMENT_INCOMPLETE");
}
try {
  const q = await call({ operation: "challenge", wallet });
  token = (
    await call({
      operation: "authenticate",
      challengeId: q.challengeId,
      message: q.message,
      signature: sign(null, Buffer.from(q.message), key).toString("base64"),
    })
  ).sessionToken;
  let provisioned = false;
  for (let i = 0; i < 15; i++) {
    const p = await call({ operation: "provision" });
    console.log(
      JSON.stringify({
        stage: p.stage,
        ready: p.ready,
        signature: p.signature,
      }),
    );
    if (p.ready) {
      provisioned = true;
      break;
    }
    await wait();
  }
  assert.ok(provisioned, "PROVISIONING_INCOMPLETE");
  if (process.argv.includes("--close-expired-original-plan")) {
    const recovered = await call({ operation: "recover_initial_plan" });
    assert.equal(recovered.status, "closed_unexecuted");
    console.log(
      "ORIGINAL_PLAN_EXPIRY_VERIFIED_AND_PRESERVED; NO_AUTOMATIC_RESEND",
    );
    report.operations.push(recovered);
    // Recovery is separate from another dispatch. Operator must explicitly
    // run the normal cycle afterwards; no implicit signing in this command.
    throw Error("ORIGINAL_PLAN_CLOSED_EXPLICIT_REVIEW_REQUIRED");
  }
  const current = await call({ operation: "position" });
  if (process.argv.includes("--owner-renew-plan")) {
    await ownerAction("renew_plan");
  }
  if (current.allowedActions.includes("deposit")) await ownerAction("deposit");
  else if (
    current.intent?.state === "funded" &&
    process.argv.includes("--owner-recover-plan")
  )
    await ownerAction("recover_deposit_plan");
  else
    assert.ok(
      current.intent &&
        [
          "funded",
          "buying",
          "active",
          "redemption_requested",
          "selling",
          "claimable",
          "redeemed",
        ].includes(current.intent.state),
      "RESUME_STATE_REQUIRES_MANUAL_REVIEW",
    );
  let state = (await call({ operation: "position" })).intent.state;
  if (["funded", "buying"].includes(state)) {
    await settlement("issue_shares");
    await ownerAction("issue_shares");
    state = "active";
  }
  if (state === "active") {
    const position = await call({ operation: "position" });
    assert.equal(position.shares, "1000000");
    report.activePosition = {
      shares: position.shares,
      inventory: position.inventory,
    };
    await ownerAction("request_redemption");
    state = "redemption_requested";
  }
  if (["redemption_requested", "selling", "claimable"].includes(state)) {
    await settlement("claim");
    await ownerAction("claim");
  }
  const final = await call({ operation: "position" });
  assert.equal(final.shares, "0");
  assert.ok(BigInt(final.returned) > 0n);
  // Preserve historical failed/uncertain attempts honestly. They are NOT
  // success receipts and must never be hidden merely to make the test pass.
  assert.equal(
    final.activity.filter(
      (r) => r.action === "execute" && r.effects_verified === true,
    ).length,
    6,
  );
  for (const action of [
    "deposit",
    "issue_shares",
    "request_redemption",
    "claim",
  ])
    assert.equal(
      final.activity.filter(
        (r) => r.action === action && r.effects_verified === true,
      ).length,
      1,
    );
  await assert.rejects(
    () => call({ operation: "prepare", action: "claim" }),
    /EVAL_STATE_/,
  );
  report.duplicateClaimRejected = true;
  report.final = final;
  report.complete = true;
  console.log("HOSTED_DEVNET_TECHNICAL_CYCLE_PASS; PHYSICAL_MWA_NOT_VERIFIED");
} catch (error) {
  report.blocker =
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "TECHNICAL_CYCLE_ASSERTION_OR_CONNECTIVITY_FAILED";
  console.log("STOPPED_SAFELY=" + report.blocker);
  process.exitCode = 1;
} finally {
  token = undefined;
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    new URL("artifacts/c3-devnet-evaluation/hosted-cycle.json", root),
    JSON.stringify(report, null, 2),
  );
}
