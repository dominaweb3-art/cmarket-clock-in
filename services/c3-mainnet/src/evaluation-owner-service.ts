/** Hosted evaluation bridge: server-compiled messages, durable owner signature
 * journal and read-only recovery. No Mainnet endpoint, signer or policy import. */
import { createHash, randomUUID } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { evaluationRpc } from "./evaluation-rpc.ts";
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
import { evaluationCanonical } from "./evaluation-canonical.ts";
import {
  captureEvaluationRenewal,
  assertRenewalOperationsUnchanged,
  verifyEvaluationRenewal,
} from "./evaluation-renewal.ts";

const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_OWNER_" + code);
};
const actions = [
  "deposit",
  "issue_shares",
  "request_redemption",
  "claim",
  "renew_plan",
  "recover_deposit_plan",
];
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
    this.rpc = evaluationRpc();
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
      WHERE r.intent_id=$1
      UNION ALL SELECT p.purpose AS action,s.signature,r.outcome='effects_verified' AS effects_verified
      FROM c3_eval.service_contexts c JOIN c3_eval.service_packets p USING(operation_id) JOIN c3_eval.service_submissions s USING(operation_id) LEFT JOIN c3_eval.service_receipts r USING(operation_id) WHERE c.intent_id=$1`,
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
      settlementReleased: EVALUATION.lifecycleReady,
      allowedActions: actions.filter((a) => {
        try {
          assertEvaluationAction(a as EvaluationOwnerAction, ctx.position);
          return true;
        } catch {
          return false;
        }
      }),
      pendingRequests: intent
        ? (
            await this.pool.query(
              `SELECT r.request_id,r.action,s.signature FROM c3_eval.owner_requests r LEFT JOIN c3_eval.owner_submissions s USING(request_id) LEFT JOIN c3_eval.owner_effect_receipts e USING(request_id) LEFT JOIN c3_eval.owner_request_outcomes o USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL ORDER BY r.created_at`,
              [intent.intent_id],
            )
          ).rows
        : [],
      pendingInitialPlan: intent
        ? ((
            await this.pool.query(
              "SELECT s.signature FROM c3_eval.service_contexts c JOIN c3_eval.service_packets p USING(operation_id) LEFT JOIN c3_eval.service_submissions s USING(operation_id) WHERE c.intent_id=$1 AND p.purpose='plan' AND NOT EXISTS(SELECT 1 FROM c3_eval.initial_plan_expirations x WHERE x.operation_id=c.operation_id) AND NOT EXISTS(SELECT 1 FROM c3_eval.events e WHERE e.idempotency_hash=c.operation_id) LIMIT 1",
              [intent.intent_id],
            )
          ).rows[0] ?? null)
        : null,
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
    if (action === "recover_deposit_plan") {
      const plan = ctx.client.pda("c3-plan-v1", ctx.client.intent("deposit"));
      const raw = await this.rpc.getAccountInfoAndContext(plan, {
        commitment: "finalized",
        minContextSlot: ctx.slot,
      });
      check(!raw.value, "INITIAL_PLAN_EXISTS_RECONCILE_FIRST");
      ctx.accounts.set(String(plan), null);
      check(
        !(
          await this.pool.query(
            "SELECT 1 FROM c3_eval.service_contexts c WHERE c.intent_id=(SELECT intent_id FROM c3_eval.intents WHERE wallet=$1) AND NOT EXISTS(SELECT 1 FROM c3_eval.initial_plan_expirations e WHERE e.operation_id=c.operation_id) LIMIT 1",
            [ctx.proof.wallet],
          )
        ).rowCount,
        "INITIAL_PLAN_SIGNATURE_RECONCILE_FIRST",
      );
    }
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
    let clock = await this.rpc.getBlockTime(ctx.slot);
    check(
      clock &&
        Number.isSafeInteger(clock) &&
        Math.abs(Date.now() / 1000 - clock) < 60,
      "CHAIN_CLOCK",
    );
    const beforeIntent =
      action === "renew_plan"
        ? (
            await this.pool.query(
              "SELECT * FROM c3_eval.intents WHERE wallet=$1",
              [ctx.proof.wallet],
            )
          ).rows[0]
        : null;
    const renewal =
      action === "renew_plan"
        ? await captureEvaluationRenewal(
            this.pool,
            this.rpc,
            ctx.client,
            beforeIntent,
            clock!,
            ctx.slot,
          )
        : null;
    if (renewal) {
      clock = renewal.clock;
      ctx.accounts.set(renewal.plan, renewal.account);
    }
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
      if (renewal) {
        check(
          String(intent.db_revision) === String(beforeIntent.db_revision) &&
            String(intent.chain_revision) ===
              String(beforeIntent.chain_revision),
          "RENEWAL_CAS",
        );
        await assertRenewalOperationsUnchanged(c, intentId, renewal.operations);
      }
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
      const closed =
        prior &&
        (
          await c.query(
            "SELECT 1 FROM c3_eval.owner_request_outcomes WHERE request_id=$1 UNION ALL SELECT 1 FROM c3_eval.owner_effect_receipts WHERE request_id=$1",
            [prior.request_id],
          )
        ).rowCount === 1;
      if (prior && !closed) {
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
            renewal ?? undefined,
          ),
          id = randomUUID();
        request = (
          await c.query(
            `INSERT INTO c3_eval.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at,generation,predecessor)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '45 seconds',$9,$10) RETURNING *`,
            [
              id,
              intentId,
              action,
              intent.db_revision,
              intent.chain_revision,
              compiled.messageHash,
              latest.blockhash,
              latest.lastValidBlockHeight,
              prior ? String(BigInt(prior.generation) + 1n) : "1",
              prior?.request_id ?? null,
            ],
          )
        ).rows[0];
        const pre = Object.fromEntries(ctx.accounts);
        await c.query(
          "INSERT INTO c3_eval.owner_packet_contexts(request_id,chain_time,configuration_hash,pre_accounts) VALUES($1,$2,$3,$4)",
          [id, clock!.toString(), configurationHash, JSON.stringify(pre)],
        );
        request.chain_time = clock!.toString();
        if (renewal) {
          await c.query(
            "INSERT INTO c3_eval.renewal_requests(request_id,intent_id,plan,expected_db_revision,expected_chain_revision,expires_at,pre_state,message_hash,observed_slot,blockhash,last_valid_block_height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              id,
              intentId,
              renewal.plan,
              intent.db_revision,
              intent.chain_revision,
              String(renewal.expiry),
              renewal.preState,
              compiled.messageHash,
              renewal.slot,
              latest.blockhash,
              latest.lastValidBlockHeight,
            ],
          );
          await c.query(
            "INSERT INTO c3_eval.evaluation_renewal_contexts(request_id,direction,retired_operations,barrier_slot,evidence_hash) VALUES($1,$2,$3,$4,$5)",
            [
              id,
              renewal.direction,
              JSON.stringify(renewal.operations),
              renewal.barrierSlot,
              renewal.evidenceHash,
            ],
          );
        }
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
      renewal ?? undefined,
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
      chainTime: String(request.chain_time),
      expiresAt: request.expires_at,
      debitBaseUnits: action === "deposit" ? "1000000" : "0",
      shareBaseUnits: "1000000",
      vault: ctx.client.vault.toBase58(),
      ...(renewal
        ? {
            renewal: {
              direction: renewal.direction,
              revision: String(renewal.revision),
              expiry: String(BigInt(String(request.chain_time)) + 110n),
            },
          }
        : {}),
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
  /** Explicit Devnet expiry barrier, never wall-clock-only cancellation. Keep
   * original request/signature; replacement is an append-only generation. */
  async closeExpired(token: string, requestId: string) {
    const proof = await this.auth.authorize(token);
    check(
      (await this.rpc.getGenesisHash()) === EVALUATION.genesis,
      "WRONG_NETWORK",
    );
    const r = (
      await this.pool.query(
        "SELECT r.*,p.pre_accounts,s.signature,i.wallet FROM c3_eval.owner_requests r JOIN c3_eval.owner_packet_contexts p USING(request_id) JOIN c3_eval.intents i USING(intent_id) LEFT JOIN c3_eval.owner_submissions s USING(request_id) WHERE r.request_id=$1",
        [requestId],
      )
    ).rows[0];
    check(r && r.wallet === proof.wallet, "REQUEST_BINDING");
    if (
      (
        await this.pool.query(
          "SELECT 1 FROM c3_eval.owner_request_outcomes WHERE request_id=$1",
          [requestId],
        )
      ).rowCount
    )
      return {
        status: "closed_unexecuted",
        requestId,
        automaticallyResubmitted: false,
      };
    const valid = await this.rpc.isBlockhashValid(r.blockhash, {
        commitment: "finalized",
      }),
      height = await this.rpc.getBlockHeight("finalized");
    check(
      !valid.value && BigInt(height) > BigInt(r.last_valid_height),
      "EXPIRY_BARRIER_NOT_FINALIZED",
    );
    let failed = false;
    if (r.signature) {
      const status = (
        await this.rpc.getSignatureStatuses([r.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (status) {
        check(
          status.confirmationStatus === "finalized",
          "UNCERTAIN_RECONCILE_FIRST",
        );
        if (!status.err) return this.reconcile(token, requestId);
        const tx = await this.rpc.getTransaction(r.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
        check(
          tx?.meta?.err &&
            tx.slot === status.slot &&
            tx.transaction.signatures[0] === r.signature &&
            hash(tx.transaction.message.serialize()).equals(r.message_hash),
          "FAILED_MESSAGE_EVIDENCE",
        );
        failed = true;
      }
    }
    const ctx = await this.context(token, valid.context.slot);
    if (r.action === "recover_deposit_plan") {
      const plan = ctx.client.pda("c3-plan-v1", ctx.client.intent("deposit"));
      const a = await this.rpc.getAccountInfoAndContext(plan, {
        commitment: "finalized",
        minContextSlot: ctx.slot,
      });
      ctx.accounts.set(
        String(plan),
        a.value
          ? {
              owner: a.value.owner.toBase58(),
              executable: a.value.executable,
              data: [a.value.data.toString("base64"), "base64"],
            }
          : null,
      );
    }
    if (r.action === "renew_plan") {
      const renewal = (
        await this.pool.query(
          "SELECT plan FROM c3_eval.renewal_requests WHERE request_id=$1",
          [requestId],
        )
      ).rows[0];
      check(renewal, "RENEWAL_REQUEST");
      const plan = await this.rpc.getAccountInfoAndContext(
        new PublicKey(renewal.plan),
        { commitment: "finalized", minContextSlot: ctx.slot },
      );
      const a = plan.value;
      ctx.accounts.set(
        renewal.plan,
        a
          ? {
              owner: a.owner.toBase58(),
              executable: a.executable,
              lamports: a.lamports,
              data: [a.data.toString("base64"), "base64"],
            }
          : null,
      );
    }
    const image = (accounts: Record<string, OpenAccount | null>) =>
      Object.entries(accounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([address, a]) => ({
          address,
          value: a
            ? { owner: a.owner, executable: a.executable, data: a.data }
            : null,
        }));
    const before = image(r.pre_accounts),
      after = image(Object.fromEntries(ctx.accounts));
    check(
      evaluationCanonical(before) === evaluationCanonical(after),
      "EXPIRY_ACCOUNT_EFFECTS_CHANGED",
    );
    const evidence = hash(
      evaluationCanonical({
        before,
        after,
        height,
        slot: ctx.slot,
        signature: r.signature ?? null,
        failed,
      }),
    );
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const row = (
        await c.query(
          "SELECT *,clock_timestamp() AS now FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [r.intent_id],
        )
      ).rows[0];
      if (
        (
          await c.query(
            "SELECT 1 FROM c3_eval.owner_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount
      ) {
        await c.query("COMMIT");
        return {
          status: "closed_unexecuted",
          requestId,
          automaticallyResubmitted: false,
        };
      }
      check(
        String(row?.db_revision) === String(r.expected_db_revision) &&
          String(row?.chain_revision) === String(r.expected_chain_revision) &&
          r.expires_at <= row.now,
        "EXPIRY_CAS",
      );
      check(
        !(
          await c.query(
            "SELECT 1 FROM c3_eval.owner_message_receipts WHERE request_id=$1",
            [requestId],
          )
        ).rowCount,
        "ALREADY_FINALIZED",
      );
      if (
        !(
          await c.query(
            "SELECT 1 FROM c3_eval.owner_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount
      ) {
        await c.query(
          "INSERT INTO c3_eval.owner_request_outcomes(request_id,outcome,evidence_hash) VALUES($1,$2,$3)",
          [
            requestId,
            failed ? "failed_finalized" : "expired_unexecuted",
            evidence,
          ],
        );
        await c.query(
          "UPDATE c3_eval.intents SET db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
          [r.intent_id],
        );
        await c.query(
          "INSERT INTO c3_eval.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            r.intent_id,
            hash("evaluation:owner-expiry:" + requestId).toString("hex"),
            String(BigInt(row.db_revision) + 1n),
            row.state,
            evidence.toString("hex"),
          ],
        );
      }
      await c.query("COMMIT");
      return {
        status: "closed_unexecuted",
        requestId,
        automaticallyResubmitted: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
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
    if (action === "renew_plan")
      return this.reconcileRenewal(ctx.client, requestId, request, tx!);
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
        recover_deposit_plan: ["funded", "buying", 1, 2],
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
      action === "deposit" || action === "recover_deposit_plan"
        ? ctx.position.shares === 0n &&
            ctx.position.inventory[0]! >= EVALUATION.amount
        : action === "claim"
          ? ctx.position.shares === 0n && ctx.position.returned === effect.claim
          : ctx.position.shares === EVALUATION.amount,
      "POST_SHARES_OR_RESERVES",
    );
    if (action === "recover_deposit_plan") {
      const plan = ctx.client.pda("c3-plan-v1", ctx.client.intent("deposit"));
      const raw = await this.rpc.getAccountInfoAndContext(plan, {
        commitment: "finalized",
        minContextSlot: tx!.slot,
      });
      check(raw.value?.owner.equals(ctx.client.program), "OWNER_PLAN_ACCOUNT");
      const decoded = ctx.client.coder.accounts.decode(
        "SettlementPlan",
        raw.value!.data,
      ) as Record<string, unknown>;
      check(
        String(decoded.wallet) === ctx.proof.wallet &&
          String(decoded.vault) === String(ctx.client.vault) &&
          decoded.direction === 1 &&
          String(decoded.revision) === "0" &&
          decoded.executed_bitmap === 0 &&
          String(decoded.router_program) === EVALUATION.router &&
          Array.isArray(decoded.minimum_outputs) &&
          decoded.minimum_outputs.map(String).join(",") === "40000,30000,30000",
        "OWNER_PLAN_POST_STATE",
      );
    }
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
  private async reconcileRenewal(
    client: EvaluationClient,
    requestId: string,
    request: Record<string, unknown>,
    tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>,
  ) {
    const r = (
      await this.pool.query(
        "SELECT r.*,c.direction,c.retired_operations,c.evidence_hash AS barrier_hash FROM c3_eval.renewal_requests r JOIN c3_eval.evaluation_renewal_contexts c USING(request_id) WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    check(r, "RENEWAL_REQUEST");
    const raw = await this.rpc.getAccountInfoAndContext(new PublicKey(r.plan), {
        commitment: "finalized",
        minContextSlot: tx.slot,
      }),
      a = raw.value;
    const proof = verifyEvaluationRenewal(
      client,
      { ...r, signature: String(request.signature) },
      tx,
      a
        ? {
            owner: a.owner.toBase58(),
            executable: a.executable,
            lamports: a.lamports,
            data: [a.data.toString("base64"), "base64"],
          }
        : null,
    );
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const current = (
        await c.query(
          "SELECT * FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [r.intent_id],
        )
      ).rows[0];
      if (
        (
          await c.query(
            "SELECT 1 FROM c3_eval.plan_generations WHERE request_id=$1",
            [requestId],
          )
        ).rowCount
      ) {
        await c.query("COMMIT");
        return {
          status: "already_reconciled",
          signature: request.signature,
          automaticallyResubmitted: false,
        };
      }
      check(
        String(current.db_revision) === String(r.expected_db_revision) &&
          String(current.chain_revision) === String(r.expected_chain_revision),
        "RENEWAL_CAS",
      );
      check(
        !(
          await c.query(
            "SELECT 1 FROM c3_eval.owner_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount,
        "CLOSED_REQUEST",
      );
      await assertRenewalOperationsUnchanged(
        c,
        r.intent_id,
        r.retired_operations,
      );
      const legs = (
        await c.query(
          "SELECT * FROM c3_eval.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 ORDER BY ordinal FOR UPDATE",
          [r.intent_id, r.direction === 1 ? 0 : 3, r.direction === 1 ? 2 : 5],
        )
      ).rows;
      check(
        legs.length === 3 &&
          legs.every(
            (l, n) =>
              (l.state === "confirmed") === !!(r.pre_state[714] & (1 << n)) &&
              (l.state === "confirmed" ||
                (["pending", "prepared"].includes(l.state) &&
                  !l.submitted_signature)),
          ),
        "RENEWAL_PROGRESS",
      );
      const gen = String(
        BigInt(
          (
            await c.query(
              "SELECT COALESCE(max(generation),0)::text n FROM c3_eval.plan_generations WHERE intent_id=$1 AND plan=$2",
              [r.intent_id, r.plan],
            )
          ).rows[0].n,
        ) + 1n,
      );
      await c.query(
        "INSERT INTO c3_eval.plan_generations(intent_id,plan,generation,base_revision,request_id,renewal_signature,finalized_slot,post_state,evidence_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10))",
        [
          r.intent_id,
          r.plan,
          gen,
          proof.revision,
          requestId,
          request.signature,
          proof.slot,
          proof.postState,
          proof.evidenceHash,
          r.expires_at,
        ],
      );
      await c.query(
        "UPDATE c3_eval.intents SET chain_revision=$2,db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
        [r.intent_id, proof.revision],
      );
      for (const l of legs) {
        if (l.state === "confirmed") continue;
        await c.query(
          "INSERT INTO c3_eval.leg_attempt_history SELECT intent_id,ordinal,$3,$4,to_jsonb(l) FROM c3_eval.legs l WHERE intent_id=$1 AND ordinal=$2",
          [r.intent_id, l.ordinal, gen, r.plan],
        );
        await c.query(
          "UPDATE c3_eval.legs SET state='pending',route_hash=NULL,instruction_hash=NULL,authorization_hash=NULL,input_mint=NULL,output_mint=NULL,source_account=NULL,destination_account=NULL,input_amount=NULL,minimum_output=NULL,quote_expires_at=NULL,expected_effects=NULL,lease_owner=NULL,lease_expires_at=NULL,reason_code=NULL,updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2",
          [r.intent_id, l.ordinal],
        );
        await c.query(
          "UPDATE c3_eval.quote_authorizations SET state='manual_review',revision=revision+1 WHERE intent_id=$1 AND ordinal=$2 AND state IN ('prepared','signed')",
          [r.intent_id, l.ordinal],
        );
      }
      for (const operation of r.retired_operations)
        await c.query(
          "INSERT INTO c3_eval.service_retirements(operation_id,intent_id,plan,generation,evidence_hash) VALUES($1,$2,$3,$4,$5)",
          [
            operation,
            r.intent_id,
            r.plan,
            gen,
            hash(Buffer.concat([r.barrier_hash, proof.evidenceHash])),
          ],
        );
      await c.query(
        "INSERT INTO c3_eval.owner_message_receipts(request_id,slot,evidence_hash) VALUES($1,$2,$3)",
        [requestId, proof.slot, proof.evidenceHash],
      );
      await c.query(
        "INSERT INTO c3_eval.owner_effect_receipts(request_id,lifecycle_stage,evidence_hash) VALUES($1,$2,$3)",
        [requestId, current.state, proof.evidenceHash],
      );
      const event = randomUUID();
      await c.query(
        "INSERT INTO c3_eval.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash,safe_reason) VALUES($1,$2,$3,$4,$5,$6,'OWNER_PLAN_RENEWED')",
        [
          event,
          r.intent_id,
          hash("evaluation:renewal:" + requestId).toString("hex"),
          String(BigInt(current.db_revision) + 1n),
          current.state,
          proof.evidenceHash.toString("hex"),
        ],
      );
      await c.query("INSERT INTO c3_eval.outbox(event_id) VALUES($1)", [event]);
      await c.query("COMMIT");
      return {
        status: "effects_verified",
        stage: current.state,
        signature: request.signature,
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
