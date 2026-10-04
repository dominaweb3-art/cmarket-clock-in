/** Read-only NAV/accounting join. No client price, balance-as-credit, signer,
 * wallet or owner-service mutation. PG receipts corroborate finalized raw state;
 * they are not a second ownership ledger. The isolated entrypoint can NEVER
 * mint production evidence. Production still needs approved policy, raw price
 * pins and the separately required independent economic oracle source.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { canonicalize } from "./manifest.ts";
import { C3_MAINNET as c } from "./constants.ts";
import { publicKeyBytes } from "./solana.ts";
import type { OpenCompilerPolicy } from "./open-owner-compiler.ts";
import { approvedOwnerCompilerPolicy } from "./open-owner-trust.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { verifyOpenOwnerSchema } from "./open-owner-schema.ts";
import { verifyProductionVaultArtifact } from "./open-vault-artifact.ts";
import {
  productionOwnerRpc,
  type OwnerReadonlyRpc,
} from "./open-owner-service.ts";
import { VAULT_PROGRAM } from "./open-v0-envelope.ts";
import {
  accountBytes,
  openAddresses,
  verifyOpenConfig,
  verifyOpenShareMint,
  verifyOpenToken,
  verifyOpenIntent,
  verifyOpenPlan,
  SHARE_TOKEN_PROGRAM,
  type OpenAccount,
} from "./open-state-semantics.ts";
import { calculateOpenNavMath, type OpenNavMathInput } from "./open-nav.ts";
import {
  collectVerifiedOpenNavPoint,
  evaluateVerifiedOpenNav,
  evaluateIsolatedOpenNavPoint,
  type IsolatedOpenNavPoint,
  type VerifiedOpenNavPoint,
} from "./open-nav-collector.ts";

const ASSETS = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
const MINTS = [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint];
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const digest = (v: unknown) =>
  createHash("sha256").update(canonicalize(v)).digest("hex");
const missing = (reason: string) =>
  Object.freeze({ status: "UNAVAILABLE" as const, reason });
function need(v: unknown, reason: string): asserts v {
  if (!v) throw Error("C3_NAV_POSITION_" + reason);
}
function obj(v: unknown): Record<string, unknown> {
  need(v && typeof v === "object" && !Array.isArray(v), "SHAPE");
  const p = Object.getPrototypeOf(v);
  need(p === Object.prototype || p === null, "SHAPE");
  for (const k of Reflect.ownKeys(v))
    need(
      typeof k === "string" &&
        "value" in Object.getOwnPropertyDescriptor(v, k)!,
      "SHAPE",
    );
  return v as Record<string, unknown>;
}
function exact(v: unknown, keys: readonly string[]) {
  const o = obj(v);
  need(Object.keys(o).sort().join() === [...keys].sort().join(), "SHAPE");
  return o;
}
function uint(v: unknown): bigint {
  need(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v), "INTEGER");
  const n = BigInt(v);
  need(n <= (1n << 64n) - 1n, "INTEGER");
  return n;
}
function hash(v: unknown) {
  need(
    typeof v === "string" && /^[a-f0-9]{64}$/.test(v) && !/^0+$/.test(v),
    "HASH",
  );
  return v;
}
function signature(v: unknown) {
  need(
    typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(v),
    "SIGNATURE",
  );
}

/** One statement snapshot, indexed by intent PK/FKs. Never keep a connection or
 * transaction across RPC. Full snapshot fingerprint is re-read after RPC/price
 * work (not only db_revision: journal insertion need not bump that revision).
 * Missing migrations/schema cause UNAVAILABLE, never legacy fallback.
 */
