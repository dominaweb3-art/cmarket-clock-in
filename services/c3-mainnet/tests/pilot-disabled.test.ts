import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { C3_MAINNET_EXECUTION_CAPABILITY } from "../src/constants.ts";
import { C3_PILOT, inspectC3PilotConfiguration } from "../src/pilot-config.ts";
import { DisabledC3OwnerPilotService } from "../src/pilot-service.ts";
import type { DisabledPilotRepository } from "../src/pilot-postgres.ts";
import {
  assertPilotTransition,
  requiresIndependentReconciliation,
} from "../src/pilot-state.ts";

const template = JSON.parse(
  readFileSync(
    new URL("../config/c3-pilot.template.json", import.meta.url),
    "utf8",
  ),
);
const hash = "a".repeat(64);

test("immutable C3 pilot allocation and disabled execution", () => {
  assert.deepEqual(C3_PILOT.targetBps, { btc: 4000, eth: 3000, sol: 3000 });
  assert.equal(
    Object.values(C3_PILOT.targetBps).reduce((a, b) => a + b, 0),
    10000,
  );
  assert.equal(C3_PILOT.amountUsdcBaseUnits, 1_000_000n);
  assert.equal(C3_PILOT.aggregateTvlCapUsdcBaseUnits, 1_000_000n);
  assert.equal(C3_MAINNET_EXECUTION_CAPABILITY, false);
  const reasons = inspectC3PilotConfiguration(template);
  for (const expected of [
    "vault_address",
    "share_mint",
    "single_owner_wallet",
    "independent_rpc_providers",
    "security_approval",
    "squads_governance_approval",
  ])
    assert.ok(reasons.includes(expected), expected);
  assert.ok(reasons.length >= 6);
});

test("transitions distinguish two wallet approvals and require reconciled evidence", () => {
  assertPilotTransition({
    kind: "deposit",
    from: "draft",
    to: "awaiting_wallet",
    idempotencyKey: hash,
  });
  assertPilotTransition({
    kind: "deposit",
    from: "awaiting_wallet",
    to: "deposit_tx_1_approved",
    idempotencyKey: hash,
    authorizationFingerprint: hash,
  });
  assert.throws(
    () =>
      assertPilotTransition({
        kind: "deposit",
        from: "awaiting_wallet",
        to: "deposit_tx_1_submitted",
        idempotencyKey: hash,
      }),
    /INVALID_TRANSITION/,
  );
  assert.throws(
    () =>
      assertPilotTransition({
        kind: "deposit",
        from: "deposit_tx_1_submitted",
        to: "deposit_tx_1_confirmed",
        idempotencyKey: hash,
      }),
    /INDEPENDENT_EVIDENCE_REQUIRED/,
  );
  assert.equal(requiresIndependentReconciliation("active"), true);
  assert.equal(requiresIndependentReconciliation("completed"), true);
  assert.throws(
    () =>
      assertPilotTransition({
        kind: "redemption",
        from: "redemption_submitted",
        to: "completed",
        idempotencyKey: hash,
        finalizedEvidenceHash: hash,
      }),
    /INVALID_TRANSITION/,
  );
  assert.throws(
    () =>
      assertPilotTransition({
        kind: "deposit",
        from: "deposit_tx_1_submitted",
        to: "cancelled",
        idempotencyKey: hash,
      }),
    /INVALID_TRANSITION/,
  );
});

test("all wallet, build and reconciliation entry points fail closed without callbacks", async () => {
  let reads = 0;
  const repository = {
    readIntent: async () => {
      reads += 1;
      return null;
    },
    listActivity: async () => {
      reads += 1;
      return [];
    },
  } as unknown as DisabledPilotRepository;
  const service = new DisabledC3OwnerPilotService(repository, template);
  const blocked = [
    service.buildDepositIntent("wallet", 1_000_000n),
    service.recordWalletApproval("intent", { secret: "not-persisted" }),
    service.recordSubmission("intent", "signature"),
    service.buildRedeemToUsdcIntent("wallet", 1n),
    service.reconcileIntent("intent"),
  ];
  for (const action of blocked) await assert.rejects(action, /NOT_APPROVED/);
  assert.equal(reads, 0);
  assert.equal((await service.getVaultSummary()).navUsdcBaseUnits, null);
  assert.equal((await service.quoteDepositUsdc(1_000_000n)).executable, false);
  await assert.rejects(
    service.quoteDepositUsdc(999_999n),
    /EXACTLY_ONE_USDC_REQUIRED/,
  );
  assert.equal(reads, 0);
});
