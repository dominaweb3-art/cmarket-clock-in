import assert from "node:assert/strict";
import test from "node:test";
import { EvaluationProvisionService } from "../src/evaluation-provision-service.ts";
import { PublicKey, Keypair } from "@solana/web3.js";
import { evaluationCreateAta } from "../src/evaluation-provisioning.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
const testAuthority = Keypair.generate().publicKey;
const testVault = Keypair.generate().publicKey;
const method = Reflect.get(
  EvaluationProvisionService.prototype,
  "unpauseOperation",
) as (...v: unknown[]) => Promise<string>;
function scenario(overrides: Record<string, unknown> = {}) {
  const previous = {
    last_valid_height: 100,
    signature: "original",
    outcome: null,
    ...overrides,
  };
  const calls: string[] = [];
  const query = async (sql: string) => {
    calls.push(sql);
    if (sql.includes("SELECT operation_id,generation"))
      return {
        rows: overrides.generation
          ? [{ operation_id: "prior", generation: overrides.generation }]
          : [],
      };
    if (sql.includes("SELECT p.last_valid_height")) return { rows: [previous] };
    if (sql.includes("SELECT operation_id FROM"))
      return {
        rows: overrides.conflict
          ? [{ operation_id: "other" }]
          : overrides.generation
            ? [{ operation_id: "prior" }]
            : [],
      };
    return { rows: [] };
  };
  const subject = {
    pool: {
      query,
      connect: async () => ({ query, release: () => calls.push("release") }),
    },
    rpc: {
      getBlockHeight: async () => Number(overrides.height ?? 101),
      getSignatureStatuses: async () => ({ value: [overrides.status ?? null] }),
      getTransaction: async () => overrides.transaction ?? null,
      getAccountInfo: async (address: PublicKey) =>
        address.equals(testVault)
          ? (overrides.vaultAccount ?? null)
          : (overrides.ataAccount ?? null),
    },
    position: async () => ({
      paused: true,
      lifecycle: 0,
      shares: 0n,
      deposited: 0n,
      ...(overrides.position as object),
    }),
  };
  return {
    calls,
    run: (explicit = true, missingAta?: unknown) =>
      method.call(
        subject,
        { vault: testVault, authority: testAuthority },
        "wallet:2",
        "verified-proof",
        explicit,
        missingAta,
      ),
  };
}
test("provision recovery is explicit, bounded, expired, empty-vault only and append-only", async () => {
  for (const input of [{ outcome: "effects_verified" }, { height: 100 }]) {
    const s = scenario(input);
    await s.run();
    assert.ok(!s.calls.some((c) => c.startsWith("INSERT")));
  }
  const silent = scenario();
  await silent.run(false);
  assert.ok(!silent.calls.some((c) => c.startsWith("INSERT")));
  const success = scenario();
  await success.run();
  assert.equal(
    success.calls.filter((c) =>
      c.startsWith("INSERT INTO c3_eval.evaluation_provision_attempts"),
    ).length,
    1,
  );
  assert.ok(!success.calls.some((c) => /UPDATE|DELETE/.test(c)));
  for (const input of [
    { status: { confirmationStatus: "processed" } },
    { transaction: { meta: { err: null } } },
    { position: { paused: false } },
    { position: { deposited: 1n } },
    { position: { shares: 1n } },
    { position: { lifecycle: 1 } },
    { outcome: "failed" },
    { conflict: true },
    { generation: 3 },
  ])
    await assert.rejects(scenario(input).run());
});
test("expired ATA recovery requires explicit owner intent, absent target and absent vault; minting or funded accounts cannot enter it", async () => {
  const mint = new PublicKey("J4cTKzcwdrkpU1qYxbJ1LpiJivpKcZeHmcyuGj1o1Nza");
  const step = () => ({
    name: "vault-ata-" + mint,
    scope: "wallet:2",
    signer: EVALUATION.governance,
    instructions: [
      evaluationCreateAta(
        new PublicKey(EVALUATION.governance),
        mint,
        testAuthority,
      ),
    ],
    verify: async () => undefined,
  });
  const success = scenario();
  await success.run(true, step());
  assert.equal(
    success.calls.filter((c) => c.startsWith("INSERT INTO")).length,
    1,
  );
  const silent = scenario();
  await silent.run(false, step());
  assert.ok(!silent.calls.some((c) => c.startsWith("INSERT")));
  for (const override of [
    { ataAccount: {} },
    { vaultAccount: {} },
    { generation: 3 },
    { status: {} },
    { transaction: {} },
  ])
    await assert.rejects(scenario(override).run(true, step()));
  for (const change of [
    { name: "faucet-usdc" },
    { signer: "unknown" },
    { scope: "other-wallet" },
    { instructions: [] },
  ])
    await assert.rejects(scenario().run(true, { ...step(), ...change }));
  const substituted = step();
  substituted.instructions[0]!.keys[1]!.pubkey = Keypair.generate().publicKey;
  await assert.rejects(scenario().run(true, substituted));
});