const READ = `SELECT jsonb_build_object(
 'intent',jsonb_build_object('id',i.intent_id,'wallet',i.wallet,'vault',i.vault,'shareMint',i.share_mint,'configurationHash',i.configuration_hash,'state',i.state,'dbRevision',i.db_revision::text,'chainRevision',i.chain_revision::text,'depositPlan',i.deposit_plan,'redemptionPlan',i.redemption_plan,'amount',i.deposit_amount::text),
 'enrollment',(SELECT e.policy_hash FROM c3_open.production_enrollments e WHERE e.intent_id=i.intent_id),
 'legs',COALESCE((SELECT jsonb_agg(jsonb_build_object('ordinal',l.ordinal,'state',l.state,'signature',l.submitted_signature,'evidenceHash',l.evidence_hash,'effects',l.observed_effects,'context',(SELECT jsonb_build_object('scope',v.scope,'genesis',v.context->>'genesisHash','authorizationHash',encode(q.payload_hash,'hex')) FROM c3_open.quote_authorizations q JOIN c3_open.all_quote_contexts v USING(intent_id,ordinal,intent_revision) WHERE q.intent_id=l.intent_id AND q.ordinal=l.ordinal AND encode(q.payload_hash,'hex')=l.authorization_hash AND q.state='consumed')) ORDER BY l.ordinal) FROM c3_open.legs l WHERE l.intent_id=i.intent_id),'[]'::jsonb),
 'receipts',COALESCE((SELECT jsonb_agg(jsonb_build_object('action',r.action,'stage',e.lifecycle_stage,'requestHash',encode(r.message_hash,'hex'),'submissionHash',encode(s.message_hash,'hex'),'signature',s.signature,'slot',m.slot::text,'messageEvidence',encode(m.evidence_hash,'hex'),'effectEvidence',encode(e.evidence_hash,'hex'),'authorization',a.manifest,'authorizationHash',encode(a.manifest_hash,'hex'),'policyHash',a.policy_hash,'economic',x.manifest,'economicHash',encode(x.manifest_hash,'hex')) ORDER BY r.action) FROM c3_open.owner_requests r JOIN c3_open.owner_effect_receipts e USING(request_id) JOIN c3_open.owner_submissions s USING(request_id) JOIN c3_open.owner_message_receipts m USING(request_id) JOIN c3_open.owner_authorization_manifests a USING(request_id) JOIN c3_open.owner_economic_manifests x USING(request_id) WHERE r.intent_id=i.intent_id),'[]'::jsonb),
 'pending',EXISTS(SELECT 1 FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) WHERE r.intent_id=i.intent_id AND e.request_id IS NULL AND o.request_id IS NULL AND g.request_id IS NULL)
 OR EXISTS(SELECT 1 FROM c3_open.renewal_requests r JOIN c3_open.renewal_submissions s USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) LEFT JOIN c3_open.renewal_outcomes o USING(request_id) WHERE r.intent_id=i.intent_id AND g.request_id IS NULL AND o.request_id IS NULL)
 OR EXISTS(SELECT 1 FROM c3_open.signing_requests s JOIN c3_open.quote_authorizations q USING(quote_id) WHERE q.intent_id=i.intent_id AND s.state<>'result')
 OR EXISTS(SELECT 1 FROM c3_open.keeper_packets k LEFT JOIN c3_open.keeper_effect_receipts e USING(request_id) LEFT JOIN c3_open.keeper_request_outcomes o USING(request_id) WHERE k.intent_id=i.intent_id AND e.request_id IS NULL AND o.request_id IS NULL)
) AS snapshot FROM c3_open.intents i WHERE i.intent_id=$1`;
async function durable(pool: Pool, id: string) {
  const rows = (await pool.query(READ, [id])).rows;
  need(rows.length === 1, "INTENT");
  const s = exact(rows[0].snapshot, [
    "intent",
    "enrollment",
    "legs",
    "receipts",
    "pending",
  ]);
  // Copy before await; do not retain mutable result objects supplied by a port.
  return JSON.parse(canonicalize(s)) as Record<string, unknown>;
}

