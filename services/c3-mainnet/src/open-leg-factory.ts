/** Server-derived, append-only leg contexts. Approval is source-controlled in
 * the production wrapper; isolated consumers cannot enroll Mainnet evidence. */
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PublicKey } from "@solana/web3.js";
import { C3_MAINNET as c } from "./constants.ts";
import { canonicalize } from "./manifest.ts";
import { publicKeyBytes, encodeBase58 } from "./solana.ts";
import {
  openQuoteContext,
  type StoredQuoteContext,
} from "./open-quote-context.ts";
import { quoteContextHash } from "./quote-seal.ts";
import {
  approvedOwnerCompilerPolicy,
  assertProductionEnrollment,
} from "./open-owner-trust.ts";
import {
  requireOpenProductionPolicy,
  type OpenProductionPolicy,
} from "./open-production-policy.ts";
import {
  productionOwnerRpc,
  type OwnerReadonlyRpc,
} from "./open-owner-service.ts";
import {
  accountBytes,
  openAddresses,
  verifyOpenConfig,
  verifyOpenShareMint,
  verifyOpenIntent,
  verifyOpenPlan,
  verifyOpenToken,
  type OpenAccount,
} from "./open-state-semantics.ts";
import { VAULT_PROGRAM } from "./open-v0-envelope.ts";
import { verifyProductionVaultArtifact } from "./open-vault-artifact.ts";
const hash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest();
const demand = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_LEG_FACTORY_" + code);
};
const key = (b: Buffer, n: number) => encodeBase58(b.subarray(n, n + 32));
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
export const OPEN_ROUTE_PROGRAMS = Object.freeze([
  c.jupiterProgram,
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  c.tokenProgram,
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]);
export type SettlementServerPolicy = Readonly<
  Pick<
    OpenProductionPolicy,
    | "programId"
    | "idlHash"
    | "configurationHash"
    | "vault"
    | "shareMint"
    | "wallet"
    | "governance"
    | "keeper"
    | "quoteAuthority"
    | "registry"
    | "registryRevision"
    | "registryHash"
    | "quotePolicy"
    | "quotePolicyRevision"
    | "maxSlippageBps"
  >
>;
type DurableLeg = {
  wallet: string;
  vault: string;
  share_mint: string;
  configuration_hash: string;
  db_revision: string;
  chain_revision: string;
  state: string;
  expires_at: Date;
  leg_state: string;
  submitted_signature: string | null;
  generation: string;
  generation_expiry: Date | null;
  db_now: Date;
};
export function verifyLegGovernance(
  policy: SettlementServerPolicy,
  snapshot: Readonly<{
    slot: number;
    genesis: string;
    accounts: Readonly<Record<string, OpenAccount | null>>;
  }>,
) {
  demand(policy.programId === VAULT_PROGRAM.toBase58(), "PROGRAM_SOURCE_PIN");
  const accounts = snapshot.accounts;
  const r = accountBytes(
      accounts[policy.registry],
      policy.programId,
      652,
      "RouteProgramRegistry",
    ),
    q = accountBytes(
      accounts[policy.quotePolicy],
      policy.programId,
      181,
      "QuoteAuthorityPolicy",
    );
  const registry = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-route-reg-v1"), new PublicKey(policy.vault).toBuffer()],
    new PublicKey(policy.programId),
  )[0].toBase58();
  const quotePolicy = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-quote-policy-v1"), new PublicKey(policy.vault).toBuffer()],
    new PublicKey(policy.programId),
  )[0].toBase58();
  demand(
    registry === policy.registry && quotePolicy === policy.quotePolicy,
    "POLICY_PDA",
  );
  const count = r[138]!,
    programs = Array.from({ length: count }, (_, i) => key(r, 139 + i * 32));
  demand(
    r[8] === 1 &&
      key(r, 9) === policy.vault &&
      key(r, 41) === policy.governance &&
      r.readBigUInt64LE(73) === 1n &&
      r.readBigUInt64LE(81).toString() === policy.registryRevision &&
      r[121] === 1 &&
      count > 0 &&
      count <= 16 &&
      new Set(programs).size === count &&
      programs.every((v) => OPEN_ROUTE_PROGRAMS.includes(v)) &&
      programs.includes(c.jupiterProgram) &&
      programs.includes(OPEN_ROUTE_PROGRAMS[1]!) &&
      programs.includes(c.tokenProgram) &&
      r.readBigUInt64LE(122) <= BigInt(snapshot.slot) &&
      r.readBigUInt64LE(130) > BigInt(snapshot.slot),
    "REGISTRY",
  );
  const regHash = hash(
    Buffer.concat([
      Buffer.from("c3-route-registry-v1"),
      Buffer.from(publicKeyBytes(policy.vault)),
      r.subarray(81, 89),
      r.subarray(122, 138),
      Buffer.from([count]),
      r.subarray(139, 139 + count * 32),
    ]),
  );
  demand(
    regHash.equals(r.subarray(89, 121)) &&
      regHash.toString("hex") === policy.registryHash,
    "REGISTRY_HASH",
  );
  demand(
    q[8] === 1 &&
      key(q, 9) === policy.vault &&
      key(q, 41) === policy.governance &&
      q.readBigUInt64LE(73) === 1n &&
      q.readBigUInt64LE(81).toString() === policy.quotePolicyRevision &&
      key(q, 89) === policy.quoteAuthority &&
      q[121] === 1 &&
      q.readBigInt64LE(122) > 0n &&
      q.readBigInt64LE(122) <= 30n &&
      q.readUInt16LE(130) === policy.maxSlippageBps &&
      q
        .subarray(132, 164)
        .equals(Buffer.from(publicKeyBytes(snapshot.genesis))) &&
      q.subarray(164, 180).equals(Buffer.from("C3QUOTESEAL-V1!!")),
    "QUOTE_POLICY",
  );
  return { programs, maxAgeSeconds: Number(q.readBigInt64LE(122)) };
}

