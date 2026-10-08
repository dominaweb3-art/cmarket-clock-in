/** Fixed Devnet custody/policy decoder. All trusted fields originate in a
 * finalized, same-context RPC snapshot; no HTTP quote/body can authorize them. */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  EvaluationClient,
  evaluationAta,
  EVAL_TOKEN,
} from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import {
  evaluationPosition,
  type EvaluationAccounts,
} from "./evaluation-state.ts";
import { accountBytes, verifyOpenToken } from "./open-state-semantics.ts";
import {
  evaluationTestRoute,
  type EvaluationPlanContext,
} from "./evaluation-route.ts";
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_LEG_" + code);
};
const number = (v: unknown) => {
  const s = String(v);
  check(/^(0|[1-9]\d{0,19})$/.test(s), "INTEGER");
  const n = BigInt(s);
  check(n <= (1n << 64n) - 1n, "INTEGER");
  return n;
};
const key = (v: unknown) => {
  check(v instanceof PublicKey, "KEY");
  return (v as PublicKey).toBase58();
};
const array = (v: unknown) => {
  check(Array.isArray(v) && v.length === 3, "ARRAY");
  return v as unknown[];
};
const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
export function evaluationSettlementAddresses(
  client: EvaluationClient,
  direction: 1 | 2,
) {
  check(direction === 1 || direction === 2, "DIRECTION");
  const intent = client.intent(direction === 1 ? "deposit" : "redemption");
  const pool = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity")],
    new PublicKey(EVALUATION.router),
  )[0];
  const mints = [
    client.config.usdcMint,
    client.config.btcMint,
    client.config.ethMint,
    client.config.solMint,
  ];
  return [
    ...new Set([
      client.vault.toBase58(),
      client.config.shareMint,
      ...Object.values(client.accounts(intent)).map((k) => k.toBase58()),
      client.intent("redemption").toBase58(),
      client.pda("c3-plan-v1", intent).toBase58(),
      client.pda("c3-route-reg-v1", client.vault).toBase58(),
      client.pda("c3-quote-policy-v1", client.vault).toBase58(),
      EVALUATION.router,
      ...mints,
      ...mints.map((m) => evaluationAta(new PublicKey(m), pool).toBase58()),
    ]),
  ];
}
export function verifiedEvaluationLegContext(
  client: EvaluationClient,
  snapshot: Readonly<{
    genesis: string;
    slot: bigint;
    chainTime: bigint;
    accounts: EvaluationAccounts;
  }>,
  direction: 1 | 2,
  expectedRevision: bigint,
) {
  check(
    snapshot.genesis === EVALUATION.genesis &&
      snapshot.slot > 0n &&
      snapshot.chainTime > 0n,
    "NETWORK_CLOCK",
  );
  const required = (address: string) => {
    const a = snapshot.accounts.get(address);
    check(a, "MISSING_ACCOUNT");
    return a!;
  };
  const decode = (address: string, name: string) =>
    client.coder.accounts.decode(
      name,
      accountBytes(
        required(address),
        EVALUATION.program,
        client.coder.accounts.size(name),
        name,
      ),
    ) as Record<string, unknown>;
  const position = evaluationPosition(client, snapshot.accounts);
  check(
    !position.paused &&
      position.lifecycle === (direction === 1 ? 1 : 3) &&
      position.shares === (direction === 1 ? 0n : EVALUATION.amount),
    "LIFECYCLE",
  );
  const intent = client.intent(direction === 1 ? "deposit" : "redemption");
  const plan = client.pda("c3-plan-v1", intent);
  const p = decode(plan.toBase58(), "SettlementPlan");
  check(
    p.schema_version === 2 &&
      number(p.config_version) === 1n &&
      key(p.vault) === client.vault.toBase58() &&
      key(p.wallet) === client.owner.toBase58() &&
      key(p.share_mint) === client.config.shareMint &&
      key(p.intent) === intent.toBase58() &&
      p.direction === direction &&
      number(p.amount) === EVALUATION.amount &&
      number(p.revision) === expectedRevision &&
      key(p.router_program) === EVALUATION.router,
    "PLAN_BINDING",
  );
  check(
    array(p.weights).every((w, i) => w === EVALUATION.weights[i]),
    "WEIGHTS",
  );
  const bitmap = Number(p.executed_bitmap);
  check([0, 1, 3].includes(bitmap), "ORDERED_PROGRESS");
  const leg = bitmap === 0 ? 0 : bitmap === 1 ? 1 : 2;
  check(
    p.lifecycle ===
      (bitmap === 0 ? (direction === 1 ? 1 : 4) : direction === 1 ? 2 : 5),
    "PLAN_STATE",
  );
  check(
    Array.isArray(p.active_swap_authorization) &&
      p.active_swap_authorization.length === 32 &&
      p.active_swap_authorization.every((n) => n === 0) &&
      String(p.active_swap_expires_at) === "0",
    "PENDING_AUTHORIZATION_RECONCILE_FIRST",
  );
  const intentState = decode(
    intent.toBase58(),
    direction === 1 ? "DepositIntent" : "RedemptionIntent",
  );
  check(
    intentState.status === 2 &&
      key(intentState.wallet) === client.config.wallet &&
      key(intentState.vault) === client.vault.toBase58(),
    "INTENT_BINDING",
  );
  const names = client.accounts(intent);
  const assets = [
    client.config.btcMint,
    client.config.ethMint,
    client.config.solMint,
  ];
  const vaultAssets = [names.vault_btc!, names.vault_eth!, names.vault_wsol!];
  const inputMints =
    direction === 1 ? assets.map(() => client.config.usdcMint) : assets;
  const outputMints =
    direction === 1 ? assets : assets.map(() => client.config.usdcMint);
  const sources =
    direction === 1
      ? vaultAssets.map(() => names.vault_usdc!.toBase58())
      : vaultAssets.map((k) => k.toBase58());
  const destinations =
    direction === 1
      ? vaultAssets.map((k) => k.toBase58())
      : vaultAssets.map(() => names.vault_usdc!.toBase58());
  for (const [field, expected] of [
    ["input_mints", inputMints],
    ["output_mints", outputMints],
    ["source_accounts", sources],
    ["destination_accounts", destinations],
  ] as const)
    check(
      array(p[field]).every((v, i) => key(v) === expected[i]),
      "PLAN_ACCOUNTS",
    );
  const budgets = array(p.input_budgets).map(number);
  const mins = array(p.minimum_outputs).map(number);
  const ins = array(p.actual_inputs).map(number),
    outs = array(p.actual_outputs).map(number);
  check(budgets.every((n) => n > 0n) && mins.every((n) => n > 0n), "BUDGETS");
  if (direction === 1)
    check(
      budgets.every(
        (n, i) =>
          n === (EVALUATION.amount * BigInt(EVALUATION.weights[i]!)) / 10000n,
      ),
      "EXACT_ALLOCATION",
    );
  else {
    const d = decode(client.intent("deposit").toBase58(), "DepositIntent");
    check(
      d.status === 5 &&
        number(d.shares_issued) === EVALUATION.amount &&
        key(d.wallet) === client.config.wallet &&
        key(d.vault) === client.vault.toBase58(),
      "ACQUISITION_EVIDENCE",
    );
    check(
      ["btc", "eth", "wsol"].every((asset, i) => {
        const before = number(d[asset + "_before"]),
          after = number(d[asset + "_after"]);
        return after > before && budgets[i] === after - before;
      }),
      "ACQUIRED_NOT_DONATED_BUDGETS",
    );
  }
  check(
    ins.every((n, i) =>
      i < leg
        ? n === budgets[i] && outs[i]! >= mins[i]!
        : n === 0n && outs[i] === 0n,
    ),
    "PROGRESS_EFFECTS",
  );
  check(
    number(p.max_slippage_bps) === 100n &&
      snapshot.chainTime < number(p.expires_at),
    "EXPIRED_OR_SLIPPAGE",
  );
  const registryAddress = client.pda("c3-route-reg-v1", client.vault),
    policyAddress = client.pda("c3-quote-policy-v1", client.vault);
  const registry = decode(registryAddress.toBase58(), "RouteProgramRegistry"),
    policy = decode(policyAddress.toBase58(), "QuoteAuthorityPolicy");
  for (const item of [registry, policy])
    check(
      item.schema_version === 1 &&
        item.enabled === true &&
        number(item.config_version) === 1n &&
        key(item.vault) === client.vault.toBase58() &&
        key(item.governance) === EVALUATION.governance &&
        number(item.revision) > 0n,
      "POLICY_SCOPE",
    );
  check(
    registry.program_count === 2 &&
      Array.isArray(registry.programs) &&
      registry.programs.length === 16,
    "REGISTRY_PROGRAMS",
  );
  const programs = (registry.programs as unknown[]).slice(0, 2).map(key);
  check(
    programs[0] === EVALUATION.router &&
      programs[1] === EVAL_TOKEN.toBase58() &&
      (registry.programs as unknown[])
        .slice(2)
        .every((k) => key(k) === PublicKey.default.toBase58()),
    "REGISTRY_PROGRAMS",
  );
  const activation = number(registry.activation_slot),
    expiresSlot = number(registry.expiry_slot);
  check(
    activation <= snapshot.slot && snapshot.slot < expiresSlot,
    "REGISTRY_EXPIRED",
  );
  const registryHash = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("c3-route-registry-v1"),
        client.vault.toBuffer(),
        u64(1n),
        u64(activation),
        u64(expiresSlot),
        Buffer.from([2]),
        ...programs.map((k) => new PublicKey(k).toBuffer()),
      ]),
    )
    .digest();
  check(
    Buffer.from(registry.config_hash as number[]).equals(registryHash),
    "REGISTRY_HASH",
  );
  check(
    key(policy.authority) === EVALUATION.quotes &&
      String(policy.max_age_seconds) === "30" &&
      policy.max_slippage_bps === 100 &&
      Buffer.from(policy.genesis_hash as number[]).equals(
        new PublicKey(EVALUATION.genesis).toBuffer(),
      ) &&
      Buffer.from(policy.domain as number[]).equals(
        Buffer.from("C3QUOTESEAL-V1!!"),
      ),
    "QUOTE_POLICY",
  );
  for (const program of programs)
    check(required(program).executable === true, "PROGRAM_NOT_EXECUTABLE");
  const ctx: EvaluationPlanContext = {
    plan: plan.toBase58(),
    intent: intent.toBase58(),
    direction,
    leg,
    revision: expectedRevision,
    registryRevision: number(registry.revision),
    registryHash,
    policyRevision: number(policy.revision),
    inputBudget: budgets[leg]!,
    minimumOutput: mins[leg]!,
    created: snapshot.chainTime,
    expires: number(p.expires_at),
    slot: snapshot.slot,
    registryExpiresSlot: expiresSlot,
  };
  const route = evaluationTestRoute(client, ctx, Buffer.alloc(32, 1)); // identities are not used/persisted from this validation probe
  for (const mint of [client.config.usdcMint, ...assets]) {
    const raw = accountBytes(required(mint), EVAL_TOKEN.toBase58(), 82);
    check(
      raw[44] === 6 &&
        raw[45] === 1 &&
        raw.readUInt32LE(46) === 0 &&
        raw.subarray(50, 82).every((n) => n === 0),
      "TEST_MINT",
    );
  }
  check(
    verifyOpenToken(
      required(route.source.toBase58()),
      client.authority.toBase58(),
      inputMints[leg]!,
      EVAL_TOKEN.toBase58(),
    ) >= route.input,
    "SOURCE_INVENTORY",
  );
  verifyOpenToken(
    required(route.destination.toBase58()),
    client.authority.toBase58(),
    outputMints[leg]!,
    EVAL_TOKEN.toBase58(),
  );
  const pool = route.keys[5]!.pubkey;
  verifyOpenToken(
    required(route.keys[3]!.pubkey.toBase58()),
    pool.toBase58(),
    inputMints[leg]!,
    EVAL_TOKEN.toBase58(),
  );
  check(
    verifyOpenToken(
      required(route.keys[4]!.pubkey.toBase58()),
      pool.toBase58(),
      outputMints[leg]!,
      EVAL_TOKEN.toBase58(),
    ) >= route.output,
    "TEST_LIQUIDITY",
  );
  return Object.freeze(ctx);
}