function accounting(
  policy: OpenCompilerPolicy,
  id: string,
  db: Record<string, unknown>,
  raw: Record<string, OpenAccount | null>,
  slot: number,
  genesis: string,
  production: boolean,
) {
  const a = openAddresses(policy),
    i = exact(db.intent, [
      "id",
      "wallet",
      "vault",
      "shareMint",
      "configurationHash",
      "state",
      "dbRevision",
      "chainRevision",
      "depositPlan",
      "redemptionPlan",
      "amount",
    ]);
  need(
    i.id === id &&
      i.wallet === policy.wallet &&
      i.vault === policy.vault &&
      i.shareMint === policy.shareMint &&
      i.configurationHash === policy.configurationHash &&
      i.depositPlan === a.depositPlan &&
      i.amount === "1000000" &&
      uint(i.dbRevision) > 0n,
    "SCOPE",
  );
  const selling = [
    "redemption_requested",
    "selling",
    "claimable",
    "redeemed",
  ].includes(i.state as string);
  need(
    [
      "funded",
      "buying",
      "active",
      "redemption_requested",
      "selling",
      "claimable",
      "redeemed",
    ].includes(i.state as string),
    "UNCERTAIN_SETTLEMENT",
  );
  need(i.redemptionPlan === (selling ? a.redemptionPlan : null), "SCOPE");
  need(db.enrollment === digest(policy), "ENROLLMENT");
  need(db.pending === false, "UNCERTAIN_SETTLEMENT");
  const cfg = verifyOpenConfig(policy, raw[policy.vault]!);
  need(
    cfg.bytes.readBigUInt64LE(456) === 1n &&
      cfg.bytes.readBigUInt64LE(464) === (selling ? 1n : 0n),
    "INTENT_COUNTERS",
  );
  const supply = verifyOpenShareMint(policy, raw[policy.shareMint]!).supply;
  const ownerShares =
    raw[a.ownerShares] === null
      ? 0n
      : verifyOpenToken(
          raw[a.ownerShares]!,
          policy.wallet,
          policy.shareMint,
          SHARE_TOKEN_PROGRAM,
        );
  need(supply === ownerShares, "OWNER_SHARE_SUPPLY");
  const custody = a.vaultTokens.map((n, index) =>
    verifyOpenToken(raw[n]!, a.authority, MINTS[index]!),
  );
  need(
    Array.isArray(db.receipts) &&
      Array.isArray(db.legs) &&
      db.legs.length === 6,
    "RECEIPTS",
  );
  const stages = new Set<string>(),
    receiptHashes: string[] = [];
  for (const v of db.receipts) {
    const r = exact(v, [
      "action",
      "stage",
      "requestHash",
      "submissionHash",
      "signature",
      "slot",
      "messageEvidence",
      "effectEvidence",
      "authorization",
      "authorizationHash",
      "policyHash",
      "economic",
      "economicHash",
    ]);
    const expected = {
      deposit: "funded",
      issue_shares: "active",
      request_redemption: "redemption_requested",
      claim: "redeemed",
    }[r.action as string];
    need(expected && r.stage === expected && !stages.has(expected), "RECEIPTS");
    stages.add(expected);
    signature(r.signature);
    need(uint(r.slot) > 0n && uint(r.slot) <= BigInt(slot), "RECEIPT_SLOT");
    hash(r.messageEvidence);
    receiptHashes.push(hash(r.effectEvidence));
    need(
      hash(r.requestHash) === r.submissionHash &&
        r.policyHash === digest(policy),
      "MESSAGE_BINDING",
    );
    const auth = obj(r.authorization),
      econ = obj(r.economic);
    need(
      digest(auth) === hash(r.authorizationHash) &&
        digest(econ) === hash(r.economicHash),
      "MANIFEST_HASH",
    );
    need(
      auth.version === "c3-owner-authorization/v2" &&
        econ.version === "c3-owner-effects/v2" &&
        auth.intentId === id &&
        auth.vault === policy.vault &&
        auth.wallet === policy.wallet &&
        auth.shareMint === policy.shareMint &&
        auth.configurationHash === policy.configurationHash &&
        auth.idlHash === policy.idlHash &&
        auth.registryRevision === policy.registryRevision &&
        auth.quotePolicyRevision === policy.quotePolicyRevision &&
        auth.feesEnabled === false &&
        auth.plan ===
          (r.action === "request_redemption" || r.action === "claim"
            ? a.redemptionPlan
            : a.depositPlan) &&
        auth.messageHash === r.requestHash &&
        econ.messageHash === r.requestHash &&
        econ.wallet === policy.wallet &&
        econ.program === policy.program &&
        econ.vault === policy.vault &&
        econ.shareMint === policy.shareMint &&
        digest(econ.semanticScope) === digest(policy) &&
        econ.plan === auth.plan &&
        econ.onchainIntent ===
          (r.action === "request_redemption" || r.action === "claim"
            ? a.redemption
            : a.deposit) &&
        auth.action === r.action &&
        econ.action === r.action,
      "MANIFEST_BINDING",
    );
  }
  const owned = [
      "active",
      "redemption_requested",
      "selling",
      "claimable",
    ].includes(i.state as string),
    closed = i.state === "redeemed";
  need(
    stages.has("funded") &&
      stages.has("active") === (owned || closed) &&
      stages.has("redemption_requested") === selling &&
      stages.has("redeemed") === closed,
    "RECEIPTS",
  );
  need(
    supply === (owned ? 1000000n : 0n) &&
      cfg.sharesIssued === (owned || closed ? 1000000n : 0n) &&
      cfg.lifecycle === (closed ? 4 : selling ? 3 : owned ? 2 : 1),
    "LIFECYCLE",
  );
  const d = verifyOpenIntent(
    policy,
    raw[a.deposit]!,
    false,
    owned || closed ? [5] : [2, 3],
  );
  const readPlan = (name: string) => {
    if (raw[name] === null) return null;
    const b = accountBytes(raw[name], policy.program, 901, "SettlementPlan");
    const p = verifyOpenPlan(
      policy,
      name,
      raw[name]!,
      b.readBigUInt64LE(716).toString(),
    );
    need(
      p.activeAuthorization.every((v) => v === 0) &&
        p.bytes.subarray(828, 860).every((v) => v === 0),
      "UNCERTAIN_SETTLEMENT",
    );
    return p;
  };
  const buy = readPlan(a.depositPlan),
    sell = readPlan(a.redemptionPlan);
  need(
    (selling ? (sell?.revision ?? 0n) : (buy?.revision ?? 0n)) ===
      uint(i.chainRevision),
    "CHAIN_REVISION",
  );
  need(!buy || buy.direction === 1, "PLAN_DIRECTION");
  need(!sell || sell.direction === 2, "PLAN_DIRECTION");
  const credits = [0n, 0n, 0n],
    sold = [0n, 0n, 0n];
  let spent = 0n,
    realized = 0n;
  for (let ordinal = 0; ordinal < 6; ordinal++) {
    const l = exact(db.legs[ordinal], [
        "ordinal",
        "state",
        "signature",
        "evidenceHash",
        "effects",
        "context",
      ]),
      p = ordinal < 3 ? buy : sell,
      n = ordinal % 3;
    need(l.ordinal === ordinal, "LEG_ORDER");
    const completed = !!p && (p.bitmap & (1 << n)) !== 0;
    need(
      l.state === (completed ? "confirmed" : "pending"),
      "UNCERTAIN_SETTLEMENT",
    );
    if (!completed) {
      need(
        l.signature === null &&
          l.evidenceHash === null &&
          l.effects === null &&
          l.context === null,
        "UNCERTAIN_SETTLEMENT",
      );
      continue;
    }
    signature(l.signature);
    hash(l.evidenceHash);
    const e = obj(l.effects);
    need(
      e.scope === "SEMANTIC_EFFECTS_VERIFIED" &&
        uint(e.inputAmount) === p!.budgets[n] &&
        uint(e.outputAmount) === p!.outputs[n] &&
        uint(e.outputAmount) > 0n &&
        uint(e.chainRevision) <= p!.revision,
      "LEG_EFFECTS",
    );
    hash(e.authorizationHash);
    hash(e.quoteId);
    const state = accountBytes(
      {
        owner: policy.program,
        executable: false,
        data: [e.planStateBase64 as string, "base64"],
      },
      policy.program,
      901,
      "SettlementPlan",
    );
    const context = exact(l.context, ["scope", "genesis", "authorizationHash"]);
    need(
      context.scope ===
        (production ? "MAINNET_REVIEWED" : "ISOLATED_VERIFIED") &&
        context.genesis ===
          Buffer.from(publicKeyBytes(genesis)).toString("hex") &&
        context.authorizationHash === e.authorizationHash,
      "LEG_EVIDENCE_SCOPE",
    );
    need(
      createHash("sha256").update(state).digest("hex") ===
        hash(e.planStateHash),
      "LEG_PLAN_HASH",
    );
    const old = verifyOpenPlan(
      policy,
      ordinal < 3 ? a.depositPlan : a.redemptionPlan,
      {
        owner: policy.program,
        executable: false,
        data: [state.toString("base64"), "base64"],
      },
      uint(e.chainRevision).toString(),
    );
    need(
      old.bitmap === (1 << (n + 1)) - 1 &&
        old.outputs[n] === p!.outputs[n] &&
        old.budgets.every((b, j) => b === p!.budgets[j]),
      "LEG_PLAN_BINDING",
    );
    if (ordinal < 3) {
      credits[n] = p!.outputs[n]!;
      spent += p!.budgets[n]!;
    } else {
      sold[n] = p!.budgets[n]!;
      realized += p!.outputs[n]!;
    }
  }
  if (owned || closed || d[113] === 3)
    need(
      buy?.bitmap === 7 &&
        credits.every((v, n) => d.readBigUInt64LE(162 + n * 8) === v) &&
        d.readBigUInt64LE(186) === (owned || closed ? 1000000n : 0n),
      "DEPOSIT_CREDITS",
    );
  let claim: string | null = null;
  if (selling) {
    const r = verifyOpenIntent(
      policy,
      raw[a.redemption]!,
      true,
      closed ? [6] : i.state === "claimable" ? [4] : [2],
    );
    need(
      credits.every(
        (v, n) =>
          r.readBigUInt64LE(122 + n * 8) === v &&
          (!sell || sell.budgets[n] === v),
      ),
      "REDEMPTION_BUDGET",
    );
    if (closed || i.state === "claimable") {
      need(
        sell?.bitmap === 7 &&
          realized > 0n &&
          r.readBigUInt64LE(154) === realized &&
          r.readBigUInt64LE(162) === (closed ? realized : 0n),
        "ACTUAL_CLAIM",
      );
      claim = realized.toString();
    } else
      need(
        r.readBigUInt64LE(154) === 0n && r.readBigUInt64LE(162) === 0n,
        "ACTUAL_CLAIM",
      );
  } else need(raw[a.redemption] === null && sell === null, "LIFECYCLE");
  const accounted = closed
    ? [0n, 0n, 0n, 0n]
    : [
        selling ? realized : 1000000n - spent,
        ...credits.map((v, n) => v - sold[n]!),
      ];
  need(
    accounted.every((n, j) => n >= 0n && custody[j]! >= n),
    "ACCOUNTED_BACKING",
  );
  const inventory = Object.fromEntries(
    ASSETS.map((asset, j) => [
      asset,
      {
        custodyBaseUnits: custody[j]!.toString(),
        accountedBaseUnits: accounted[j]!.toString(),
        excludedReserveBaseUnits: owned ? "0" : accounted[j]!.toString(),
      },
    ]),
  ) as OpenNavMathInput["inventory"];
  return {
    inventory,
    supply,
    claim,
    owned,
    closed,
    receiptHashes: Object.freeze(receiptHashes),
    revision: i.dbRevision as string,
  };
}

