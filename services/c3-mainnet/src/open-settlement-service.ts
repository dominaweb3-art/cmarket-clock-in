/** Trusted worker preparation/recovery entry. Chooses the next operation from
 * durable state; callers cannot supply a route, policy, mint, budget or effects.
 * Returns reviewable unsigned role packets. No automatic signing/broadcast. */
import type { Pool } from "pg";
import type { DurableQuoteSigningProvider } from "./open-signing-journal.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { assertProductionEnrollment } from "./open-owner-trust.ts";
import { productionKeeperJournal } from "./open-keeper-journal.ts";
import { prepareProductionVerifiedLeg } from "./open-leg-authorization.ts";
import {
  VerifiedSettlementJournal,
  type Scope,
} from "./open-settlement-journal.ts";
import { productionOwnerRpc } from "./open-owner-service.ts";
import { productionQuorumConnection } from "./open-quorum-connection.ts";
import { C3_MAINNET } from "./constants.ts";
import { randomUUID, createHash } from "node:crypto";
const demand = (v: unknown): void => {
  if (!v) throw Error("C3_SETTLEMENT_SERVICE_STATE_OR_CAS");
};
export async function prepareProductionNextSettlement(
  pool: Pool,
  quoteSigner: DurableQuoteSigningProvider,
  intentId: string,
  expectedRevision: bigint,
) {
  const p = requireOpenProductionPolicy();
  await assertProductionEnrollment(pool, p, intentId, "intent");
  const journal = new VerifiedSettlementJournal(pool),
    state = await journal.read(intentId);
  demand(state && state.dbRevision === expectedRevision);
  const pending = (
    await pool.query(
      "SELECT p.request_id FROM c3_open.keeper_packets p LEFT JOIN c3_open.keeper_effect_receipts e USING(request_id) LEFT JOIN c3_open.keeper_request_outcomes o USING(request_id) WHERE p.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL ORDER BY p.created_at LIMIT 1",
      [intentId],
    )
  ).rows[0];
  if (pending)
    return {
      kind: "KEEPER_RECOVER_ONLY" as const,
      ...(await productionKeeperJournal(pool).recover(pending.request_id)),
    };
  if (
    [
      "manual_review",
      "reconciliation_required",
      "failed_recoverable",
      "paused",
    ].includes(state!.state)
  )
    return { kind: "RECONCILE_ONLY" as const, state: state!.state };
  if (state!.state === "draft")
    return { kind: "OWNER_ACTION_REQUIRED" as const, action: "deposit" };
  if (state!.state === "active")
    return {
      kind: "OWNER_ACTION_REQUIRED" as const,
      action: "request_redemption",
    };
  if (state!.state === "claimable")
    return { kind: "OWNER_ACTION_REQUIRED" as const, action: "claim" };
  if (state!.state === "redeemed") return { kind: "CLOSED" as const };
  demand(
    ["funded", "buying", "redemption_requested", "selling"].includes(
      state!.state,
    ),
  );
  const sell = ["redemption_requested", "selling"].includes(state!.state),
    plan = sell ? state!.redemptionPlan : state!.depositPlan;
  demand(plan);
  const rpc = productionOwnerRpc(),
    account = (await rpc.read("getAccountInfo", [
      plan,
      { commitment: "finalized", encoding: "base64" },
    ])) as { value: unknown };
  if (!account.value) {
    const prepared = await productionKeeperJournal(pool).prepare(
      intentId,
      sell ? "create_sell_plan" : "create_buy_plan",
    );
    return { kind: "KEEPER_REVIEW_REQUIRED" as const, ...prepared };
  }
  const start = sell ? 3 : 0,
    legs = (
      await pool.query(
        "SELECT ordinal,state,submitted_signature FROM c3_open.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 ORDER BY ordinal",
        [intentId, start, start + 2],
      )
    ).rows;
  demand(legs.length === 3);
  if (legs.every((l) => l.state === "confirmed")) {
    const recorded = (
      await pool.query(
        "SELECT 1 FROM c3_open.keeper_packets p JOIN c3_open.keeper_effect_receipts e USING(request_id) WHERE p.intent_id=$1 AND p.action=$2",
        [intentId, sell ? "record_sell" : "record_buy"],
      )
    ).rowCount;
    if (recorded)
      return {
        kind: "OWNER_ACTION_REQUIRED" as const,
        action: sell ? "claim" : "issue_shares",
      };
    return {
      kind: "KEEPER_REVIEW_REQUIRED" as const,
      ...(await productionKeeperJournal(pool).prepare(
        intentId,
        sell ? "record_sell" : "record_buy",
      )),
    };
  }
  const leg = legs.find((l) => l.state !== "confirmed");
  demand(leg);
  if (leg.submitted_signature || leg.state !== "pending")
    return {
      kind: "LEG_RECOVER_ONLY" as const,
      ordinal: leg.ordinal,
      state: leg.state,
      signature: leg.submitted_signature ?? null,
    };
  const worker = randomUUID(),
    scope: Scope = {
      intentId,
      wallet: p.wallet,
      vault: p.vault,
      expectedDbRevision: state!.dbRevision,
      expectedChainRevision: state!.chainRevision,
      idempotencyHash: createHash("sha256").update(worker).digest("hex"),
    };
  const leased = await journal.lease(scope, leg.ordinal, worker, 60);
  const prepared = await prepareProductionVerifiedLeg(pool, quoteSigner, {
    intentId,
    ordinal: leg.ordinal,
    expectedRevision: leased.dbRevision,
  });
  const quote = (
    await pool.query(
      "SELECT q.canonical_payload,q.payload_hash,q.expires_at,q.evidence,v.context FROM c3_open.quote_authorizations q JOIN c3_open.all_quote_contexts v USING(intent_id,ordinal,intent_revision) WHERE q.quote_id=$1 AND q.state='signed'",
      [Buffer.from(prepared.quoteId, "hex")],
    )
  ).rows[0];
  demand(quote && quote.canonical_payload.length === 300);
  const b = quote.canonical_payload as Buffer;
  const ctx = quote.context;
  const current = await journal.prepare(
    { ...scope, expectedDbRevision: leased.dbRevision },
    leg.ordinal,
    worker,
    {
      routeHash: b.subarray(139, 171).toString("hex"),
      instructionHash: b.subarray(171, 203).toString("hex"),
      authorizationHash: quote.payload_hash.toString("hex"),
      inputMint: ctx.inputMint,
      outputMint: ctx.outputMint,
      source: ctx.source,
      destination: ctx.destination,
      inputAmount: b.readBigUInt64LE(113),
      minimumOutput: b.readBigUInt64LE(131),
      quoteExpiresAt: quote.expires_at,
      expectedEffects: quote.evidence.effectManifest,
    },
  );
  return {
    kind: "ROLE_REVIEWS_REQUIRED" as const,
    roles: ["governance", "keeper"] as const,
    worker,
    ordinal: leg.ordinal,
    dbRevision: current.dbRevision.toString(),
    chainRevision: current.chainRevision.toString(),
    ...prepared,
  };
}
/** Reconciliation is explicit and read-only on-chain. It never reconstructs or
 * resends an uncertain packet. Missing/disagreeing effects cannot promote. */
export async function reconcileProductionSettlementLeg(
  pool: Pool,
  scope: Scope,
  ordinal: number,
) {
  requireOpenProductionPolicy();
  return new VerifiedSettlementJournal(pool).reconcile(
    scope,
    ordinal,
    productionQuorumConnection(),
    "MAINNET_REVIEWED",
    C3_MAINNET.genesisHash,
  );
}
