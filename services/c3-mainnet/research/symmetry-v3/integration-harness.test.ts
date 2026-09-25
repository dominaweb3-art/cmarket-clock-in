import assert from "node:assert/strict";
import { test } from "node:test";
import {
  C3_TARGET_BPS,
  DisabledC3SymmetryIntegration,
  INTEGRATION_BLOCKER,
  assessResearchTransition,
  checkedResearchAmount,
  type ResearchTransition,
} from "./integration-contract.ts";
import {
  PUBLIC_EXAMPLE,
  inspectPublicUnsignedCandidate,
  type PublicUnsignedCandidate,
} from "./integration-policy.ts";

const wallet = PUBLIC_EXAMPLE.wallet;
const symmetry = "BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate";
const compute = "ComputeBudget111111111111111111111111111111";
const ix = (
  programId: string,
  discriminator: string,
  accounts: string[] = [],
) => ({ programId, discriminator, accounts });
type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
type MutableCandidate = Mutable<PublicUnsignedCandidate>;
function batch(
  value: MutableCandidate,
  index: number,
): MutableCandidate["batches"][number] {
  const selected = value.batches[index];
  assert.ok(selected);
  return selected;
}
function instruction(
  value: MutableCandidate,
  batchIndex: number,
  instructionIndex: number,
): MutableCandidate["batches"][number]["instructions"][number] {
  const selected = batch(value, batchIndex).instructions[instructionIndex];
  assert.ok(selected);
  return selected;
}
const candidate = (): PublicUnsignedCandidate => ({
  wallet,
  vault: PUBLIC_EXAMPLE.vault,
  shareMint: PUBLIC_EXAMPLE.shareMint,
  amount: 1_000_000n,
  minOutput: null,
  slippageBps: 100,
  observedAt: 100,
  expiresAt: 200,
  hasFinalUsdcEvidence: false,
  walletTokenDebits: [],
  walletSolTransfers: [],
  innerPrograms: [],
  batches: [
    {
      bytes: 975,
      version: "0",
      feePayer: wallet,
      signers: [wallet],
      alts: [],
      instructions: [
        ix("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "01"),
        ix("11111111111111111111111111111111", "02000000d5c14200"),
        ix("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "11"),
        ix(symmetry, "7850f57bd495a32f", [
          wallet,
          wallet,
          PUBLIC_EXAMPLE.vault,
        ]),
        ix(symmetry, "47ccf3b7d1766f5e"),
        ix(symmetry, "7fd7296ef4b38307", [
          wallet,
          wallet,
          PUBLIC_EXAMPLE.vault,
          "",
          "",
          PUBLIC_EXAMPLE.shareMint,
        ]),
        ix(compute, "0240420f00"),
        ix(compute, "03a8610000000000"),
      ],
    },
    {
      bytes: 609,
      version: "0",
      feePayer: wallet,
      signers: [wallet],
      alts: [],
      instructions: [
        {
          ...ix(symmetry, "585c9edb5347efa4", [
            wallet,
            PUBLIC_EXAMPLE.vault,
            "",
            "",
            "",
            "",
            "",
            PUBLIC_EXAMPLE.usdcMint,
            PUBLIC_EXAMPLE.usdcSource,
            PUBLIC_EXAMPLE.usdcVaultDestination,
          ]),
          usdcDepositBaseUnits: 1_000_000n,
        },
        ix(compute, "0240420f00"),
        ix(compute, "03a8610000000000"),
      ],
    },
  ],
});
const mutate = (change: (value: MutableCandidate) => void) => () => {
  const value = structuredClone(candidate()) as MutableCandidate;
  change(value);
  inspectPublicUnsignedCandidate(value);
};

test("synthetic summary of selected public-example fields remains BLOCKED, never a C3 approval", () => {
  assert.equal(inspectPublicUnsignedCandidate(candidate()), "BLOCKED");
  assert.equal(
    Object.values(C3_TARGET_BPS).reduce((a, b) => a + b, 0),
    10_000,
  );
});
test("research amounts enforce exact bigint u64/u128 boundaries", () => {
  for (const bits of [64, 128] as const) {
    const maximum = (1n << BigInt(bits)) - 1n;
    assert.equal(checkedResearchAmount(maximum, bits), maximum);
    assert.throws(
      () => checkedResearchAmount(maximum + 1n, bits),
      new RegExp(INTEGRATION_BLOCKER),
    );
    assert.throws(
      () => checkedResearchAmount(-1n, bits),
      new RegExp(INTEGRATION_BLOCKER),
    );
  }
  assert.throws(
    () => checkedResearchAmount(1 as unknown as bigint, 64),
    new RegExp(INTEGRATION_BLOCKER),
  );
});
test("account, signer, program, amount and size substitutions reject the candidate", () => {
  const attacks: Array<[string, (v: MutableCandidate) => void]> = [
    [
      "wallet",
      (v) => {
        v.wallet = "attacker";
      },
    ],
    [
      "vault destination",
      (v) => {
        instruction(v, 1, 0).accounts[9] = "attacker";
      },
    ],
    [
      "USDC source",
      (v) => {
        instruction(v, 1, 0).accounts[8] = "attacker";
      },
    ],
    [
      "USDC mint",
      (v) => {
        instruction(v, 1, 0).accounts[7] = "attacker";
      },
    ],
    [
      "amount",
      (v) => {
        v.amount = 2_000_000n;
      },
    ],
    [
      "SDK deposit amount field",
      (v) => {
        instruction(v, 1, 0).usdcDepositBaseUnits = 2_000_000n;
      },
    ],
    [
      "share mint",
      (v) => {
        v.shareMint = "fake";
      },
    ],
    [
      "share destination hint",
      (v) => {
        instruction(v, 0, 5).accounts[5] = "fake";
      },
    ],
    [
      "outer program",
      (v) => {
        instruction(v, 1, 0).programId = "unknown";
      },
    ],
    [
      "outer discriminator",
      (v) => {
        instruction(v, 1, 0).discriminator = "deadbeef";
      },
    ],
    [
      "outer order",
      (v) => {
        batch(v, 0).instructions.reverse();
      },
    ],
    [
      "extra instruction",
      (v) => {
        batch(v, 0).instructions.push(ix("unknown", "00"));
      },
    ],
    [
      "signer",
      (v) => {
        batch(v, 0).signers = [wallet, "attacker"];
      },
    ],
    [
      "fee payer",
      (v) => {
        batch(v, 0).feePayer = "attacker";
      },
    ],
    [
      "ALT",
      (v) => {
        batch(v, 0).alts = ["unknown"];
      },
    ],
    [
      "oversized",
      (v) => {
        batch(v, 0).bytes = 1233;
      },
    ],
    [
      "extra token debit",
      (v) => {
        v.walletTokenDebits = ["third-party"];
      },
    ],
    [
      "SOL transfer",
      (v) => {
        v.walletSolTransfers = ["third-party"];
      },
    ],
    [
      "unknown inner CPI",
      (v) => {
        v.innerPrograms = ["unknown"];
      },
    ],
    [
      "missing minimum output portrayed as known",
      (v) => {
        v.minOutput = 1n;
      },
    ],
    [
      "excessive slippage",
      (v) => {
        v.slippageBps = 101;
      },
    ],
    [
      "stale intent",
      (v) => {
        v.observedAt = 201;
      },
    ],
    [
      "fake final USDC",
      (v) => {
        v.hasFinalUsdcEvidence = true;
      },
    ],
  ];
  for (const [label, attack] of attacks)
    assert.throws(
      mutate(attack),
      /PUBLIC_EXAMPLE_UNSIGNED_BUILD_REJECTED/,
      label,
    );
});
test("all nine future integration operations fail closed and cannot call a wallet", async () => {
  const adapter = new DisabledC3SymmetryIntegration();
  for (const call of [
    () => adapter.getVaultSummary(),
    () => adapter.getUserC3Position(wallet),
    () => adapter.quoteDepositUsdc(1_000_000n),
    () => adapter.buildDepositIntent(wallet, 1_000_000n),
    () => adapter.getIntentStatus("i"),
    () => adapter.quoteRedeemToUsdc(1n),
    () => adapter.buildRedeemToUsdcIntent(wallet, 1n),
    () => adapter.getClaimStatus("i"),
    () => adapter.reconcileIntent("i"),
  ])
    await assert.rejects(call(), new RegExp(INTEGRATION_BLOCKER));
});
const transition = (): ResearchTransition => ({
  from: "draft",
  to: "awaiting_wallet",
  actor: "user",
  idempotencyKey: "intent:1",
  intentExpiresAt: 200,
  observedAt: 100,
  walletApproved: false,
  finalizedSignature: null,
  evidence: "UNKNOWN",
  explicitResume: false,
});
test("candidate state transitions reject duplicates, unknown evidence, expiry and silent recovery", () => {
  assert.equal(
    assessResearchTransition(transition(), new Set()),
    "awaiting_wallet",
  );
  assert.throws(
    () => assessResearchTransition(transition(), new Set(["intent:1"])),
    /NOT_APPROVED/,
  );
  assert.throws(
    () =>
      assessResearchTransition({ ...transition(), to: "active" }, new Set()),
    /NOT_APPROVED/,
  );
  assert.throws(
    () =>
      assessResearchTransition(
        {
          ...transition(),
          from: "awaiting_wallet",
          to: "intent_submitted",
          actor: "wallet",
        },
        new Set(),
      ),
    /NOT_APPROVED/,
  );
  assert.throws(
    () =>
      assessResearchTransition({ ...transition(), observedAt: 201 }, new Set()),
    /NOT_APPROVED/,
  );
  assert.throws(
    () =>
      assessResearchTransition(
        { ...transition(), from: "failed_recoverable", to: "manual_review" },
        new Set(),
      ),
    /NOT_APPROVED/,
  );
  assert.throws(
    () =>
      assessResearchTransition(
        {
          ...transition(),
          from: "usdc_claimable",
          to: "usdc_received",
          finalizedSignature: "sig",
          evidence: "VERIFIED",
        },
        new Set(),
      ),
    /NOT_APPROVED/,
  );
  assert.equal(
    assessResearchTransition(
      { ...transition(), from: "rebalance_pending", to: "partially_completed" },
      new Set(),
    ),
    "partially_completed",
  );
});