/** Exact fixed layouts are checked before any bytes become a trusted context. */
export function deriveVerifiedLegContext(
  policy: SettlementServerPolicy,
  row: DurableLeg,
  ordinal: number,
  snapshot: Readonly<{
    slot: number;
    genesis: string;
    accounts: Readonly<Record<string, OpenAccount | null>>;
  }>,
  economicReviewOnly = false,
): StoredQuoteContext {
  demand(Number.isInteger(ordinal) && ordinal >= 0 && ordinal < 6, "ORDINAL");
  const scope = approvedOwnerCompilerPolicy({
      ...policy,
      version: "c3-open-production/v1",
    } as OpenProductionPolicy),
    a = openAddresses(scope),
    buying = ordinal < 3,
    leg = ordinal % 3,
    plan = buying ? a.depositPlan : a.redemptionPlan;
  demand(
    row.wallet === policy.wallet &&
      row.vault === policy.vault &&
      row.share_mint === policy.shareMint &&
      row.configuration_hash === policy.configurationHash,
    "ENROLLMENT",
  );
  demand(
    !row.submitted_signature &&
      ["pending", "leased", "prepared"].includes(row.leg_state) &&
      (buying
        ? ["funded", "buying"]
        : ["redemption_requested", "selling"]
      ).includes(row.state),
    "DURABLE_STATE",
  );
  const deadline =
    row.generation === "0" ? row.expires_at : row.generation_expiry;
  demand(
    deadline instanceof Date && (economicReviewOnly || deadline > row.db_now),
    "GENERATION_EXPIRY",
  );
  const accounts = snapshot.accounts;
  const cfg = verifyOpenConfig(scope, accounts[policy.vault]!);
  verifyOpenShareMint(scope, accounts[policy.shareMint]!);
  demand(!cfg.paused, "PAUSED");
  const p = verifyOpenPlan(scope, plan, accounts[plan]!, row.chain_revision);
  const clock = accountBytes(
      accounts[CLOCK],
      "Sysvar1111111111111111111111111111111111111",
      40,
    ),
    now = clock.readBigInt64LE(32);
  demand(
    Number.isSafeInteger(snapshot.slot) &&
      snapshot.slot > 0 &&
      (economicReviewOnly ? p.expiresAt <= now : p.expiresAt > now) &&
      p.bitmap === (1 << leg) - 1 &&
      (!p.activeAuthorization.some((x) => x !== 0) ||
        (economicReviewOnly && p.bytes.readBigInt64LE(892) <= now)),
    "PLAN_PROGRESS_OR_EXPIRY",
  );
  const intent = verifyOpenIntent(
    scope,
    accounts[buying ? a.deposit : a.redemption]!,
    !buying,
    [2],
  );
  if (!buying)
    demand(
      p.budgets.every((v, i) => v === intent.readBigUInt64LE(122 + i * 8)),
      "REDEMPTION_RESERVES",
    );
  const { programs, maxAgeSeconds } = verifyLegGovernance(policy, snapshot);
  const asset = [c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][leg]!,
    source = buying ? a.vaultTokens[0]! : a.vaultTokens[leg + 1]!,
    destination = buying ? a.vaultTokens[leg + 1]! : a.vaultTokens[0]!;
  const input = verifyOpenToken(
      accounts[source]!,
      a.authority,
      buying ? c.usdcMint : asset,
    ),
    output = verifyOpenToken(
      accounts[destination]!,
      a.authority,
      buying ? asset : c.usdcMint,
    );
  demand(input >= p.budgets[leg]! && output >= 0n, "INVENTORY");
  return Object.freeze({
    keeper: policy.keeper,
    governance: policy.governance,
    policy: policy.quotePolicy,
    reviewedPrograms: programs,
    genesisHash: Buffer.from(publicKeyBytes(snapshot.genesis)).toString("hex"),
    vault: policy.vault,
    configVersion: "1",
    registry: policy.registry,
    registryRevision: policy.registryRevision,
    registryHash: policy.registryHash,
    plan,
    planRevision: row.chain_revision,
    intent: buying ? a.deposit : a.redemption,
    wallet: policy.wallet,
    leg,
    direction: buying ? 1 : 2,
    inputMint: buying ? c.usdcMint : asset,
    outputMint: buying ? asset : c.usdcMint,
    source,
    destination,
    routerProgram: c.jupiterProgram,
    policyRevision: policy.quotePolicyRevision,
    inputAmount: p.budgets[leg]!.toString(),
    authority: Buffer.from(publicKeyBytes(policy.quoteAuthority)).toString(
      "hex",
    ),
    maxSlippageBps: policy.maxSlippageBps,
    maxQuoteAgeSeconds: maxAgeSeconds,
    planExpiresAt: p.expiresAt.toString(),
    configurationHash: policy.configurationHash,
    planMinimumOutput: p.minima[leg]!.toString(),
    ...(economicReviewOnly ? { economicReviewOnly: true } : {}),
  });
}
/** This internal factory is reached through either the immutable production
 * gate or the explicitly non-Mainnet adapter below. No public scope override. */
