/** Offline exact-wire validation. Does not stand in for physical MWA acceptance. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EvaluationClient } from "../../../services/c3-mainnet/src/evaluation-client.ts";
import {
  evaluationBudgets,
  evaluationAmount,
  evaluationPdas,
} from "../../../services/c3-mainnet/src/evaluation-scope.ts";
import {
  evaluationAssetMints,
  evaluationShareMint,
} from "../../../services/c3-mainnet/src/evaluation-provisioning.ts";
import { purchaseUnits, purchaseCopy } from "../src/evaluation-purchase.ts";
import {
  evaluationOwnerAccounts,
  reviewEvaluationOwnerPacket,
} from "../src/evaluation-owner-review.ts";
const { Keypair } = createRequire(
  new URL("../../../services/c3-mainnet/package.json", import.meta.url),
)("@solana/web3.js");
test("expired HTTPS ownership is visibly invalidated without deleting historical position or signatures", () => {
  const source = readFileSync(
    new URL("../src/DevnetEvaluationApp.tsx", import.meta.url),
    "utf8",
  );
  const branch = source.slice(
    source.indexOf('if (code === "EVAL_AUTH_SESSION"'),
    source.indexOf("setStatus(code)"),
  );
  for (const required of [
    "session.current = undefined",
    "setVerified(false)",
    "setWalletOpen(true)",
  ])
    assert.ok(branch.includes(required));
  assert.ok(!branch.includes("setPosition(null)"));
  assert.ok(!branch.includes("signEvaluationTransaction"));
});
test("decimal purchases have no float rounding and allocation always sums to the exact input", () => {
  for (const [decimal, units] of [
    ["1", "1000000"],
    ["1.000001", "1000001"],
    ["10,234567", "10234567"],
    ["100", "100000000"],
    ["200", "200000000"],
  ]) {
    const amount = purchaseUnits(decimal!);
    assert.equal(String(amount), units);
    assert.equal(amount, evaluationAmount(units));
    assert.equal(
      evaluationBudgets(amount).reduce((a, b) => a + b, 0n),
      amount,
    );
  }
  for (const value of [
    "0",
    "0.999999",
    "200.000001",
    "1e2",
    "-1",
    "100.0000001",
    "NaN",
    " 100",
    "",
  ])
    assert.throws(() => purchaseUnits(value));
  for (const value of [null, 100000000, "01000000", "200000001", "-1"])
    assert.throws(() => evaluationAmount(value));
  for (const locale of Object.values(purchaseCopy))
    assert.ok(locale.range.includes("1–200"));
});
test("separate rounds and all six owner actions are independently bound to wallet, amount and vault", async () => {
  const wallet = String(Keypair.generate().publicKey),
    mints = await evaluationAssetMints();
  const idl = JSON.parse(
    readFileSync(
      new URL(
        "../../../services/c3-mainnet/resources/c3_devnet_evaluation_vault.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const now = Date.now(),
    time = BigInt(Math.floor(now / 1000));
  const seen = new Set<string>();
  for (const round of [1n, 2n, 3n, 10n]) {
    const amount = round === 1n ? 1_000_000n : 100_000_000n;
    const client = new EvaluationClient(idl, {
      wallet,
      version: round,
      depositAmount: amount,
      shareMint: String(await evaluationShareMint(wallet, round)),
      usdcMint: String(mints[0]),
      btcMint: String(mints[1]),
      ethMint: String(mints[2]),
      solMint: String(mints[3]),
    });
    assert.ok(!seen.has(String(client.vault)));
    seen.add(String(client.vault));
    assert.equal(
      String(client.vault),
      String(evaluationPdas(wallet, round).vault),
    );
    assert.deepEqual(
      Buffer.from(evaluationOwnerAccounts(wallet, round).config),
      client.vault.toBuffer(),
    );
    for (const action of [
      "deposit",
      "issue_shares",
      "request_redemption",
      "claim",
      "recover_deposit_plan",
      "renew_plan",
    ] as const) {
      const renewal =
        action === "renew_plan"
          ? { direction: 1 as const, revision: 5n }
          : undefined;
      const build = client.compileOwner(
        action,
        time,
        String(Keypair.generate().publicKey),
        99,
        renewal,
      );
      const response = {
        action,
        chainTime: String(time),
        expiresAt: new Date(now + 45000).toISOString(),
        packet: build.packet.toString("base64"),
        messageHash: build.messageHash.toString("hex"),
        requestId: "11111111-1111-4111-8111-111111111111",
        cluster: "solana:devnet",
        simulatedAssets: true,
        vault: String(client.vault),
        round: String(round),
        ...(renewal
          ? {
              renewal: {
                direction: 1,
                revision: "5",
                expiry: String(time + 110n),
              },
            }
          : {}),
      };
      assert.ok(
        reviewEvaluationOwnerPacket(response, wallet, action, now, {
          amount,
          round,
        }),
      );
      assert.throws(() =>
        reviewEvaluationOwnerPacket(response, wallet, action, now, {
          amount,
          round: round === 1n ? 2n : 1n,
        }),
      );
      if (
        action === "deposit" ||
        action === "request_redemption" ||
        action === "recover_deposit_plan"
      )
        assert.throws(() =>
          reviewEvaluationOwnerPacket(response, wallet, action, now, {
            amount: amount + 1n,
            round,
          }),
        );
    }
  }
  for (const round of [0n, 11n])
    assert.throws(() => evaluationOwnerAccounts(wallet, round));
});
