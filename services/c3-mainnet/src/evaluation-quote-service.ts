/** Hosted TEST settlement: real finalized Devnet context -> existing PG quote
 * journals -> existing durable signer journal. No transaction signing/send.
 * Kept internal until the keeper/effect/provisioning gate has passed. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import type { Pool } from "pg";
import { EvaluationOwnerService } from "./evaluation-owner-service.ts";
import { EVALUATION, evaluationJournalPool } from "./evaluation-scope.ts";
import {
  evaluationSettlementAddresses,
  verifiedEvaluationLegContext,
} from "./evaluation-leg-context.ts";
import { evaluationTestRoute } from "./evaluation-route.ts";
import {
  OpenSigningJournal,
  type DurableQuoteSigningProvider,
} from "./open-signing-journal.ts";
import type { OpenAccount } from "./open-state-semantics.ts";
import {
  evaluationAuthorizeInstruction,
  evaluationExecuteInstruction,
  compileEvaluationServicePacket,
} from "./evaluation-settlement-client.ts";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_QUOTE_" + code);
};
export class EvaluationQuoteService {
  private readonly pool: Pool;
  private readonly owner: EvaluationOwnerService;
  private readonly rpc = new Connection("https://api.devnet.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
  constructor(pool: Pool, idl: Idl) {
    this.pool = pool;
    this.owner = new EvaluationOwnerService(pool, idl);
  }
  private async capture(token: string) {
    const ctx = await this.owner.context(token);
    const row = (
      await this.pool.query("SELECT * FROM c3_eval.intents WHERE wallet=$1", [
        ctx.proof.wallet,
      ])
    ).rows[0];
    check(
      row && ["buying", "selling"].includes(row.state),
      "DURABLE_PLAN_NOT_READY",
    );
    const direction = row.state === "buying" ? 1 : 2;
    const addresses = evaluationSettlementAddresses(ctx.client, direction);
    const snapshot = await this.rpc.getMultipleAccountsInfoAndContext(
      addresses.map((k) => new PublicKey(k)),
      { commitment: "finalized", minContextSlot: ctx.slot },
    );
    const clock = await this.rpc.getBlockTime(snapshot.context.slot);
    check(
      clock &&
        Math.abs(Date.now() / 1000 - clock) < 45 &&
        Number.isSafeInteger(clock),
      "FRESH_FINALIZED_CLOCK",
    );
    const accounts = new Map<string, OpenAccount | null>(
      addresses.map((address, i) => {
        const raw = snapshot.value[i];
        return [
          address,
          raw
            ? {
                owner: raw.owner.toBase58(),
                executable: raw.executable,
                lamports: raw.lamports,
                data: [raw.data.toString("base64"), "base64"],
              }
            : null,
        ];
      }),
    );
    const trusted = verifiedEvaluationLegContext(
      ctx.client,
      {
        genesis: await this.rpc.getGenesisHash(),
        slot: BigInt(snapshot.context.slot),
        chainTime: BigInt(clock!),
        accounts,
      },
      direction,
      BigInt(row.chain_revision),
    );
    const ordinal = trusted.leg + (direction === 1 ? 0 : 3);
    const priorLegs = (
      await this.pool.query(
        "SELECT ordinal,state FROM c3_eval.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 ORDER BY ordinal",
        [row.intent_id, direction === 1 ? 0 : 3, direction === 1 ? 2 : 5],
      )
    ).rows;
    check(
      priorLegs.length === 3 &&
        priorLegs.every(
          (l, i) =>
            l.ordinal === i + (direction === 1 ? 0 : 3) &&
            (i < trusted.leg
              ? l.state === "confirmed"
              : l.state === "pending" ||
                (i === trusted.leg && l.state === "prepared")),
        ),
      "DURABLE_PROGRESS",
    );
    return { ...ctx, row, trusted, ordinal };
  }
  /** Caller supplies a session only; never an amount, output, mint or policy. */
  async prepare(token: string) {
    const ctx = await this.capture(token);
    const route = evaluationTestRoute(ctx.client, ctx.trusted, randomBytes(32));
    const blockhash = await this.rpc.getLatestBlockhash("finalized");
    const measurement = compileEvaluationServicePacket(
      [evaluationExecuteInstruction(ctx.client, route)],
      "keeper",
      blockhash.blockhash,
    );
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const current = (
        await c.query(
          "SELECT *,clock_timestamp() AS now FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [ctx.row.intent_id],
        )
      ).rows[0];
      check(
        current &&
          current.db_revision === ctx.row.db_revision &&
          current.chain_revision === ctx.row.chain_revision &&
          current.state === ctx.row.state &&
          current.expires_at > current.now,
        "CAS_OR_EXPIRY",
      );
      check(
        !(
          await c.query(
            "SELECT 1 FROM c3_eval.owner_requests r LEFT JOIN c3_eval.owner_effect_receipts e USING(request_id) LEFT JOIN c3_eval.owner_request_outcomes o USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL",
            [current.intent_id],
          )
        ).rowCount,
        "OWNER_REQUEST_PENDING",
      );
      const previous = (
        await c.query(
          "SELECT quote_id,payload_hash,expires_at,state FROM c3_eval.quote_authorizations WHERE intent_id=$1 AND ordinal=$2 AND state IN ('prepared','signed','consumed')",
          [current.intent_id, ctx.ordinal],
        )
      ).rows[0];
      if (previous) {
        check(
          previous.expires_at > current.now && previous.state !== "consumed",
          "PREVIOUS_QUOTE_RECONCILE_OR_RENEW",
        );
        await c.query("COMMIT");
        return {
          quoteId: previous.quote_id.toString("hex"),
          payloadHash: previous.payload_hash.toString("hex"),
          reused: true,
        };
      }
      const trusted = ctx.trusted;
      const storedContext = {
        plan: trusted.plan,
        planRevision: trusted.revision.toString(),
        intent: trusted.intent,
        wallet: ctx.proof.wallet,
        direction: trusted.direction,
        leg: trusted.leg,
        created: trusted.created.toString(),
        expires: trusted.expires.toString(),
        slot: trusted.slot.toString(),
        registryRevision: trusted.registryRevision.toString(),
        registryHash: Buffer.from(trusted.registryHash).toString("hex"),
        registryExpiresSlot: trusted.registryExpiresSlot.toString(),
        policyRevision: trusted.policyRevision.toString(),
        inputBudget: trusted.inputBudget.toString(),
        minimumOutput: trusted.minimumOutput.toString(),
      };
      const contextHash = Buffer.from(route.seal.contextHash);
      await c.query(
        `INSERT INTO c3_eval.leg_context_verifications(verification_id,intent_id,ordinal,intent_revision,context_hash,policy_hash,evidence_hash,genesis_hash,scope,finalized_slot,context,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ISOLATED_VERIFIED',$9,$10,$11)`,
        [
          randomUUID(),
          current.intent_id,
          ctx.ordinal,
          current.db_revision,
          contextHash,
          trusted.registryHash,
          hash(JSON.stringify(storedContext)),
          EVALUATION.genesis,
          trusted.slot.toString(),
          storedContext,
          {
            simulatedAssets: true,
            monetaryValue: false,
            router: EVALUATION.router,
            snapshotSlot: trusted.slot.toString(),
          },
        ],
      );
      await c.query(
        `INSERT INTO c3_eval.quote_authorizations(quote_id,nonce,intent_id,ordinal,intent_revision,canonical_payload,payload_hash,evidence,authority,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10))`,
        [
          route.seal.quoteId,
          route.seal.nonce,
          current.intent_id,
          ctx.ordinal,
          current.db_revision,
          route.payload,
          hash(route.payload),
          {
            simulatedAssets: true,
            inputAmount: route.input.toString(),
            testOutput: route.output.toString(),
            quotedOutput: route.seal.quotedOutput.toString(),
            minimumOutput: route.seal.minimumOutput.toString(),
            slippageBps: 100,
            unsignedExecutionBytes: measurement.bytes,
          },
          new PublicKey(EVALUATION.quotes).toBuffer(),
          route.seal.expiresAt.toString(),
        ],
      );
      await c.query("COMMIT");
      return {
        quoteId: Buffer.from(route.seal.quoteId).toString("hex"),
        payloadHash: hash(route.payload).toString("hex"),
        reused: false,
      };
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  /** Provider is server-only and pinned to the evaluation quote identity. It is
   * never accepted in HTTP and cannot sign a wallet/transaction message. */
  async signStored(
    token: string,
    quoteId: string,
    provider: DurableQuoteSigningProvider,
  ) {
    check(/^[a-f0-9]{64}$/.test(quoteId), "ID");
    const ctx = await this.capture(token);
    const q = (
      await this.pool.query(
        `SELECT q.*,v.context FROM c3_eval.quote_authorizations q JOIN c3_eval.leg_context_verifications v USING(intent_id,ordinal,intent_revision)
      WHERE q.quote_id=$1 AND q.intent_id=$2 AND q.ordinal=$3 AND q.intent_revision=$4`,
        [
          Buffer.from(quoteId, "hex"),
          ctx.row.intent_id,
          ctx.ordinal,
          ctx.row.db_revision,
        ],
      )
    ).rows[0];
    check(
      q &&
        ["prepared", "signed"].includes(q.state) &&
        hash(q.canonical_payload).equals(q.payload_hash) &&
        q.authority.equals(new PublicKey(EVALUATION.quotes).toBuffer()),
      "STORED_RECORD",
    );
    check(q.canonical_payload.length === 300, "STORED_PAYLOAD_SIZE");
    // Fixed Borsh offsets from the existing canonical 300-byte codec. The whole
    // payload is subsequently reconstructed/compared, not trusted after parsing.
    const seal = {
      nonce: q.canonical_payload.subarray(81, 113) as Buffer,
      builderTimestamp: q.canonical_payload.readBigInt64LE(268) as bigint,
      builderSlot: q.canonical_payload.readBigUInt64LE(276) as bigint,
      expiresAt: q.canonical_payload.readBigInt64LE(284) as bigint,
      expiresSlot: q.canonical_payload.readBigUInt64LE(292) as bigint,
    };
    check(
      seal.expiresAt > ctx.trusted.created &&
        seal.expiresSlot > ctx.trusted.slot &&
        seal.builderTimestamp <= ctx.trusted.created &&
        ctx.trusted.created - seal.builderTimestamp <= 30n &&
        seal.expiresAt <= ctx.trusted.expires &&
        seal.expiresSlot <= ctx.trusted.registryExpiresSlot,
      "EXPIRED_RECORD",
    );
    const route = evaluationTestRoute(
      ctx.client,
      {
        ...ctx.trusted,
        created: seal.builderTimestamp,
        slot: seal.builderSlot,
      },
      seal.nonce,
    );
    check(
      route.payload.equals(q.canonical_payload),
      "CURRENT_CONTEXT_OR_PAYLOAD_TAMPERED",
    );
    const signature = await new OpenSigningJournal(
      evaluationJournalPool(this.pool),
      provider,
    ).obtain(Buffer.from(quoteId, "hex"), q.canonical_payload, q.authority);
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const current = (
        await c.query(
          "SELECT *,clock_timestamp() AS now FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [ctx.row.intent_id],
        )
      ).rows[0];
      check(
        current &&
          current.db_revision === ctx.row.db_revision &&
          current.chain_revision === ctx.row.chain_revision &&
          current.state === ctx.row.state,
        "POST_SIGN_CAS",
      );
      const record = (
        await c.query(
          "SELECT *,clock_timestamp() AS now FROM c3_eval.quote_authorizations WHERE quote_id=$1 FOR UPDATE",
          [q.quote_id],
        )
      ).rows[0];
      check(
        record &&
          record.expires_at > record.now &&
          record.canonical_payload.equals(q.canonical_payload),
        "POST_SIGN_EXPIRED",
      );
      if (record.state === "signed")
        check(record.signature.equals(signature), "SIGNATURE_CONFLICT");
      else {
        check(record.state === "prepared", "SIGNING_STATE");
        await c.query(
          "UPDATE c3_eval.quote_authorizations SET state='signed',signature=$2,revision=revision+1 WHERE quote_id=$1",
          [q.quote_id, signature],
        );
      }
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
    // Returned messages remain unsigned. Expiry is checked again by the future
    // pre-send journal. Signing a quote is NOT a swap or a confirmed position.
    return {
      quoteId,
      cluster: EVALUATION.cluster,
      simulatedAssets: true,
      authorizeInstructions: evaluationAuthorizeInstruction(
        ctx.client,
        route,
        signature,
      ),
      executeInstruction: evaluationExecuteInstruction(ctx.client, route),
      // Server-internal execution context, never accepted from an HTTP body.
      route,
      intentId: String(ctx.row.intent_id),
      dbRevision: String(ctx.row.db_revision),
      ordinal: ctx.ordinal,
    };
  }
}