async function read(
  pool: Pool,
  policy: OpenCompilerPolicy,
  rpc: OwnerReadonlyRpc,
  genesis: string,
  id: string,
  point: IsolatedOpenNavPoint | VerifiedOpenNavPoint,
  production: boolean,
) {
  try {
    const evaluate = () =>
      production
        ? evaluateVerifiedOpenNav(point as VerifiedOpenNavPoint)
        : evaluateIsolatedOpenNavPoint(point as IsolatedOpenNavPoint);
    const prices = evaluate();
    if (prices.status === "UNAVAILABLE") return prices;
    need(
      prices.evidenceScope ===
        (production ? "PRODUCTION_PRICE_EVIDENCE" : "ISOLATED_ONLY"),
      "PRICE_SCOPE",
    );
    need(policy.program === VAULT_PROGRAM.toBase58(), "PROGRAM_PIN");
    const before = await durable(pool, id);
    need(before.pending === false, "UNCERTAIN_SETTLEMENT");
    need((await rpc.read("getGenesisHash", [])) === genesis, "GENESIS");
    const a = openAddresses(policy),
      names = [
        policy.vault,
        policy.shareMint,
        a.ownerShares,
        ...a.vaultTokens,
        a.deposit,
        a.redemption,
        a.depositPlan,
        a.redemptionPlan,
        CLOCK,
      ];
    const s = obj(
      await rpc.read("getMultipleAccounts", [
        names,
        {
          commitment: "finalized",
          encoding: "base64",
          minContextSlot: prices.contextSlot,
        },
      ]),
    );
    const slot = obj(s.context).slot;
    need(
      typeof slot === "number" &&
        Number.isSafeInteger(slot) &&
        slot >= prices.contextSlot &&
        Array.isArray(s.value) &&
        s.value.length === names.length,
      "FINALIZED_CONTEXT",
    );
    const values = s.value;
    const raw = Object.fromEntries(
      names.map((n, j) => [n, values[j]]),
    ) as Record<string, OpenAccount | null>;
    const clock = accountBytes(
      raw[CLOCK],
      "Sysvar1111111111111111111111111111111111111",
      40,
    );
    const now = clock.readBigInt64LE(32);
    need(
      clock.readBigUInt64LE(0) === BigInt(slot) &&
        now > 0n &&
        now <= BigInt(Number.MAX_SAFE_INTEGER),
      "CHAIN_CLOCK",
    );
    const inventory = accounting(
      policy,
      id,
      before,
      raw,
      slot,
      genesis,
      production,
    );
    const after = await durable(pool, id);
    need(digest(before) === digest(after), "SNAPSHOT_CHANGED");
    const finalPrices = evaluate();
    if (finalPrices.status === "UNAVAILABLE") return finalPrices;
    for (const asset of ASSETS) {
      const f = finalPrices.freshness[asset];
      need(
        now >= BigInt(f.publishedAtUnix) &&
          now - BigInt(f.publishedAtUnix) <= BigInt(f.maximumAgeSeconds) &&
          Math.abs(Number(now) - finalPrices.evaluatedAtUnix) <=
            f.maximumChainClockSkewSeconds,
        "PRICE_CONTEXT_EXPIRED",
      );
    }
    const math = calculateOpenNavMath({
      inventory: inventory.inventory,
      pricesUsdE12: finalPrices.pricesUsdE12,
      shareSupplyBaseUnits: inventory.supply.toString(),
      expectedShareSupplyBaseUnits: inventory.supply.toString(),
      lifecycle: inventory.closed
        ? "closed"
        : inventory.owned
          ? "active"
          : "pre_issuance",
      settlementState: "certain",
    });
    if (math.status === "UNAVAILABLE") return math;
    // Two RPC operators are NOT two independent economic price sources. Do not
    // silently close that production requirement with a single Pyth guardian set.
    if (production && finalPrices.economicOracleOperators < 2)
      return missing("INDEPENDENT_ECONOMIC_PRICE_SOURCE_NOT_PINNED");
    return Object.freeze({
      status: "NAV_ACCOUNTING_JOIN" as const,
      evidenceScope: production
        ? ("PRODUCTION_PRICE_EVIDENCE" as const)
        : ("ISOLATED_ONLY" as const),
      contextSlot: slot,
      priceContextSlot: finalPrices.contextSlot,
      dbRevision: inventory.revision,
      inventory: Object.freeze(
        Object.fromEntries(
          ASSETS.map((asset) => [
            asset,
            Object.freeze(inventory.inventory[asset]),
          ]),
        ) as OpenNavMathInput["inventory"],
      ),
      math,
      actualFullClaimUsdcBaseUnits: inventory.claim,
      effectReceiptHashes: inventory.receiptHashes,
    });
  } catch (e) {
    return missing(
      e instanceof Error &&
        /^C3_(NAV_POSITION|OPEN_STATE|OPEN_NAV)_/.test(e.message)
        ? e.message
        : "EVIDENCE_READ_OR_SCHEMA_UNAVAILABLE",
    );
  }
}