class VerifiedLegFactory {
  readonly pool: Pool;
  readonly policy: SettlementServerPolicy;
  readonly rpc: OwnerReadonlyRpc;
  readonly genesis: string;
  readonly production: boolean;
  constructor(
    pool: Pool,
    policy: SettlementServerPolicy,
    rpc: OwnerReadonlyRpc,
    genesis: string,
    production: boolean,
  ) {
    this.pool = pool;
    this.policy = policy;
    this.rpc = rpc;
    this.genesis = genesis;
    this.production = production;
  }
  async capture(
    intentId: string,
    ordinal: number,
    revision: bigint,
    economicReviewOnly = false,
  ): Promise<StoredQuoteContext> {
    demand(Number.isInteger(ordinal) && ordinal >= 0 && ordinal < 6, "ORDINAL");
    demand(
      (await this.rpc.read("getGenesisHash", [])) === this.genesis,
      "CLUSTER",
    );
    const row = (
      await this.pool.query<DurableLeg>(
        `SELECT i.*,l.state AS leg_state,l.submitted_signature,clock_timestamp() AS db_now,COALESCE(g.generation::text,'0') AS generation,g.expires_at AS generation_expiry FROM c3_open.intents i JOIN c3_open.legs l USING(intent_id) LEFT JOIN LATERAL (SELECT generation,expires_at FROM c3_open.plan_generations WHERE intent_id=i.intent_id AND plan=CASE WHEN $2<3 THEN i.deposit_plan ELSE i.redemption_plan END ORDER BY generation DESC LIMIT 1) g ON true WHERE i.intent_id=$1 AND l.ordinal=$2`,
        [intentId, ordinal],
      )
    ).rows[0];
    demand(row && row.db_revision === revision.toString(), "CAS");
    const a = openAddresses(
        approvedOwnerCompilerPolicy({
          ...this.policy,
          version: "c3-open-production/v1",
        } as OpenProductionPolicy),
      ),
      names = [
        this.policy.vault,
        this.policy.shareMint,
        this.policy.registry,
        this.policy.quotePolicy,
        ordinal < 3 ? a.deposit : a.redemption,
        ordinal < 3 ? a.depositPlan : a.redemptionPlan,
        ...a.vaultTokens,
        CLOCK,
      ];
    const result = (await this.rpc.read("getMultipleAccounts", [
      names,
      { commitment: "finalized", encoding: "base64" },
    ])) as { context: { slot: number }; value: (OpenAccount | null)[] };
    demand(result?.value?.length === names.length, "SNAPSHOT");
    const accounts = Object.fromEntries(
        names.map((n, i) => [n, result.value[i]!]),
      ),
      ctx = deriveVerifiedLegContext(
        this.policy,
        row!,
        ordinal,
        {
          slot: result.context.slot,
          genesis: this.genesis,
          accounts,
        },
        economicReviewOnly,
      );
    const evidence = {
      slot: result.context.slot,
      genesis: this.genesis,
      accountHashes: names.map((n) => ({
        address: n,
        hash: hash(canonicalize(accounts[n])).toString("hex"),
      })),
      generation: row!.generation,
    };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const current = (
        await client.query(
          "SELECT db_revision,chain_revision FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
          [intentId],
        )
      ).rows[0];
      demand(
        current?.db_revision === revision.toString() &&
          current.chain_revision === ctx.planRevision,
        "CAS",
      );
      const pending = await client.query(
        `SELECT 1 FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL AND g.request_id IS NULL UNION ALL SELECT 1 FROM c3_open.renewal_requests r JOIN c3_open.renewal_submissions s USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) LEFT JOIN c3_open.renewal_outcomes o USING(request_id) WHERE r.intent_id=$1 AND g.request_id IS NULL AND o.request_id IS NULL LIMIT 1`,
        [intentId],
      );
      demand(!pending.rowCount, "OWNER_OR_RENEWAL_UNCERTAIN");
      const unresolvedLeg = await client.query(
        "SELECT 1 FROM c3_open.legs WHERE intent_id=$1 AND state IN ('signed','submitted','uncertain','manual_review','reconciliation_required') UNION ALL SELECT 1 FROM c3_open.signing_requests s JOIN c3_open.quote_authorizations q USING(quote_id) WHERE q.intent_id=$1 AND s.state<>'result' LIMIT 1",
        [intentId],
      );
      demand(!unresolvedLeg.rowCount, "RECONCILE_FIRST");
      if (economicReviewOnly) {
        await client.query("COMMIT");
        return ctx; // Never enroll executable or MAINNET_REVIEWED context.
      }
      await client.query(
        `INSERT INTO c3_open.leg_context_verifications(verification_id,intent_id,ordinal,intent_revision,context_hash,policy_hash,evidence_hash,genesis_hash,scope,finalized_slot,context,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          intentId,
          ordinal,
          revision.toString(),
          quoteContextHash(openQuoteContext(ctx)),
          hash(canonicalize(this.policy)),
          hash(canonicalize(evidence)),
          this.genesis,
          this.production ? "MAINNET_REVIEWED" : "ISOLATED_VERIFIED",
          result.context.slot,
          ctx,
          evidence,
        ],
      );
      await client.query("COMMIT");
      return ctx;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
export function isolatedLegFactory(
  pool: Pool,
  policy: SettlementServerPolicy,
  rpc: OwnerReadonlyRpc,
  genesis: string,
) {
  demand(genesis !== c.genesisHash, "ISOLATED_MAINNET_FORBIDDEN");
  publicKeyBytes(genesis);
  return new VerifiedLegFactory(pool, policy, rpc, genesis, false);
}
export async function captureProductionLeg(
  pool: Pool,
  intentId: string,
  ordinal: number,
  revision: bigint,
) {
  const p = requireOpenProductionPolicy();
  await assertProductionEnrollment(pool, p, intentId, "intent");
  await verifyProductionVaultArtifact();
  return new VerifiedLegFactory(
    pool,
    p,
    productionOwnerRpc(),
    c.genesisHash,
    true,
  ).capture(intentId, ordinal, revision);
}

export async function captureProductionMinimumReview(
  pool: Pool,
  intentId: string,
  ordinal: number,
  revision: bigint,
) {
  const p = requireOpenProductionPolicy();
  await assertProductionEnrollment(pool, p, intentId, "intent");
  await verifyProductionVaultArtifact();
  return new VerifiedLegFactory(
    pool,
    p,
    productionOwnerRpc(),
    c.genesisHash,
    true,
  ).capture(intentId, ordinal, revision, true);
}
