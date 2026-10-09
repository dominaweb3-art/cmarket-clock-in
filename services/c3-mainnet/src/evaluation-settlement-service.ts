/** SHARED. Hosted Devnet test-router orchestration over the existing intent.
 * One bounded operation per request; final effects precede economic promotion.
 * No wallet key, local harness, real asset valuation or Mainnet capability. */
import { createHash, randomUUID } from "node:crypto";
import type { Idl } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import type { Pool } from "pg";
import { EvaluationOwnerService } from "./evaluation-owner-service.ts";
import { EvaluationQuoteService } from "./evaluation-quote-service.ts";
import { EvaluationClient } from "./evaluation-client.ts";
import { EVALUATION } from "./evaluation-scope.ts";
import { accountBytes, type OpenAccount } from "./open-state-semantics.ts";
import {
  evaluationCreatePlan,
  evaluationRecordInstruction,
  compileEvaluationServicePacket,
} from "./evaluation-settlement-client.ts";
import {
  EvaluationServiceJournal,
  evaluationOperationId,
  type EvaluationServicePurpose,
  type EvaluationPacketSigner,
} from "./evaluation-service-journal.ts";
import {
  verifyEvaluationSwapEffects,
  type EvaluationSwapExpectation,
} from "./evaluation-swap-effects.ts";
import type { DurableQuoteSigningProvider } from "./open-signing-journal.ts";
import { decodeBase58 } from "./solana.ts";
import { evaluationCanonical as canonicalize } from "./evaluation-canonical.ts";
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_SETTLEMENT_" + code);
};
type Context = Readonly<{
  kind: "plan" | "authorize" | "execute" | "record";
  direction: 1 | 2;
  plan: string;
  ordinal: number;
  quoteId?: string;
  authorization?: string;
  quoteReceipt?: string;
  expiresAt?: string;
  expiresSlot?: string;
  authorizationOperation?: string;
  swap?: EvaluationSwapExpectation;
}>;
type Providers = Readonly<{
  governance: EvaluationPacketSigner;
  keeper: EvaluationPacketSigner;
  quotes: DurableQuoteSigningProvider;
}>;
export class EvaluationSettlementService {
  private readonly pool: Pool;
  private readonly owner: EvaluationOwnerService;
  private readonly quotes: EvaluationQuoteService;
  private readonly providers: Providers;
  private readonly journal: EvaluationServiceJournal;
  private readonly rpc = new Connection("https://api.devnet.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
  constructor(pool: Pool, idl: Idl, providers: Providers) {
    check(
      providers.governance.publicKey === EVALUATION.governance &&
        providers.keeper.publicKey === EVALUATION.keeper &&
        new PublicKey(providers.quotes.publicKey).toBase58() ===
          EVALUATION.quotes,
      "IDENTITIES",
    );
    this.pool = pool;
    this.owner = new EvaluationOwnerService(pool, idl);
    this.quotes = new EvaluationQuoteService(pool, idl);
    this.providers = providers;
    this.journal = new EvaluationServiceJournal(pool);
  }
  private async account(
    client: EvaluationClient,
    address: string,
    name: string,
    minSlot?: number,
  ) {
    const response = await this.rpc.getAccountInfoAndContext(
      new PublicKey(address),
      {
        commitment: "finalized",
        ...(minSlot ? { minContextSlot: minSlot } : {}),
      },
    );
    const r = response.value;
    check(r, "ACCOUNT_MISSING");
    const raw: OpenAccount = {
      owner: r!.owner.toBase58(),
      executable: r!.executable,
      data: [r!.data.toString("base64"), "base64"],
    };
    const bytes = accountBytes(
      raw,
      EVALUATION.program,
      client.coder.accounts.size(name),
      name,
    );
    return {
      decoded: client.coder.accounts.decode(name, bytes) as Record<
        string,
        unknown
      >,
      bytes,
      slot: response.context.slot,
    };
  }
  private async reserve(
    client: EvaluationClient,
    row: Record<string, unknown>,
    context: Context,
    instructions: readonly TransactionInstruction[],
    generation: string,
  ) {
    return (
      await this.reserveBatch(client, row, [
        { context, instructions, generation },
      ])
    )[0]!;
  }
  /** Authorization and execution are one durable reservation. A process crash
   * cannot leave an authorized leg without its exact execution message. */
  private async reserveBatch(
    client: EvaluationClient,
    row: Record<string, unknown>,
    items: readonly {
      context: Context;
      instructions: readonly TransactionInstruction[];
      generation: string;
    }[],
  ) {
    check(items.length > 0 && items.length <= 2, "RESERVATION_COUNT");
    const scope = String(row.intent_id);
    const latest = await this.rpc.getLatestBlockhash("finalized");
    const entries = items.map(({ context, instructions, generation }) => ({
      context,
      id: evaluationOperationId(scope, context.kind, generation),
      packet: compileEvaluationServicePacket(
        instructions,
        context.kind === "authorize" ? "governance" : "keeper",
        latest.blockhash,
      ),
    }));
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const current = (
        await c.query(
          "SELECT * FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [scope],
        )
      ).rows[0];
      check(
        current &&
          current.wallet === client.config.wallet &&
          String(current.db_revision) === String(row.db_revision) &&
          String(current.chain_revision) === String(row.chain_revision) &&
          current.state === row.state,
        "RESERVATION_CAS",
      );
      check(
        !(
          await c.query(
            "SELECT 1 FROM c3_eval.owner_requests r LEFT JOIN c3_eval.owner_effect_receipts e USING(request_id) LEFT JOIN c3_eval.owner_request_outcomes o USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL",
            [scope],
          )
        ).rowCount,
        "OWNER_REQUEST_PENDING",
      );
      for (const { id, context, packet } of entries) {
        const existing = (
          await c.query(
            "SELECT p.scope,p.purpose,c.context_hash,c.db_revision,c.chain_revision FROM c3_eval.service_packets p JOIN c3_eval.service_contexts c USING(operation_id) WHERE operation_id=$1",
            [id],
          )
        ).rows[0];
        if (existing) {
          check(
            existing.scope === scope &&
              existing.purpose === context.kind &&
              existing.context_hash.equals(hash(canonicalize(context))) &&
              String(existing.db_revision) === String(row.db_revision) &&
              String(existing.chain_revision) === String(row.chain_revision),
            "RESERVATION_CONFLICT",
          );
          continue; // Keep original blockhash and exact packet; never overwrite.
        }
        await c.query(
          "INSERT INTO c3_eval.service_packets(operation_id,scope,purpose,signer,message_hash,unsigned_packet,last_valid_height) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(operation_id) DO NOTHING",
          [
            id,
            scope,
            context.kind as EvaluationServicePurpose,
            packet.signer,
            packet.messageHash,
            packet.packet,
            latest.lastValidBlockHeight,
          ],
        );
        await c.query(
          "INSERT INTO c3_eval.service_contexts(operation_id,intent_id,db_revision,chain_revision,context,context_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(operation_id) DO NOTHING",
          [
            id,
            scope,
            row.db_revision,
            row.chain_revision,
            context,
            hash(canonicalize(context)),
          ],
        );
      }
      await c.query("COMMIT");
      return entries.map((entry) => entry.id);
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  private async verifyControlEffects(
    client: EvaluationClient,
    tx: VersionedTransactionResponse,
    context: Context,
  ) {
    const meta = tx.meta,
      msg = tx.transaction.message;
    check(
      meta &&
        meta.err === null &&
        meta.innerInstructions &&
        meta.preTokenBalances &&
        meta.postTokenBalances &&
        msg.version === 0 &&
        msg.addressTableLookups.length === 0,
      "CONTROL_EVIDENCE",
    );
    const index = (n: number) => {
      const k = msg.staticAccountKeys[n];
      check(k, "ACCOUNT_INDEX");
      return k!.toBase58();
    };
    const groups = meta!.innerInstructions!.filter(
      (g) => g.instructions.length,
    );
    const creates =
      context.kind === "plan"
        ? [
            {
              address: context.plan,
              size: client.coder.accounts.size("SettlementPlan"),
            },
          ]
        : context.kind === "authorize"
          ? [
              {
                address: context.authorization!,
                size: client.coder.accounts.size("SwapLegAuthorization"),
              },
              {
                address: context.quoteReceipt!,
                size: client.coder.accounts.size("QuoteReceipt"),
              },
            ]
          : [];
    check(groups.length === (creates.length ? 1 : 0), "CONTROL_CPI_COUNT");
    let rent = 0n;
    const rents = new Map<string, bigint>();
    if (creates.length) {
      const g = groups[0]!;
      check(
        g.index === (context.kind === "authorize" ? 1 : 0) &&
          g.instructions.length === creates.length,
        "CONTROL_CPI_COUNT",
      );
      g.instructions.forEach((i, n) => {
        const data = Buffer.from(decodeBase58(i.data)),
          expected = creates[n]!;
        check(
          index(i.programIdIndex) === SystemProgram.programId.toBase58() &&
            i.accounts.length === 2 &&
            index(i.accounts[0]!) === index(0) &&
            index(i.accounts[1]!) === expected.address &&
            data.length === 52 &&
            data.readUInt32LE(0) === 0 &&
            data.readBigUInt64LE(12) === BigInt(expected.size) &&
            new PublicKey(data.subarray(20)).equals(client.program),
          "CONTROL_HOSTILE_CPI",
        );
        const amount = data.readBigUInt64LE(4);
        check(amount > 0n, "RENT");
        rent += amount;
        rents.set(expected.address, amount);
      });
    }
    const pre = meta!.preTokenBalances!,
      post = meta!.postTokenBalances!;
    check(
      pre.length === post.length &&
        new Set(pre.map((b) => b.accountIndex)).size === pre.length &&
        new Set(post.map((b) => b.accountIndex)).size === post.length,
      "CONTROL_TOKEN_SET",
    );
    for (const b of pre) {
      const a = post.find((v) => v.accountIndex === b.accountIndex);
      check(
        a &&
          b.owner &&
          b.programId &&
          a.owner === b.owner &&
          a.programId === b.programId &&
          a.mint === b.mint &&
          a.uiTokenAmount.amount === b.uiTokenAmount.amount &&
          a.uiTokenAmount.decimals === b.uiTokenAmount.decimals,
        "CONTROL_TOKEN_DELTA",
      );
    }
    check(
      meta!.preBalances.length === msg.staticAccountKeys.length &&
        meta!.postBalances.length === msg.staticAccountKeys.length &&
        Number.isSafeInteger(meta!.fee) &&
        meta!.fee >= 0 &&
        meta!.fee <= 10000,
      "CONTROL_LAMPORTS",
    );
    for (let i = 0; i < meta!.preBalances.length; i++) {
      const before = meta!.preBalances[i]!,
        after = meta!.postBalances[i]!;
      check(
        Number.isSafeInteger(before) &&
          before >= 0 &&
          Number.isSafeInteger(after) &&
          after >= 0,
        "CONTROL_LAMPORTS",
      );
      const created = creates.some((a) => a.address === index(i));
      check(
        created
          ? before === 0 && BigInt(after) === rents.get(index(i))
          : BigInt(after) - BigInt(before) ===
              (i === 0 ? -BigInt(meta!.fee) - rent : 0n),
        "CONTROL_SOL_DELTA",
      );
    }
    if (context.kind === "authorize") {
      const auth = await this.account(
          client,
          context.authorization!,
          "SwapLegAuthorization",
          tx.slot,
        ),
        receipt = await this.account(
          client,
          context.quoteReceipt!,
          "QuoteReceipt",
          tx.slot,
        );
      check(
        auth.decoded.consumed === false &&
          receipt.decoded.consumed === false &&
          String(auth.decoded.plan) === context.plan &&
          String(auth.decoded.quote_receipt) === context.quoteReceipt,
        "AUTHORIZATION_STATE",
      );
    }
    return hash(
      JSON.stringify({
        scope: "DEVNET_TEST_CONTROL",
        message: Buffer.from(msg.serialize()).toString("hex"),
        slot: tx.slot,
        pre,
        post,
        inner: groups,
      }),
    );
  }
  private async promote(
    client: EvaluationClient,
    op: Record<string, unknown>,
    context: Context,
    evidenceHash: Buffer,
    slot: number,
  ) {
    if (context.kind === "authorize") return;
    const plan = await this.account(
        client,
        context.plan,
        "SettlementPlan",
        slot,
      ),
      p = plan.decoded;
    check(
      String(p.wallet) === client.config.wallet &&
        String(p.vault) === String(client.vault) &&
        String(p.share_mint) === client.config.shareMint &&
        p.direction === context.direction &&
        String(p.config_version) === "1" &&
        String(p.router_program) === EVALUATION.router,
      "PROMOTION_PLAN",
    );
    const ctx = await this.owner.context(String(op.sessionToken), slot);
    const revision = BigInt(String(op.chain_revision));
    if (context.kind === "execute") {
      const leg = context.ordinal % 3,
        swap = context.swap!;
      check(
        BigInt(String(p.revision)) === revision + 1n &&
          Number(p.executed_bitmap) === (1 << (leg + 1)) - 1 &&
          Array.isArray(p.actual_inputs) &&
          Array.isArray(p.actual_outputs) &&
          String(p.actual_inputs[leg]) === swap.input &&
          String(p.actual_outputs[leg]) === swap.output,
        "SWAP_POST_PLAN",
      );
    } else if (context.kind === "plan")
      check(
        Number(p.executed_bitmap) === 0 && String(p.revision) === "0",
        "INITIAL_PLAN",
      );
    else
      check(
        Number(p.executed_bitmap) === 7 &&
          (context.direction === 1
            ? ctx.position.depositStatus === 3
            : ctx.position.redemptionStatus === 4 &&
              ctx.position.claimable > 0n),
        "RECORD_EFFECTS",
      );
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const current = (
        await c.query(
          "SELECT * FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [op.intent_id],
        )
      ).rows[0];
      if (
        (
          await c.query(
            "SELECT 1 FROM c3_eval.events WHERE idempotency_hash=$1",
            [op.operation_id],
          )
        ).rowCount
      ) {
        await c.query("COMMIT");
        return;
      }
      check(
        current &&
          String(current.db_revision) === String(op.db_revision) &&
          String(current.chain_revision) === String(op.chain_revision),
        "PROMOTION_CAS",
      );
      let state = current.state;
      if (context.kind === "plan") {
        check(
          state ===
            (context.direction === 1 ? "funded" : "redemption_requested"),
          "PLAN_STAGE",
        );
        state = context.direction === 1 ? "buying" : "selling";
      } else
        check(
          state === (context.direction === 1 ? "buying" : "selling"),
          "SETTLEMENT_STAGE",
        );
      if (context.kind === "execute") {
        const swap = context.swap!,
          q = (
            await c.query(
              "SELECT * FROM c3_eval.quote_authorizations WHERE quote_id=$1 FOR UPDATE",
              [Buffer.from(context.quoteId!, "hex")],
            )
          ).rows[0];
        check(
          q &&
            q.state === "signed" &&
            q.intent_id === op.intent_id &&
            q.ordinal === context.ordinal &&
            String(q.intent_revision) === String(op.db_revision),
          "QUOTE_PROMOTION",
        );
        const result = await c.query(
          `UPDATE c3_eval.legs SET state='confirmed',chain_revision=$3,route_hash=$4,instruction_hash=$5,authorization_hash=$6,input_mint=$7,output_mint=$8,source_account=$9,destination_account=$10,input_amount=$11,minimum_output=$12,quote_expires_at=$13,submitted_signature=$14,submitted_at=clock_timestamp(),evidence_hash=$15,expected_effects=$16,observed_effects=$17 WHERE intent_id=$1 AND ordinal=$2 AND state IN ('pending','prepared') AND submitted_signature IS NULL`,
          [
            op.intent_id,
            context.ordinal,
            String(p.revision),
            Buffer.from(q.canonical_payload).subarray(139, 171).toString("hex"),
            Buffer.from(q.canonical_payload).subarray(171, 203).toString("hex"),
            q.payload_hash.toString("hex"),
            swap.inputMint,
            swap.outputMint,
            swap.source,
            swap.destination,
            swap.input,
            String(q.evidence.minimumOutput),
            q.expires_at,
            op.signature,
            evidenceHash.toString("hex"),
            swap,
            {
              scope: "DEVNET_TEST_ROUTER",
              input: swap.input,
              output: swap.output,
              slot,
            },
          ],
        );
        check(result.rowCount === 1, "LEG_CAS");
        await c.query(
          "UPDATE c3_eval.quote_authorizations SET state='consumed',revision=revision+1 WHERE quote_id=$1",
          [q.quote_id],
        );
      }
      if (context.kind === "record") {
        const first = context.direction === 1 ? 0 : 3;
        check(
          (
            await c.query(
              "SELECT 1 FROM c3_eval.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 AND state='confirmed'",
              [op.intent_id, first, first + 2],
            )
          ).rowCount === 3,
          "UNCONFIRMED_LEGS",
        );
        if (context.direction === 2) state = "claimable";
      }
      const next = BigInt(current.db_revision) + 1n;
      await c.query(
        "UPDATE c3_eval.intents SET state=$2,db_revision=$3,chain_revision=$4,updated_at=clock_timestamp() WHERE intent_id=$1",
        [op.intent_id, state, String(next), String(p.revision)],
      );
      await c.query(
        "INSERT INTO c3_eval.events(event_id,intent_id,idempotency_hash,db_revision,state,ordinal,evidence_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          op.intent_id,
          op.operation_id,
          String(next),
          state,
          context.kind === "execute" ? context.ordinal : null,
          evidenceHash.toString("hex"),
        ],
      );
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  private async process(token: string, client: EvaluationClient, id: string) {
    const op = (
      await this.pool.query(
        "SELECT p.*,c.intent_id,c.db_revision,c.chain_revision,c.context,c.context_hash,s.signature FROM c3_eval.service_packets p JOIN c3_eval.service_contexts c USING(operation_id) LEFT JOIN c3_eval.service_submissions s USING(operation_id) WHERE operation_id=$1",
        [id],
      )
    ).rows[0];
    check(
      op && hash(canonicalize(op.context)).equals(op.context_hash),
      "STORED_CONTEXT",
    );
    const row = (
      await this.pool.query(
        "SELECT * FROM c3_eval.intents WHERE intent_id=$1",
        [op.intent_id],
      )
    ).rows[0];
    check(row?.wallet === client.config.wallet, "WALLET");
    const context = op.context as Context;
    const receipt = (
      await this.pool.query(
        "SELECT * FROM c3_eval.service_receipts WHERE operation_id=$1",
        [id],
      )
    ).rows[0];
    if (!receipt && !op.signature) {
      check(
        String(row.db_revision) === String(op.db_revision) &&
          String(row.chain_revision) === String(op.chain_revision),
        "SEND_CAS",
      );
      if (context.kind === "authorize") {
        check(
          (
            await this.pool.query(
              "SELECT 1 FROM c3_eval.service_contexts WHERE intent_id=$1 AND context->>'authorizationOperation'=$2 AND context->>'kind'='execute'",
              [op.intent_id, id],
            )
          ).rowCount === 1,
          "EXECUTION_RESERVATION_MISSING",
        );
        const slot = await this.rpc.getSlot("finalized"),
          clock = await this.rpc.getBlockTime(slot);
        check(
          clock &&
            BigInt(clock) < BigInt(context.expiresAt!) &&
            BigInt(slot) < BigInt(context.expiresSlot!),
          "QUOTE_EXPIRED_RENEW_REQUIRED",
        );
      }
      if (context.kind === "execute") {
        const dependency = (
          await this.pool.query(
            "SELECT outcome FROM c3_eval.service_receipts WHERE operation_id=$1",
            [context.authorizationOperation],
          )
        ).rows[0];
        if (!dependency)
          return {
            stage: "authorization_pending",
            automaticallyResubmitted: false,
          };
        check(
          dependency.outcome === "effects_verified",
          "AUTHORIZATION_FAILED",
        );
        const slot = await this.rpc.getSlot("finalized"),
          clock = await this.rpc.getBlockTime(slot);
        check(
          clock &&
            BigInt(clock) < BigInt(context.expiresAt!) &&
            BigInt(slot) < BigInt(context.expiresSlot!),
          "QUOTE_EXPIRED_RENEW_REQUIRED",
        );
        const a = (
          await this.account(
            client,
            context.authorization!,
            "SwapLegAuthorization",
          )
        ).decoded;
        check(
          a.consumed === false &&
            String(a.plan) === context.plan &&
            String(a.expected_revision) === String(op.chain_revision) &&
            String(a.source) === context.swap!.source &&
            String(a.destination) === context.swap!.destination &&
            String(a.input_amount) === context.swap!.input &&
            Buffer.from(a.quote_payload_hash as number[]).equals(
              (
                await this.pool.query(
                  "SELECT payload_hash FROM c3_eval.quote_authorizations WHERE quote_id=$1",
                  [Buffer.from(context.quoteId!, "hex")],
                )
              ).rows[0].payload_hash,
            ),
          "ACTIVE_AUTHORIZATION",
        );
      }
    }
    if (!receipt) {
      const provider =
        context.kind === "authorize"
          ? this.providers.governance
          : this.providers.keeper;
      const dispatched = await this.journal.dispatch(
        {
          operationId: id,
          scope: op.scope,
          purpose: op.purpose,
          packet: op.unsigned_packet,
          lastValidBlockHeight: Number(op.last_valid_height),
        },
        provider,
      );
      op.signature = dispatched.signature;
    }
    if (!receipt) {
      const result = await this.journal.reconcile(id, async (tx) =>
        context.kind === "execute"
          ? verifyEvaluationSwapEffects(tx, context.swap!).evidenceHash
          : this.verifyControlEffects(client, tx, context),
      );
      if (result.state !== "effects_verified")
        return {
          stage: result.state,
          signature: op.signature,
          automaticallyResubmitted: false,
        };
    }
    const r =
      receipt ??
      (
        await this.pool.query(
          "SELECT * FROM c3_eval.service_receipts WHERE operation_id=$1",
          [id],
        )
      ).rows[0];
    check(r.outcome === "effects_verified", "OPERATION_FAILED");
    await this.promote(
      client,
      { ...op, sessionToken: token },
      context,
      r.evidence_hash,
      Number(r.finalized_slot),
    );
    return {
      stage: context.kind + "_effects_verified",
      signature: op.signature,
      automaticallyResubmitted: false,
    };
  }
  async advance(token: string) {
    check(EVALUATION.lifecycleReady, "RUNTIME_NOT_RELEASED");
    const ctx = await this.owner.context(token);
    const row = (
      await this.pool.query("SELECT * FROM c3_eval.intents WHERE wallet=$1", [
        ctx.proof.wallet,
      ])
    ).rows[0];
    check(row, "INTENT");
    // Process original signatures/messages before building a new quote.
    const pending = (
      await this.pool.query(
        `SELECT c.operation_id FROM c3_eval.service_contexts c JOIN c3_eval.service_packets p USING(operation_id) LEFT JOIN c3_eval.service_receipts r USING(operation_id) WHERE c.intent_id=$1 AND NOT EXISTS(SELECT 1 FROM c3_eval.service_retirements t WHERE t.operation_id=c.operation_id) AND (r.operation_id IS NULL OR (p.purpose<>'authorize' AND NOT EXISTS(SELECT 1 FROM c3_eval.events e WHERE e.idempotency_hash=c.operation_id))) ORDER BY c.created_at LIMIT 1`,
        [row.intent_id],
      )
    ).rows[0];
    if (pending) return this.process(token, ctx.client, pending.operation_id);
    const direction: 1 | 2 = ["funded", "buying"].includes(row.state) ? 1 : 2;
    const intent = ctx.client.intent(
        direction === 1 ? "deposit" : "redemption",
      ),
      plan = ctx.client.pda("c3-plan-v1", intent);
    if (["funded", "redemption_requested"].includes(row.state)) {
      const clock = await this.rpc.getBlockTime(ctx.slot);
      check(clock, "CLOCK");
      const deposit = ctx.client.coder.accounts.decode(
        "DepositIntent",
        accountBytes(
          ctx.accounts.get(ctx.client.intent("deposit").toBase58()),
          EVALUATION.program,
          undefined,
          "DepositIntent",
        ),
      ) as Record<string, unknown>;
      const acquired = ["btc", "eth", "wsol"].map(
        (n) =>
          BigInt(String(deposit[n + "_after"])) -
          BigInt(String(deposit[n + "_before"])),
      );
      const build = evaluationCreatePlan(
        ctx.client,
        direction,
        BigInt(clock!),
        direction === 2 ? acquired : undefined,
      );
      const context: Context = {
        kind: "plan",
        direction,
        plan: String(plan),
        ordinal: direction === 1 ? 0 : 3,
      };
      return this.process(
        token,
        ctx.client,
        await this.reserve(
          ctx.client,
          row,
          context,
          [build.instruction],
          "direction:" + direction,
        ),
      );
    }
    if (!["buying", "selling"].includes(row.state))
      return {
        stage: row.state,
        needsOwnerAction:
          row.state === "active"
            ? "request_redemption"
            : row.state === "claimable"
              ? "claim"
              : "deposit",
      };
    const first = direction === 1 ? 0 : 3,
      confirmed = (
        await this.pool.query(
          "SELECT 1 FROM c3_eval.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 AND state='confirmed'",
          [row.intent_id, first, first + 2],
        )
      ).rowCount;
    if (confirmed === 3) {
      if (direction === 1 && ctx.position.depositStatus === 3)
        return { stage: "buying", needsOwnerAction: "issue_shares" };
      const context: Context = {
        kind: "record",
        direction,
        plan: String(plan),
        ordinal: first + 2,
      };
      return this.process(
        token,
        ctx.client,
        await this.reserve(
          ctx.client,
          row,
          context,
          [evaluationRecordInstruction(ctx.client, direction)],
          "direction:" + direction,
        ),
      );
    }
    const quote = await this.quotes.prepare(token),
      signed = await this.quotes.signStored(
        token,
        quote.quoteId,
        this.providers.quotes,
      ),
      route = signed.route;
    const base = {
      direction,
      plan: String(plan),
      ordinal: signed.ordinal,
      quoteId: quote.quoteId,
      authorization: String(route.authorization),
      quoteReceipt: String(route.quoteReceipt),
      expiresAt: String(route.seal.expiresAt),
      expiresSlot: String(route.seal.expiresSlot),
    };
    const authId = evaluationOperationId(
      String(row.intent_id),
      "authorize",
      quote.quoteId,
    );
    const keys = route.keys;
    const swap: EvaluationSwapExpectation = {
      authority: String(ctx.client.authority),
      source: String(route.source),
      destination: String(route.destination),
      inputPool: String(keys[3]!.pubkey),
      outputPool: String(keys[4]!.pubkey),
      poolAuthority: String(keys[5]!.pubkey),
      inputMint: String(keys[6]!.pubkey),
      outputMint: String(keys[7]!.pubkey),
      input: String(route.input),
      output: String(route.output),
      instructionData: route.data.toString("hex"),
    };
    // Persist the exact execution BEFORE submitting authorization. Restart does
    // not need to re-quote against a now-active on-chain authorization.
    await this.reserveBatch(ctx.client, row, [
      {
        context: { ...base, kind: "authorize" },
        instructions: signed.authorizeInstructions,
        generation: quote.quoteId,
      },
      {
        context: {
          ...base,
          kind: "execute",
          authorizationOperation: authId,
          swap,
        },
        instructions: [signed.executeInstruction],
        generation: quote.quoteId,
      },
    ]);
    return this.process(token, ctx.client, authId);
  }
}
