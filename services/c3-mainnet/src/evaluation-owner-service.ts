/** Hosted evaluation bridge: server-compiled messages, durable owner signature
 * journal and read-only recovery. No Mainnet endpoint, signer or policy import. */
import { createHash, randomUUID } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import type { Pool } from "pg";
import { EvaluationAuth, EVALUATION_ORIGIN } from "./evaluation-auth.ts";
import {
  EvaluationClient,
  type EvaluationOwnerAction,
} from "./evaluation-client.ts";
import {
  EVALUATION,
  assertEvaluationDatabase,
  evaluationJournalPool,
} from "./evaluation-scope.ts";
import {
  evaluationConfigFromRow,
  evaluationPosition,
  assertEvaluationAction,
} from "./evaluation-state.ts";
import type { OpenAccount } from "./open-state-semantics.ts";
import { OpenOwnerJournal } from "./open-owner-journal-core.ts";
import { verifyEvaluationOwnerEffects } from "./evaluation-owner-effects.ts";

const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_OWNER_" + code);
};
const RPC = "https://api.devnet.solana.com";
const actions = ["deposit", "issue_shares", "request_redemption", "claim"];
export class EvaluationOwnerService {
  private readonly pool: Pool;
  private readonly rpc: Connection;
  private readonly idl: Idl;
  private readonly auth: EvaluationAuth;
  private readonly journal: OpenOwnerJournal;
  constructor(pool: Pool, idl: Idl) {
    check(idl.address === EVALUATION.program, "IDL");
    this.pool = pool;
    this.idl = idl;
    // Transport and chain are not supplied by an HTTP caller/environment.
    this.rpc = new Connection(RPC, {
      commitment: "finalized",
      disableRetryOnRateLimit: true,
    });
    this.auth = new EvaluationAuth(pool);
    this.journal = new OpenOwnerJournal(
      evaluationJournalPool(pool),
      EVALUATION_ORIGIN,
    );
  }
  async context(token: string, minimumSlot?: number) {
    const proof = await this.auth.authorize(token);
    await assertEvaluationDatabase(this.pool);
    check(
      (await this.rpc.getGenesisHash()) === EVALUATION.genesis,
      "WRONG_NETWORK",
    );
    const row = (
      await this.pool.query(
        `SELECT a.*,v.share_mint,v.vault FROM c3_eval.asset_configuration a
      JOIN c3_eval.wallet_vaults v ON v.wallet=$1 WHERE a.singleton=true`,
        [proof.wallet],
      )
    ).rows[0];
    check(row, "WALLET_VAULT_NOT_PROVISIONED");
    const client = new EvaluationClient(
      this.idl,
      evaluationConfigFromRow(proof.wallet, row),
    );
    check(client.vault.toBase58() === row.vault, "VAULT");
    const names = client.accounts(client.intent("deposit"));
    const addresses = [
      client.vault,
      new PublicKey(client.config.shareMint),
      names.owner_shares!,
      names.owner_usdc!,
      names.vault_usdc!,
      names.vault_btc!,
      names.vault_eth!,
      names.vault_wsol!,
      client.intent("deposit"),
      client.intent("redemption"),
    ];
    const result = await this.rpc.getMultipleAccountsInfoAndContext(addresses, {
      commitment: "finalized",
      ...(minimumSlot ? { minContextSlot: minimumSlot } : {}),
    });
    const accounts = new Map<string, OpenAccount | null>();
    for (let i = 0; i < addresses.length; i++) {
      const r = result.value[i];
      accounts.set(
        addresses[i]!.toBase58(),
        r
          ? {
              owner: r.owner.toBase58(),
              executable: r.executable,
              lamports: r.lamports,
              data: [r.data.toString("base64"), "base64"],
            }
          : null,
      );
    }
    const position = evaluationPosition(client, accounts);
    return { proof, client, position, accounts, slot: result.context.slot };
  }
  async position(token: string) {
    const ctx = await this.context(token);
    const intent = (
      await this.pool.query(
        "SELECT intent_id,state,db_revision,chain_revision FROM c3_eval.intents WHERE wallet=$1",
        [ctx.proof.wallet],
      )
    ).rows[0];
    const activity = intent
      ? (
          await this.pool.query(
            `SELECT r.action,s.signature,
      EXISTS(SELECT 1 FROM c3_eval.owner_effect_receipts e WHERE e.request_id=r.request_id) AS effects_verified
      FROM c3_eval.owner_requests r JOIN c3_eval.owner_submissions s USING(request_id)
      WHERE r.intent_id=$1 ORDER BY s.created_at`,
            [intent.intent_id],
          )
        ).rows
      : [];
    return {
      cluster: EVALUATION.cluster,
      simulatedAssets: true,
      monetaryValue: false,
      wallet: ctx.proof.wallet,
      vault: ctx.client.vault.toBase58(),
      shareMint: ctx.client.config.shareMint,
      shares: ctx.position.shares.toString(),
      claimable: ctx.position.claimable.toString(),
      returned: ctx.position.returned.toString(),
      lifecycle: ctx.position.lifecycle,
      paused: ctx.position.paused,
      finalizedSlot: ctx.slot,
      inventory: ctx.position.inventory.map(String),
      intent: intent ?? null,
      activity: activity.map((r) => ({
        ...r,
        explorer: `https://explorer.solana.com/tx/${r.signature}?cluster=devnet`,
      })),
    };
  }
  async prepare(token: string, action: EvaluationOwnerAction) {
    check(
      EVALUATION.lifecycleReady,
      "SETTLEMENT_AND_RECONCILIATION_NOT_CONNECTED",
    );
    check(actions.includes(action), "ACTION");
    const ctx = await this.context(token);
    assertEvaluationAction(action, ctx.position);
    const configurationHash = hash(
      JSON.stringify({
        ...ctx.client.config,
        version: "1",
        program: EVALUATION.program,
        genesis: EVALUATION.genesis,
        router: EVALUATION.router,
        weights: EVALUATION.weights,
      }),
    ).toString("hex");
    const clock = await this.rpc.getBlockTime(ctx.slot);
    check(
      clock &&
        Number.isSafeInteger(clock) &&
        Math.abs(Date.now() / 1000 - clock) < 60,
      "CHAIN_CLOCK",
    );
    const latest = await this.rpc.getLatestBlockhash("finalized");
    const c = await this.pool.connect();
    let request: Record<string, unknown>;
    let intentId: string;
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,7421))", [
        ctx.proof.wallet,
      ]);
      let intent = (
        await c.query(
          "SELECT *,clock_timestamp() AS now FROM c3_eval.intents WHERE wallet=$1 FOR UPDATE",
          [ctx.proof.wallet],
        )
      ).rows[0];
      if (!intent) {
        check(action === "deposit", "INTENT_NOT_CREATED");
        intentId = randomUUID();
        const plan = ctx.client.pda("c3-plan-v1", ctx.client.intent("deposit"));
        intent = (
          await c.query(
            `INSERT INTO c3_eval.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,1000000,clock_timestamp()+interval '1 hour') RETURNING *,clock_timestamp() AS now`,
            [
              intentId,
              ctx.proof.wallet,
              ctx.client.vault.toBase58(),
              ctx.client.config.shareMint,
              plan.toBase58(),
              configurationHash,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO c3_eval.legs(intent_id,ordinal) SELECT $1,n FROM generate_series(0,5) AS n",
          [intentId],
        );
        const event = randomUUID();
        await c.query(
          "INSERT INTO c3_eval.events(event_id,intent_id,idempotency_hash,db_revision,state) VALUES($1,$2,$3,1,'draft')",
          [
            event,
            intentId,
            hash("evaluation:create:" + intentId).toString("hex"),
          ],
        );
        await c.query("INSERT INTO c3_eval.outbox(event_id) VALUES($1)", [
          event,
        ]);
      }
      intentId = intent.intent_id;
      check(
        intent.configuration_hash === configurationHash &&
          intent.vault === ctx.client.vault.toBase58(),
        "IMMUTABLE_CONFIG",
      );
      // Link the SAME verified message proof to the existing owner journal. No
      // second intent, copied balances, or client-supplied authentication evidence.
      await c.query(
        `INSERT INTO c3_eval.owner_challenges(challenge_id,intent_id,wallet,audience,nonce_hash,message_hash,expires_at)
        SELECT challenge_id,$1,wallet,audience,message_hash,message_hash,expires_at FROM c3_eval.wallet_challenges
        WHERE challenge_id=$2 ON CONFLICT(challenge_id) DO NOTHING`,
        [intentId, ctx.proof.challengeId],
      );
      await c.query(
        `INSERT INTO c3_eval.owner_sessions(session_hash,challenge_id,intent_id,wallet,expires_at)
        SELECT session_hash,challenge_id,$1,$2,expires_at FROM c3_eval.wallet_sessions
        WHERE session_hash=$3 ON CONFLICT(session_hash) DO NOTHING`,
        [intentId, ctx.proof.wallet, hash(token)],
      );
      const pending = await c.query(
        `SELECT 1 FROM c3_eval.owner_requests r
        LEFT JOIN c3_eval.owner_effect_receipts e USING(request_id) LEFT JOIN c3_eval.owner_request_outcomes o USING(request_id)
        WHERE r.intent_id=$1 AND r.action<>$2 AND e.request_id IS NULL AND o.request_id IS NULL LIMIT 1`,
        [intentId, action],
      );
      check(!pending.rowCount, "RECONCILE_PENDING_FIRST");
      const prior = (
        await c.query(
          `SELECT r.*,p.chain_time FROM c3_eval.owner_requests r JOIN c3_eval.owner_packet_contexts p USING(request_id)
        WHERE r.intent_id=$1 AND r.action=$2 ORDER BY r.created_at DESC LIMIT 1`,
          [intentId, action],
        )
      ).rows[0];
      if (prior) {
        check(
          prior.expires_at > intent.now &&
            prior.expected_db_revision === intent.db_revision &&
            !(
              await c.query(
                "SELECT 1 FROM c3_eval.owner_submissions WHERE request_id=$1",
                [prior.request_id],
              )
            ).rowCount,
          "REQUEST_EXPIRED_OR_UNCERTAIN_RECONCILE_FIRST",
        );
        request = prior;
      } else {
        const compiled = ctx.client.compileOwner(
            action,
            BigInt(clock!),
            latest.blockhash,
            latest.lastValidBlockHeight,
          ),
          id = randomUUID();
        request = (
          await c.query(
            `INSERT INTO c3_eval.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '45 seconds') RETURNING *`,
            [
              id,
              intentId,
              action,
              intent.db_revision,
              intent.chain_revision,
              compiled.messageHash,
              latest.blockhash,
              latest.lastValidBlockHeight,
            ],
          )
        ).rows[0];
        const pre = Object.fromEntries(ctx.accounts);
        await c.query(
          "INSERT INTO c3_eval.owner_packet_contexts(request_id,chain_time,configuration_hash,pre_accounts) VALUES($1,$2,$3,$4)",
          [id, clock!.toString(), configurationHash, JSON.stringify(pre)],
        );
        request.chain_time = clock!.toString();
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    const compiled = ctx.client.compileOwner(
      action,
      BigInt(String(request.chain_time)),
      String(request.blockhash),
      Number(request.last_valid_height),
    );
    check(
      compiled.messageHash.equals(request.message_hash as Buffer),
      "PACKET_BINDING",
    );
    await this.journal.bindRequest(token, String(request.request_id));
    return {
      requestId: request.request_id,
      intentId: intentId!,
      action,
      cluster: EVALUATION.cluster,
      simulatedAssets: true,
      messageHash: compiled.messageHash.toString("hex"),
      packet: compiled.packet.toString("base64"),
      expiresAt: request.expires_at,
      debitBaseUnits: action === "deposit" ? "1000000" : "0",
      shareBaseUnits: "1000000",
      vault: ctx.client.vault.toBase58(),
    };
  }
  async submit(token: string, requestId: string, packet: Uint8Array) {
    check(
      EVALUATION.lifecycleReady,
      "SETTLEMENT_AND_RECONCILIATION_NOT_CONNECTED",
    );
    await this.auth.authorize(token);
    check(
      (await this.rpc.getGenesisHash()) === EVALUATION.genesis,
      "WRONG_NETWORK",
    );
    await this.journal.authorizeRequest(token, requestId);
    const request = (
      await this.pool.query(
        "SELECT blockhash,last_valid_height FROM c3_eval.owner_requests WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    check(request, "REQUEST");
    const [valid, height] = await Promise.all([
      this.rpc.isBlockhashValid(request.blockhash, { commitment: "finalized" }),
      this.rpc.getBlockHeight("finalized"),
    ]);
    check(
      valid.value && BigInt(height) <= BigInt(request.last_valid_height),
      "BLOCKHASH_EXPIRED",
    );
    return this.journal.submitOnce(token, requestId, packet, (bytes) =>
      this.rpc.sendRawTransaction(bytes, {
        maxRetries: 0,
        skipPreflight: false,
        preflightCommitment: "finalized",
      }),
    );
    // Accepted != effects verified; no lifecycle promotion here. Lost response
    // stays uncertain in PG and cannot invoke a second send callback.
  }
  /** Read-only chain recovery; never calls send/sign or accepts a client signature.
   * The signature comes exclusively from the immutable pre-send PG journal. */
  async reconcile(token: string, requestId: string) {
    const proof = await this.auth.authorize(token);
    const request = (
      await this.pool.query(
        `SELECT r.*,p.pre_accounts,s.signature,i.wallet
      FROM c3_eval.owner_requests r JOIN c3_eval.owner_packet_contexts p USING(request_id)
      JOIN c3_eval.owner_submissions s USING(request_id) JOIN c3_eval.intents i USING(intent_id)
      WHERE r.request_id=$1`,
        [requestId],
      )
    ).rows[0];
    check(request && request.wallet === proof.wallet, "REQUEST_BINDING");
    check(
      (await this.rpc.getGenesisHash()) === EVALUATION.genesis,
      "WRONG_NETWORK",
    );
    const signature = String(request.signature);
    const priorReceipt = (
      await this.pool.query(
        "SELECT lifecycle_stage FROM c3_eval.owner_effect_receipts WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    if (priorReceipt)
      return {
        signature,
        status: "already_reconciled",
        stage: priorReceipt.lifecycle_stage,
        automaticallyResubmitted: false,
      };
    const status = (
      await this.rpc.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (!status || status.confirmationStatus !== "finalized")
      return {
        signature,
        status: "uncertain",
        automaticallyResubmitted: false,
      };
    // Failed finalized transactions retain their signatures and require explicit
    // review. They are never promoted or silently replaced by a new packet.
    if (status.err)
      return {
        signature,
        status: "failed_finalized",
        automaticallyResubmitted: false,
      };
    const tx = await this.rpc.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    check(tx && tx.slot === status.slot, "FINALIZED_TRANSACTION_MISSING");
    const ctx = await this.context(token, tx!.slot);
    const action = request.action as EvaluationOwnerAction;
    const effect = verifyEvaluationOwnerEffects(
      ctx.client,
      action,
      request.message_hash,
      signature,
      tx!,
      request.pre_accounts,
    );
    const stage = (
      {
        deposit: ["draft", "funded", 1, 2],
        issue_shares: ["buying", "active", 2, 5],
        request_redemption: ["active", "redemption_requested", 3, 2],
        claim: ["claimable", "redeemed", 4, 6],
      } as const
    )[action];
    check(
      stage &&
        ctx.position.lifecycle === stage[2] &&
        (action === "claim" || action === "request_redemption"
          ? ctx.position.redemptionStatus
          : ctx.position.depositStatus) === stage[3],
      "POST_STATE",
    );
    check(
      action === "deposit"
        ? ctx.position.shares === 0n &&
            ctx.position.inventory[0]! >= EVALUATION.amount
        : action === "claim"
          ? ctx.position.shares === 0n && ctx.position.returned === effect.claim
          : ctx.position.shares === EVALUATION.amount,
      "POST_SHARES_OR_RESERVES",
    );
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const current = (
        await c.query(
          "SELECT * FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [request.intent_id],
        )
      ).rows[0];
      const existing = (
        await c.query(
          "SELECT evidence_hash FROM c3_eval.owner_effect_receipts WHERE request_id=$1",
          [requestId],
        )
      ).rows[0];
      if (existing) {
        await c.query("COMMIT");
        return {
          signature,
          status: "already_reconciled",
          automaticallyResubmitted: false,
        };
      }
      check(
        current &&
          String(current.db_revision) ===
            String(request.expected_db_revision) &&
          String(current.chain_revision) ===
            String(request.expected_chain_revision) &&
          current.state === stage[0],
        "CAS",
      );
      if (action === "issue_shares" || action === "claim") {
        const first = action === "issue_shares" ? 0 : 3;
        check(
          (
            await c.query(
              "SELECT 1 FROM c3_eval.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 AND state='confirmed'",
              [request.intent_id, first, first + 2],
            )
          ).rowCount === 3,
          "UNSETTLED_LEGS",
        );
      }
      check(
        !(
          await c.query(
            "SELECT 1 FROM c3_eval.owner_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount,
        "CLOSED_REQUEST",
      );
      await c.query(
        "INSERT INTO c3_eval.owner_message_receipts(request_id,slot,evidence_hash) VALUES($1,$2,$3)",
        [requestId, effect.slot, effect.evidenceHash],
      );
      await c.query(
        "INSERT INTO c3_eval.owner_effect_receipts(request_id,lifecycle_stage,evidence_hash) VALUES($1,$2,$3)",
        [requestId, stage[1], effect.evidenceHash],
      );
      await c.query(
        "UPDATE c3_eval.intents SET state=$2,db_revision=db_revision+1,chain_revision=$3,redemption_plan=COALESCE(redemption_plan,$4),updated_at=clock_timestamp() WHERE intent_id=$1",
        [
          request.intent_id,
          stage[1],
          action === "request_redemption" ? "0" : current.chain_revision,
          action === "request_redemption"
            ? ctx.client
                .pda("c3-plan-v1", ctx.client.intent("redemption"))
                .toBase58()
            : null,
        ],
      );
      await c.query(
        "INSERT INTO c3_eval.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          request.intent_id,
          hash("evaluation:owner-effect:" + requestId).toString("hex"),
          (BigInt(current.db_revision) + 1n).toString(),
          stage[1],
          effect.evidenceHash.toString("hex"),
        ],
      );
      await c.query("COMMIT");
      return {
        signature,
        status: "effects_verified",
        stage: stage[1],
        automaticallyResubmitted: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
