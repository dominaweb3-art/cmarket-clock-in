/** Borsh-encoded hostile account fixtures only. Not a validator, transaction,
 * Devnet acceptance, acquired asset or substitute for the physical lifecycle. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { BN, type Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  EvaluationClient,
  EVAL_SHARES,
  EVAL_TOKEN,
  evaluationAta,
} from "../src/evaluation-client.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
import { verifiedEvaluationLegContext } from "../src/evaluation-leg-context.ts";
import type { OpenAccount } from "../src/open-state-semantics.ts";
const idl = JSON.parse(
  readFileSync(
    new URL("../resources/c3_devnet_evaluation_vault.json", import.meta.url),
    "utf8",
  ),
) as Idl;
const pk = () => Keypair.generate().publicKey;
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
type RecordData = Record<string, unknown>;
export async function evaluationContextFixture(
  direction: 1 | 2,
  leg = 0,
  chainTime = 1800000005n,
) {
  const c = new EvaluationClient(idl, {
    wallet: pk().toBase58(),
    version: 1n,
    shareMint: pk().toBase58(),
    usdcMint: pk().toBase58(),
    btcMint: pk().toBase58(),
    ethMint: pk().toBase58(),
    solMint: pk().toBase58(),
  });
  const accounts = new Map<string, OpenAccount>();
  const raw = (
    data: Buffer,
    owner: string = EVALUATION.program,
  ): OpenAccount => ({
    owner,
    executable: false,
    data: [data.toString("base64"), "base64"],
  });
  const defaultType = (t: unknown): unknown => {
    if (t === "pubkey") return PublicKey.default;
    if (t === "bool") return false;
    if (t === "u64" || t === "i64") return new BN(0);
    if (typeof t === "object" && t && "array" in t) {
      const a = (t as { array: [unknown, number] }).array;
      return Array.from({ length: a[1] }, () => defaultType(a[0]));
    }
    return 0;
  };
  const encode = async (
    address: PublicKey,
    name: string,
    overrides: RecordData,
  ) => {
    const definition = idl.types!.find((t) => t.name === name)!.type as {
      fields: { name: string; type: unknown }[];
    };
    const data = Object.fromEntries(
      definition.fields.map((f) => [f.name, defaultType(f.type)]),
    );
    Object.assign(data, overrides);
    accounts.set(
      address.toBase58(),
      raw(await c.coder.accounts.encode(name, data)),
    );
    return data;
  };
  const names = c.accounts(
    c.intent(direction === 1 ? "deposit" : "redemption"),
  );
  const assets = [c.config.btcMint, c.config.ethMint, c.config.solMint].map(
    (k) => new PublicKey(k),
  );
  const vAssets = [names.vault_btc!, names.vault_eth!, names.vault_wsol!];
  const budgets =
    direction === 1 ? [400000n, 300000n, 300000n] : [40000n, 30000n, 30000n];
  const outputs =
    direction === 1 ? [40000n, 30000n, 30000n] : [396000n, 297000n, 297000n];
  const common = {
    schema_version: 1,
    config_version: new BN(1),
    vault: c.vault,
    wallet: c.owner,
  };
  const deposit = await encode(c.intent("deposit"), "DepositIntent", {
    ...common,
    amount: new BN(1000000),
    deposited: new BN(1000000),
    status: direction === 1 ? 2 : 5,
    shares_issued: new BN(direction === 1 ? 0 : 1000000),
    btc_after: new BN(40000),
    eth_after: new BN(30000),
    wsol_after: new BN(30000),
  });
  if (direction === 2)
    await encode(c.intent("redemption"), "RedemptionIntent", {
      ...common,
      share_amount: new BN(1000000),
      status: 2,
    });
  const bump = PublicKey.findProgramAddressSync(
    [
      createHash("sha256")
        .update("c3-authority-v1")
        .update(c.owner.toBuffer())
        .digest(),
    ],
    c.program,
  )[1];
  await encode(c.vault, "VaultConfig", {
    ...common,
    governance: new PublicKey(EVALUATION.governance),
    emergency: new PublicKey(EVALUATION.governance),
    keeper: new PublicKey(EVALUATION.keeper),
    allowlisted_owner: c.owner,
    usdc_mint: new PublicKey(c.config.usdcMint),
    btc_mint: assets[0],
    eth_mint: assets[1],
    wsol_mint: assets[2],
    share_mint: new PublicKey(c.config.shareMint),
    vault_usdc: names.vault_usdc,
    vault_btc: names.vault_btc,
    vault_eth: names.vault_eth,
    vault_wsol: names.vault_wsol,
    btc_bps: 4000,
    eth_bps: 3000,
    sol_bps: 3000,
    max_tvl: new BN(1000000),
    max_deposit: new BN(1000000),
    deposit_counter: new BN(1),
    total_shares_issued: new BN(direction === 1 ? 0 : 1000000),
    lifecycle: direction === 1 ? 1 : 3,
    authority_bump: bump,
  });
  const mint = (
    authority?: PublicKey,
    supply = 1_000_000_000n,
    share = false,
  ) => {
    const b = Buffer.alloc(share ? 170 : 82);
    if (authority) {
      b.writeUInt32LE(1);
      authority.toBuffer().copy(b, 4);
    }
    b.writeBigUInt64LE(supply, 36);
    b[44] = 6;
    b[45] = 1;
    if (share) {
      b[165] = 1;
      b.writeUInt16LE(9, 166);
    }
    return raw(b, share ? EVAL_SHARES.toBase58() : EVAL_TOKEN.toBase58());
  };
  const shares = direction === 1 ? 0n : EVALUATION.amount;
  accounts.set(c.config.shareMint, mint(c.authority, shares, true));
  for (const m of [c.config.usdcMint, ...assets.map((k) => k.toBase58())])
    accounts.set(m, mint());
  const token = (
    address: PublicKey,
    mint: PublicKey,
    owner: PublicKey,
    amount: bigint,
    share = false,
  ) => {
    const b = Buffer.alloc(share ? 174 : 165);
    mint.toBuffer().copy(b);
    owner.toBuffer().copy(b, 32);
    b.writeBigUInt64LE(amount, 64);
    b[108] = 1;
    if (share) {
      b[165] = 2;
      b.writeUInt16LE(7, 166);
      b.writeUInt16LE(13, 170);
    }
    accounts.set(
      address.toBase58(),
      raw(b, share ? EVAL_SHARES.toBase58() : EVAL_TOKEN.toBase58()),
    );
  };
  token(
    names.owner_shares!,
    new PublicKey(c.config.shareMint),
    c.owner,
    shares,
    true,
  );
  token(
    names.vault_usdc!,
    new PublicKey(c.config.usdcMint),
    c.authority,
    direction === 1
      ? budgets.slice(leg).reduce((a, b) => a + b, 0n)
      : outputs.slice(0, leg).reduce((a, b) => a + b, 0n),
  );
  vAssets.forEach((address, i) =>
    token(
      address,
      assets[i]!,
      c.authority,
      direction === 1
        ? i < leg
          ? outputs[i]!
          : 0n
        : i < leg
          ? 0n
          : budgets[i]!,
    ),
  );
  const pool = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity")],
    new PublicKey(EVALUATION.router),
  )[0];
  for (const m of [new PublicKey(c.config.usdcMint), ...assets])
    token(evaluationAta(m, pool), m, pool, 10_000_000n);
  for (const k of [EVALUATION.router, EVAL_TOKEN.toBase58()])
    accounts.set(k, {
      owner: "BPFLoaderUpgradeab1e11111111111111111111111",
      executable: true,
      data: ["", "base64"],
    });
  const registryHash = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("c3-route-registry-v1"),
        c.vault.toBuffer(),
        u64(1n),
        u64(1n),
        u64(10000n),
        Buffer.from([2]),
        new PublicKey(EVALUATION.router).toBuffer(),
        EVAL_TOKEN.toBuffer(),
      ]),
    )
    .digest();
  const registryAddress = c.pda("c3-route-reg-v1", c.vault);
  const registry = await encode(registryAddress, "RouteProgramRegistry", {
    ...common,
    governance: new PublicKey(EVALUATION.governance),
    revision: new BN(1),
    enabled: true,
    activation_slot: new BN(1),
    expiry_slot: new BN(10000),
    program_count: 2,
    programs: [
      new PublicKey(EVALUATION.router),
      EVAL_TOKEN,
      ...Array.from({ length: 14 }, () => PublicKey.default),
    ],
    config_hash: [...registryHash],
  });
  const policyAddress = c.pda("c3-quote-policy-v1", c.vault);
  const policy = await encode(policyAddress, "QuoteAuthorityPolicy", {
    ...common,
    governance: new PublicKey(EVALUATION.governance),
    revision: new BN(1),
    authority: new PublicKey(EVALUATION.quotes),
    enabled: true,
    max_age_seconds: new BN(30),
    max_slippage_bps: 100,
    genesis_hash: [...new PublicKey(EVALUATION.genesis).toBytes()],
    domain: [...Buffer.from("C3QUOTESEAL-V1!!")],
  });
  const planAddress = c.pda("c3-plan-v1", names.intent!);
  const plan = await encode(planAddress, "SettlementPlan", {
    ...common,
    schema_version: 2,
    intent: names.intent,
    share_mint: new PublicKey(c.config.shareMint),
    direction,
    amount: new BN(1000000),
    weights: [4000, 3000, 3000],
    input_mints:
      direction === 1
        ? assets.map(() => new PublicKey(c.config.usdcMint))
        : assets,
    output_mints:
      direction === 1
        ? assets
        : assets.map(() => new PublicKey(c.config.usdcMint)),
    source_accounts:
      direction === 1 ? assets.map(() => names.vault_usdc) : vAssets,
    destination_accounts:
      direction === 1 ? vAssets : assets.map(() => names.vault_usdc),
    router_program: new PublicKey(EVALUATION.router),
    minimum_outputs: outputs.map((n) => new BN(n.toString())),
    input_budgets: budgets.map((n) => new BN(n.toString())),
    max_slippage_bps: 100,
    quote_created_at: new BN((chainTime - 5n).toString()),
    expires_at: new BN((chainTime + 105n).toString()),
    executed_bitmap: (1 << leg) - 1,
    revision: new BN(leg),
    lifecycle: leg === 0 ? (direction === 1 ? 1 : 4) : direction === 1 ? 2 : 5,
    actual_inputs: budgets.map((n, i) => new BN(i < leg ? n.toString() : "0")),
    actual_outputs: outputs.map((n, i) => new BN(i < leg ? n.toString() : "0")),
  });
  const snapshot = {
    genesis: EVALUATION.genesis,
    slot: 1000n,
    chainTime,
    accounts,
  };
  const verify = () =>
    verifiedEvaluationLegContext(c, snapshot, direction, BigInt(leg));
  return {
    c,
    accounts,
    snapshot,
    verify,
    encode,
    plan,
    planAddress,
    registry,
    registryAddress,
    policy,
    policyAddress,
    deposit,
    names,
  };
}
const fixture = evaluationContextFixture;
test("all six exact Borsh contexts derive leg and custody from checked state, not caller quotes", async () => {
  for (const direction of [1, 2] as const)
    for (let leg = 0; leg < 3; leg++) {
      const f = await fixture(direction, leg),
        ctx = f.verify();
      assert.equal(ctx.direction, direction);
      assert.equal(ctx.leg, leg);
      assert.equal(
        ctx.inputBudget,
        (direction === 1
          ? [400000n, 300000n, 300000n]
          : [40000n, 30000n, 30000n])[leg],
      );
    }
});
test("hostile plan/policy/evidence and donation-inflated sale budgets fail closed", async () => {
  for (const mutation of [
    { wallet: pk() },
    { vault: pk() },
    { input_mints: [pk(), pk(), pk()] },
    { destination_accounts: [pk(), pk(), pk()] },
    { direction: 2 },
    { revision: new BN(1) },
    { input_budgets: [new BN(400001), new BN(300000), new BN(300000)] },
    { minimum_outputs: [new BN(40001), new BN(30000), new BN(30000)] },
    { actual_inputs: [new BN(1), new BN(0), new BN(0)] },
    { executed_bitmap: 2 },
    { active_swap_authorization: Array.from({ length: 32 }, () => 1) },
    { expires_at: new BN(1800000005) },
    { max_slippage_bps: 101 },
  ]) {
    const f = await fixture(1);
    await f.encode(f.planAddress, "SettlementPlan", { ...f.plan, ...mutation });
    assert.throws(f.verify);
  }
  for (const mutation of [
    { authority: pk() },
    { enabled: false },
    { genesis_hash: Array.from({ length: 32 }, () => 1) },
    { max_age_seconds: new BN(31) },
  ]) {
    const f = await fixture(1);
    await f.encode(f.policyAddress, "QuoteAuthorityPolicy", {
      ...f.policy,
      ...mutation,
    });
    assert.throws(f.verify);
  }
  const donation = await fixture(2);
  await donation.encode(donation.planAddress, "SettlementPlan", {
    ...donation.plan,
    input_budgets: [new BN(40001), new BN(30000), new BN(30000)],
  });
  assert.throws(donation.verify, /ACQUIRED_NOT_DONATED/);
  const missing = await fixture(1);
  missing.accounts.delete(missing.c.config.usdcMint);
  assert.throws(missing.verify, /MISSING_ACCOUNT/);
  const owner = await fixture(1);
  const a = owner.accounts.get(owner.names.vault_usdc!.toBase58())!;
  owner.accounts.set(owner.names.vault_usdc!.toBase58(), {
    ...a,
    owner: EVAL_SHARES.toBase58(),
  });
  assert.throws(owner.verify);
  const stale = await fixture(1);
  stale.snapshot.chainTime = 1800000120n;
  assert.throws(stale.verify, /EXPIRED/);
});