/** Isolated integration only. Injected ports/policy cannot activate production.
 * The Pyth fixture uses the Mainnet feed domain, but custody may NOT be Mainnet.
 */
export function createIsolatedOpenNavPositionReader(
  pool: Pool,
  policy: OpenCompilerPolicy,
  rpc: OwnerReadonlyRpc,
  genesis: string,
) {
  need(genesis !== c.genesisHash, "ISOLATED_MAINNET_FORBIDDEN");
  publicKeyBytes(genesis);
  const copied = Object.freeze(
      JSON.parse(canonicalize(policy)),
    ) as OpenCompilerPolicy,
    port = Object.freeze({ read: rpc.read.bind(rpc) });
  return Object.freeze({
    read: (intentId: string, point: IsolatedOpenNavPoint) =>
      read(pool, copied, port, genesis, intentId, point, false),
  });
}
/** No caller policy/RPC/price/"verified" flag. Gate runs before all I/O. Owner
 * service must map UNAVAILABLE to no NAV, never carry forward a previous price.
 */
export async function readProductionOpenNavPosition(
  pool: Pool,
  intentId: string,
) {
  let approved;
  try {
    approved = requireOpenProductionPolicy();
  } catch {
    return missing("PRODUCTION_NOT_APPROVED");
  }
  try {
    await verifyOpenOwnerSchema(pool);
    await verifyProductionVaultArtifact();
    const point = await collectVerifiedOpenNavPoint();
    if ("status" in point) return point;
    return read(
      pool,
      approvedOwnerCompilerPolicy(approved),
      productionOwnerRpc(),
      c.genesisHash,
      intentId,
      point,
      true,
    );
  } catch {
    return missing("PRODUCTION_SCHEMA_ARTIFACT_OR_PRICE_EVIDENCE_UNAVAILABLE");
  }
}
