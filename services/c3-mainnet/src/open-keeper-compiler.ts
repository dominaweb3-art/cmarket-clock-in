/** Server-only keeper packet compiler. Exact stored intent and finalized public
 * custody state; no client policy, keys, signatures or submission. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { C3_MAINNET as c } from "./constants.ts";
import { canonicalize } from "./manifest.ts";
import { approvedOwnerCompilerPolicy } from "./open-owner-trust.ts";
import type { OpenProductionPolicy } from "./open-production-policy.ts";
import {
  verifyLegGovernance,
  type SettlementServerPolicy,
} from "./open-leg-factory.ts";
import type { StoredQuoteContext } from "./open-quote-context.ts";
import { deriveQuoteMinimum } from "./quote-seal.ts";
import { JupiterLegCompiler } from "./open-jupiter-compiler.ts";
import type { OwnerReadonlyRpc } from "./open-owner-service.ts";
import {
  accountBytes,
  openAddresses,
  verifyOpenConfig,
  verifyOpenIntent,
  verifyOpenShareMint,
  verifyOpenToken,
  verifyOpenPlan,
  type OpenAccount,
} from "./open-state-semantics.ts";
import { inspectUnsignedEnvelope } from "./open-v0-envelope.ts";
import { publicKeyBytes } from "./solana.ts";
const hash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest();
const demand = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_KEEPER_COMPILER_" + code);
};
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
export type KeeperAction =
  "create_buy_plan" | "create_sell_plan" | "record_buy" | "record_sell";
export async function compileKeeperFromDurableState(
  pool: Pool,
  policy: SettlementServerPolicy,
  intentId: string,
  action: KeeperAction,
  rpc: OwnerReadonlyRpc,
  compiler: JupiterLegCompiler,
  planSeconds = 120,
) {
  demand(
    Number.isInteger(planSeconds) && planSeconds > 0 && planSeconds <= 120,
    "PLAN_SECONDS",
  );
  const row = (
    await pool.query(
      "SELECT *,clock_timestamp() AS db_now FROM c3_open.intents WHERE intent_id=$1",
      [intentId],
    )
  ).rows[0];
  const selling = action.includes("sell"),
    create = action.startsWith("create"),
    scope = approvedOwnerCompilerPolicy({
      ...policy,
      version: "c3-open-production/v1",
    } as OpenProductionPolicy),
    a = openAddresses(scope),
    plan = selling ? a.redemptionPlan : a.depositPlan,
    intent = selling ? a.redemption : a.deposit;
  demand(
    row &&
      row.wallet === policy.wallet &&
      row.vault === policy.vault &&
      row.share_mint === policy.shareMint &&
      row.configuration_hash === policy.configurationHash &&
      row.state ===
        (create
          ? selling
            ? "redemption_requested"
            : "funded"
          : selling
            ? "selling"
            : "buying"),
    "DURABLE_SCOPE_OR_STATE",
  );
  const names = [
    policy.vault,
    policy.shareMint,
    policy.registry,
    policy.quotePolicy,
    intent,
    plan,
    ...a.vaultTokens,
    CLOCK,
  ];
  const snap = (await rpc.read("getMultipleAccounts", [
    names,
    { commitment: "finalized", encoding: "base64" },
  ])) as { context: { slot: number }; value: (OpenAccount | null)[] };
  demand(
    snap.value?.length === names.length &&
      Number.isSafeInteger(snap.context?.slot) &&
      snap.context.slot > 0,
    "SNAPSHOT",
  );
  const accounts = Object.fromEntries(
      names.map((n, i) => [n, snap.value[i]!]),
    ) as Record<string, OpenAccount | null>,
    cfg = verifyOpenConfig(scope, accounts[policy.vault]!);
  demand(!cfg.paused, "PAUSED");
  verifyOpenShareMint(scope, accounts[policy.shareMint]!);
  const genesis = String(await rpc.read("getGenesisHash", [])),
    governance = verifyLegGovernance(policy, {
      slot: snap.context.slot,
      genesis,
      accounts,
    });
  const clock = accountBytes(
      accounts[CLOCK],
      "Sysvar1111111111111111111111111111111111111",
      40,
    ),
    chainNow = clock.readBigInt64LE(32);
  const intentBytes = verifyOpenIntent(
    scope,
    accounts[intent]!,
    selling,
    create ? (selling ? [2] : [2]) : selling ? [2] : [2],
  );
  const balances = a.vaultTokens.map((addr, i) =>
    verifyOpenToken(
      accounts[addr]!,
      a.authority,
      [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i]!,
    ),
  );
  let data: Buffer,
    settlementId: Buffer,
    created = chainNow,
    expiry = chainNow + BigInt(planSeconds);
  const routes: Buffer[] = [],
    minima: bigint[] = [];
  const materialEvidence: Record<string, unknown>[] = [];
  if (create) {
    demand(!accounts[plan] && row.chain_revision === "0", "PLAN_EXISTS");
    const budgets = selling
      ? [0, 1, 2].map((i) => intentBytes.readBigUInt64LE(122 + i * 8))
      : [400000n, 300000n, 300000n];
    demand(
      budgets.every(
        (v, i) =>
          v > 0n &&
          (selling ? balances[i + 1]! >= v : balances[0]! >= 1000000n),
      ),
      "ACCOUNTED_BUDGET",
    );
    for (let leg = 0; leg < 3; leg++) {
      const asset = [c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][leg]!;
      const ctx: StoredQuoteContext = {
        keeper: policy.keeper,
        governance: policy.governance,
        policy: policy.quotePolicy,
        reviewedPrograms: governance.programs,
        genesisHash: Buffer.from(publicKeyBytes(genesis)).toString("hex"),
        vault: policy.vault,
        configVersion: "1",
        registry: policy.registry,
        registryRevision: policy.registryRevision,
        registryHash: policy.registryHash,
        plan,
        planRevision: "0",
        intent,
        wallet: policy.wallet,
        leg,
        direction: selling ? 2 : 1,
        inputMint: selling ? asset : c.usdcMint,
        outputMint: selling ? c.usdcMint : asset,
        source: selling ? a.vaultTokens[leg + 1]! : a.vaultTokens[0]!,
        destination: selling ? a.vaultTokens[0]! : a.vaultTokens[leg + 1]!,
        routerProgram: c.jupiterProgram,
        policyRevision: policy.quotePolicyRevision,
        inputAmount: budgets[leg]!.toString(),
        authority: Buffer.from(publicKeyBytes(policy.quoteAuthority)).toString(
          "hex",
        ),
        maxSlippageBps: policy.maxSlippageBps,
        maxQuoteAgeSeconds: governance.maxAgeSeconds,
        planExpiresAt: expiry.toString(),
        configurationHash: policy.configurationHash,
      };
      const m = await compiler.validateAndBuild(ctx),
        minimum = deriveQuoteMinimum(
          m.quotedOutput,
          m.slippageBps,
          m.jupiterThreshold,
        );
      routes.push(Buffer.from(m.routeHash));
      minima.push(minimum);
      materialEvidence.push({
        input: ctx.inputAmount,
        quoted: m.quotedOutput.toString(),
        threshold: m.jupiterThreshold.toString(),
        minimum: minimum.toString(),
        slippage: m.slippageBps,
        created: m.builderTimestamp.toString(),
        expires: m.expiresAt.toString(),
        slot: m.builderSlot.toString(),
        route: Buffer.from(m.routeHash).toString("hex"),
        instruction: Buffer.from(m.instructionHash).toString("hex"),
        metas: Buffer.from(m.accountMetasHash).toString("hex"),
        alts: Buffer.from(m.altContentsHash).toString("hex"),
        bytes: m.unsignedPacketBytes,
      });
      if (leg === 0 || m.builderTimestamp < created)
        created = m.builderTimestamp;
    }
    // A finalized Clock can lag the fresh Jupiter timestamp. Wait boundedly
    // for that SAME immutable quote window; never rewrite creation/expiry or
    // widen policy to make an ahead-of-chain quote pass.
    const deadline = performance.now() + 30000;
    let now: bigint;
    for (;;) {
      const fresh = (await rpc.read("getAccountInfo", [
        CLOCK,
        { commitment: "finalized", encoding: "base64" },
      ])) as { value: OpenAccount };
      now = accountBytes(
        fresh.value,
        "Sysvar1111111111111111111111111111111111111",
        40,
      ).readBigInt64LE(32);
      if (now >= created) break;
      demand(
        performance.now() < deadline &&
          materialEvidence.every(
            (e) => BigInt(String(e.expires)) * 1000n > BigInt(Date.now()),
          ),
        `QUOTE_CLOCK_UNUSABLE:chain=${now}:created=${created}:host=${Math.floor(Date.now() / 1000)}:expires=${materialEvidence.map((e) => String(e.expires)).join(",")}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    demand(
      now >= created &&
        now - created <= 30n &&
        expiry > now &&
        materialEvidence.every((e) => BigInt(String(e.expires)) > now),
      "QUOTES_STALE",
    );
    settlementId = hash(
      canonicalize({
        domain: "c3-server-settlement/v1",
        intentId,
        action,
        revision: row.db_revision,
        plan,
        budgets: budgets.map(String),
        routes: routes.map((v) => v.toString("hex")),
        minima: minima.map(String),
      }),
    );
    const args = Buffer.alloc(3 * 32 + 3 * 8 + 8 + 8 + 2 + 32);
    routes.forEach((v, i) => v.copy(args, i * 32));
    minima.forEach((v, i) => args.writeBigUInt64LE(v, 96 + i * 8));
    args.writeBigInt64LE(created, 120);
    args.writeBigInt64LE(expiry, 128);
    args.writeUInt16LE(policy.maxSlippageBps, 136);
    settlementId.copy(args, 138);
    data = Buffer.concat([
      hash(
        "global:" +
          (selling
            ? "create_redemption_settlement_plan"
            : "create_deposit_settlement_plan"),
      ).subarray(0, 8),
      args,
    ]);
  } else {
    const p = verifyOpenPlan(scope, plan, accounts[plan]!, row.chain_revision);
    demand(p.bitmap === 7 && p.outputs.every((v) => v > 0n), "PLAN_INCOMPLETE");
    const start = selling ? 3 : 0,
      legs = (
        await pool.query(
          "SELECT ordinal,observed_effects,state FROM c3_open.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 ORDER BY ordinal",
          [intentId, start, start + 2],
        )
      ).rows;
    demand(
      legs.length === 3 &&
        legs.every(
          (l, i) =>
            l.state === "confirmed" &&
            BigInt(l.observed_effects.outputAmount) === p.outputs[i] &&
            BigInt(l.observed_effects.inputAmount) === p.budgets[i],
        ),
      "EFFECTS_UNRECONCILED",
    );
    settlementId = Buffer.from(p.bytes.subarray(724, 756));
    created = p.bytes.readBigInt64LE(698);
    expiry = p.expiresAt;
    demand(
      selling
        ? balances[0]! >= p.outputs.reduce((v, n) => v + n, 0n)
        : p.outputs.every((n, i) => balances[i + 1]! >= n),
      "RESERVES",
    );
    data = Buffer.concat([
      hash(
        "global:" +
          (selling
            ? "record_redemption_settlement"
            : "record_deposit_settlement"),
      ).subarray(0, 8),
      settlementId,
    ]);
  }
  const fixed = create
    ? ([
        [policy.keeper, true, true],
        [policy.vault, false, false],
        [intent, false, true],
        [plan, false, true],
        [c.systemProgram, false, false],
      ] as const)
    : ([
        [policy.keeper, true, false],
        [policy.vault, false, false],
        [intent, false, true],
        [plan, false, false],
        ...a.vaultTokens.map((v) => [v, false, false] as const),
        // Agave collects token metadata only when a token program appears in
        // the message. Read-only remaining account, not an instruction/CPI.
        [c.tokenProgram, false, false],
      ] as const);
  const ix = new TransactionInstruction({
    programId: new PublicKey(policy.programId),
    keys: fixed.map(([k, s, w]) => ({
      pubkey: new PublicKey(k),
      isSigner: s,
      isWritable: w,
    })),
    data,
  });
  const block = (await rpc.read("getLatestBlockhash", [
    { commitment: "finalized" },
  ])) as { value: { blockhash: string; lastValidBlockHeight: number } };
  const message = new TransactionMessage({
      payerKey: new PublicKey(policy.keeper),
      recentBlockhash: block.value.blockhash,
      instructions: [ix],
    }).compileToV0Message(),
    inspection = inspectUnsignedEnvelope(message);
  demand(
    inspection.fits &&
      inspection.serialized &&
      message.header.numRequiredSignatures === 1,
    "V0_SIZE_OR_SIGNERS",
  );
  const packet = new VersionedTransaction(message).serialize(),
    manifest = {
      version: "c3-keeper-packet/v1",
      intentId,
      action,
      wallet: policy.wallet,
      vault: policy.vault,
      plan,
      onchainIntent: intent,
      dbRevision: row.db_revision,
      chainRevision: row.chain_revision,
      policyHash: hash(canonicalize(policy)).toString("hex"),
      messageHash: inspection.messageHash!,
      settlementId: settlementId.toString("hex"),
      routes: routes.map((v) => v.toString("hex")),
      minima: minima.map(String),
      created: created.toString(),
      expiry: expiry.toString(),
      slot: snap.context.slot,
      blockhash: block.value.blockhash,
      lastValidBlockHeight: block.value.lastValidBlockHeight,
      materialEvidence,
      preAccounts: accounts,
    };
  return { packet, manifest };
}
