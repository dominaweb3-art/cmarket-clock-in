/** Real disposable PostgreSQL journal tests. RPC responses are explicitly
 * synthetic here; these tests DO NOT demonstrate Devnet asset settlement. */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign, randomUUID } from "node:crypto";
import type { Idl } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import pg from "pg";
import {
  EvaluationServiceJournal,
  evaluationOperationId,
} from "../src/evaluation-service-journal.ts";
import { EVALUATION } from "../src/evaluation-scope.ts";
import { evaluationContextFixture } from "./evaluation-leg-context.test.ts";
import { EvaluationSettlementService } from "../src/evaluation-settlement-service.ts";
import { evaluationCreatePlan } from "../src/evaluation-settlement-client.ts";
import { evaluationCanonical } from "../src/evaluation-canonical.ts";
import { EvaluationOwnerService } from "../src/evaluation-owner-service.ts";
import { EvaluationAuth } from "../src/evaluation-auth.ts";
import { renewalFixture } from "./evaluation-renewal.test.ts";
import { captureEvaluationRenewal } from "../src/evaluation-renewal.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw Error("DISPOSABLE_DB_REQUIRED");
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
test("single durable dispatch survives lost RPC reply, restart and concurrent requests", async (t) => {
  t.after(() => pool.end());
  await pool.query(
    execFileSync(process.execPath, ["../../scripts/c3-evaluation-schema.mjs"], {
      encoding: "utf8",
    }),
  );
  await pool.query(
    readFileSync(
      new URL(
        "../../../scripts/sql/0001_evaluation_wallet_proof.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pool.query(
    readFileSync(
      new URL(
        "../../../scripts/sql/0002_evaluation_service_journal.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const migration of [
    "0003_evaluation_initial_plan_expiry.sql",
    "0004_evaluation_owner_plan_recovery.sql",
  ]) {
    await pool.query(
      readFileSync(
        new URL(`../../../scripts/sql/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  }
  t.mock.method(
    Connection.prototype,
    "getGenesisHash",
    async () => EVALUATION.genesis,
  );
  let sends = 0,
    signs = 0;
  t.mock.method(Connection.prototype, "sendRawTransaction", async () => {
    sends++;
    throw Error("LOST_REPLY");
  });
  // A deliberately invalid local signature must never broadcast or persist.
  const payer = new PublicKey(EVALUATION.governance);
  const packet = Buffer.from(
    new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: payer,
            lamports: 0,
          }),
        ],
      }).compileToV0Message(),
    ).serialize(),
  );
  const input = {
    operationId: evaluationOperationId("test-wallet", "wallet", "0"),
    scope: "test-wallet",
    purpose: "wallet" as const,
    packet,
    lastValidBlockHeight: 1000,
  };
  const service = new EvaluationServiceJournal(pool);
  // web3.js binds getBlockHeight on instances. Tests replace that exact method,
  // without adding a configurable production transport or endpoint override.
  t.mock.method(Reflect.get(service, "rpc"), "getBlockHeight", async () => 100);
  const restarted = new EvaluationServiceJournal(pool);
  t.mock.method(
    Reflect.get(restarted, "rpc"),
    "getBlockHeight",
    async () => 100,
  );
  const foreign = generateKeyPairSync("ed25519");
  await assert.rejects(
    () =>
      service.dispatch(input, {
        publicKey: EVALUATION.governance,
        signMessage: async (m) => {
          signs++;
          return sign(null, m, foreign.privateKey);
        },
      }),
    /SIGNATURE/,
  );
  assert.equal(sends, 0);
  assert.equal(
    (await pool.query("SELECT count(*) FROM c3_eval.service_submissions"))
      .rows[0].count,
    "0",
  );
  // Seed a lost dispatch with a public synthetic signature. No deployed identity
  // or actual key is touched; database constraints and restart behavior are real.
  const h = createHash("sha256")
    .update(VersionedTransaction.deserialize(packet).message.serialize())
    .digest();
  await pool.query(
    "INSERT INTO c3_eval.service_packets(operation_id,scope,purpose,signer,message_hash,unsigned_packet,last_valid_height) VALUES($1,$2,$3,$4,$5,$6,1000) ON CONFLICT(operation_id) DO NOTHING",
    [
      input.operationId,
      input.scope,
      input.purpose,
      EVALUATION.governance,
      h,
      packet,
    ],
  );
  const signature = "2".repeat(88);
  await pool.query(
    "INSERT INTO c3_eval.service_submissions(operation_id,signature,signed_message_hash) VALUES($1,$2,$3)",
    [input.operationId, signature, h],
  );
  const before = signs;
  const out = await Promise.all([
    service.dispatch(input, {
      publicKey: EVALUATION.governance,
      signMessage: async () => {
        signs++;
        throw Error("MUST_NOT_SIGN");
      },
    }),
    restarted.dispatch(input, {
      publicKey: EVALUATION.governance,
      signMessage: async () => {
        signs++;
        throw Error("MUST_NOT_SIGN");
      },
    }),
  ]);
  assert.ok(
    out.every(
      (v) =>
        v.signature === signature && !v.dispatched && v.state === "uncertain",
    ),
  );
  assert.equal(signs, before);
  assert.equal(sends, 0);
  await assert.rejects(
    () =>
      pool.query(
        "UPDATE c3_eval.service_packets SET scope='evil' WHERE operation_id=$1",
        [input.operationId],
      ),
    /IMMUTABLE/,
  );
  await assert.rejects(
    () =>
      pool.query(
        "DELETE FROM c3_eval.service_submissions WHERE operation_id=$1",
        [input.operationId],
      ),
    /IMMUTABLE/,
  );
  t.mock.method(Connection.prototype, "getTransaction", async () => null);
  assert.equal(
    (
      await service.reconcile(input.operationId, async () => {
        throw Error("NO_EFFECTS");
      })
    ).state,
    "uncertain",
  );
  // Real PG pair reservation, with public synthetic route context only.
  const f = await evaluationContextFixture(
    1,
    0,
    BigInt(Math.floor(Date.now() / 1000)),
  );
  const intent = randomUUID();
  await pool.query(
    "INSERT INTO c3_eval.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,expires_at,state,db_revision) VALUES($1,$2,$3,$4,$5,$6,1000000,clock_timestamp()+interval '1 hour','buying',2)",
    [
      intent,
      f.c.config.wallet,
      String(f.c.vault),
      f.c.config.shareMint,
      String(f.planAddress),
      hashText("test"),
    ],
  );
  const row = (
    await pool.query("SELECT * FROM c3_eval.intents WHERE intent_id=$1", [
      intent,
    ])
  ).rows[0];
  const idl = JSON.parse(
    readFileSync(
      new URL("../resources/c3_devnet_evaluation_vault.json", import.meta.url),
      "utf8",
    ),
  ) as Idl;
  const mustNotSign = async () => {
    throw Error("NO_SIGNING_IN_RESERVATION_TEST");
  };
  const runtime = new EvaluationSettlementService(pool, idl, {
    governance: { publicKey: EVALUATION.governance, signMessage: mustNotSign },
    keeper: { publicKey: EVALUATION.keeper, signMessage: mustNotSign },
    quotes: {
      publicKey: new PublicKey(EVALUATION.quotes).toBytes(),
      signIdempotently: mustNotSign,
      lookupSignature: async () => null,
    },
  });
  t.mock.method(
    Reflect.get(runtime, "rpc"),
    "getLatestBlockhash",
    async () => ({ blockhash: payer.toBase58(), lastValidBlockHeight: 1000 }),
  );
  const instruction = evaluationCreatePlan(
    f.c,
    1,
    BigInt(Math.floor(Date.now() / 1000)),
  ).instruction;
  const context = {
    kind: "plan",
    direction: 1,
    plan: String(f.planAddress),
    ordinal: 0,
  };
  const reserve = (items: unknown[]) =>
    Reflect.get(runtime, "reserveBatch").call(runtime, f.c, row, items);
  const item = { context, instructions: [instruction], generation: "atomic-a" };
  const conflict = { ...item, context: { ...context, ordinal: 1 } };
  await assert.rejects(() => reserve([item, conflict]), /RESERVATION_CONFLICT/);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM c3_eval.service_contexts WHERE intent_id=$1",
        [intent],
      )
    ).rows[0].count,
    "0",
  );
  const results = await Promise.all([
    reserve([item, { ...item, generation: "atomic-b" }]),
    reserve([item, { ...item, generation: "atomic-b" }]),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM c3_eval.service_contexts WHERE intent_id=$1",
        [intent],
      )
    ).rows[0].count,
    "2",
  );
  await assert.rejects(() => reserve([conflict]), /RESERVATION_CONFLICT/);
  const stored = (
    await pool.query(
      "SELECT context,context_hash FROM c3_eval.service_contexts WHERE intent_id=$1 LIMIT 1",
      [intent],
    )
  ).rows[0];
  assert.deepEqual(
    createHash("sha256").update(evaluationCanonical(stored.context)).digest(),
    stored.context_hash,
  );
  assert.throws(
    () => evaluationCanonical({ bad: undefined }),
    /CONTEXT_ENCODING/,
  );
  assert.equal(sends, 0);
  // Expiration is not cancellation: finalized blockhash invalidity AND an
  // unchanged custody snapshot are required before a new request generation.
  const ownerService = new EvaluationOwnerService(pool, idl),
    ownerRpc = Reflect.get(ownerService, "rpc");
  t.mock.method(EvaluationAuth.prototype, "authorize", async () => ({
    wallet: f.c.config.wallet,
    challengeId: randomUUID(),
  }));
  t.mock.method(ownerService, "context", async () => ({
    proof: { wallet: f.c.config.wallet },
    client: f.c,
    accounts: f.accounts,
    slot: 2000,
  }));
  let valid = true;
  t.mock.method(ownerRpc, "getBlockHeight", async () => 2000);
  t.mock.method(ownerRpc, "isBlockhashValid", async () => ({
    context: { slot: 1900 },
    value: valid,
  }));
  const requestId = randomUUID();
  await pool.query(
    "INSERT INTO c3_eval.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at) VALUES($1,$2,'issue_shares',2,0,$3,$4,1000,clock_timestamp()-interval '1 minute')",
    [requestId, intent, Buffer.alloc(32, 7), String(payer)],
  );
  await pool.query(
    "INSERT INTO c3_eval.owner_packet_contexts(request_id,chain_time,configuration_hash,pre_accounts) VALUES($1,1,$2,$3)",
    [requestId, hashText("test"), Object.fromEntries(f.accounts)],
  );
  await assert.rejects(
    () => ownerService.closeExpired("test-session", requestId),
    /EXPIRY_BARRIER_NOT_FINALIZED/,
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM c3_eval.owner_request_outcomes"))
      .rows[0].count,
    "0",
  );
  valid = false;
  const closed = await Promise.all([
    ownerService.closeExpired("test-session", requestId),
    ownerService.closeExpired("test-session", requestId),
  ]);
  assert.ok(closed.every((v) => v.status === "closed_unexecuted"));
  assert.equal(
    (
      await pool.query(
        "SELECT db_revision FROM c3_eval.intents WHERE intent_id=$1",
        [intent],
      )
    ).rows[0].db_revision,
    "3",
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM c3_eval.owner_request_outcomes"))
      .rows[0].count,
    "1",
  );
  assert.equal(sends, 0);
  // Append-only renewal against real PG with mocked public RPC evidence.
  // No deployed identity, actual wallet callback, validator or settlement claim.
  const rf = await renewalFixture(1, 0),
    rid = randomUUID(),
    rrid = randomUUID();
  await pool.query(
    "INSERT INTO c3_eval.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,expires_at,state,db_revision,chain_revision) VALUES($1,$2,$3,$4,$5,$6,1000000,clock_timestamp()+interval '1 hour','buying',2,$7)",
    [
      rid,
      rf.c.config.wallet,
      String(rf.c.vault),
      rf.c.config.shareMint,
      String(rf.planAddress),
      hashText("renewal"),
      String(rf.r.revision),
    ],
  );
  await pool.query(
    "INSERT INTO c3_eval.legs(intent_id,ordinal) SELECT $1,n FROM generate_series(0,5) AS n",
    [rid],
  );
  const rr = (
    await pool.query("SELECT * FROM c3_eval.intents WHERE intent_id=$1", [rid])
  ).rows[0];
  const publicRpc = new Connection("https://api.devnet.solana.com"),
    restorePlan = (post = false) => ({
      context: { slot: 2000 },
      value: {
        owner: new PublicKey(EVALUATION.program),
        executable: false,
        lamports: 10000000,
        data: Buffer.from((post ? rf.post : rf.account).data[0], "base64"),
      },
    });
  let planIsPost = false;
  t.mock.method(Connection.prototype, "getAccountInfoAndContext", async () =>
    restorePlan(planIsPost),
  );
  t.mock.method(Connection.prototype, "getBlockTime", async () =>
    Number(rf.clock),
  );
  t.mock.method(Connection.prototype, "isBlockhashValid", async () => ({
    context: { slot: 1900 },
    value: valid,
  }));
  t.mock.method(publicRpc, "getBlockHeight", async () => 2000);
  const ritems = [
    {
      context: {
        kind: "execute",
        direction: 1,
        plan: String(rf.planAddress),
        ordinal: 0,
      },
      instructions: [evaluationCreatePlan(rf.c, 1, rf.clock).instruction],
      generation: "expired-reservation",
    },
  ];
  const rops = await Reflect.get(runtime, "reserveBatch").call(
    runtime,
    rf.c,
    rr,
    ritems,
  );
  valid = true;
  await assert.rejects(
    () =>
      captureEvaluationRenewal(
        pool,
        publicRpc,
        rf.c,
        rr,
        Number(rf.clock),
        1800,
      ),
    /ORIGINAL_PACKET_CAN_STILL_EXECUTE/,
  );
  valid = false;
  const barrier = await captureEvaluationRenewal(
    pool,
    publicRpc,
    rf.c,
    rr,
    Number(rf.clock),
    1800,
  );
  assert.deepEqual(barrier.operations, rops);
  await pool.query(
    "INSERT INTO c3_eval.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at) VALUES($1,$2,'renew_plan',2,$3,$4,$5,1000,clock_timestamp()+interval '45 seconds')",
    [
      rrid,
      rid,
      String(rf.r.revision),
      rf.compiled.messageHash,
      rf.compiled.blockhash,
    ],
  );
  await pool.query(
    "INSERT INTO c3_eval.renewal_requests(request_id,intent_id,plan,expected_db_revision,expected_chain_revision,expires_at,pre_state,message_hash,observed_slot,blockhash,last_valid_block_height) VALUES($1,$2,$3,2,$4,$5,$6,$7,1000,$8,1000)",
    [
      rrid,
      rid,
      String(rf.planAddress),
      String(rf.r.revision),
      rf.r.expires_at,
      rf.r.pre_state,
      rf.compiled.messageHash,
      rf.compiled.blockhash,
    ],
  );
  await pool.query(
    "INSERT INTO c3_eval.evaluation_renewal_contexts(request_id,direction,retired_operations,barrier_slot,evidence_hash) VALUES($1,1,$2,$3,$4)",
    [
      rrid,
      JSON.stringify(barrier.operations),
      barrier.barrierSlot,
      barrier.evidenceHash,
    ],
  );
  await pool.query(
    "INSERT INTO c3_eval.owner_submissions(request_id,signature,message_hash) VALUES($1,$2,$3)",
    [rrid, rf.r.signature, rf.compiled.messageHash],
  );
  await assert.rejects(
    () =>
      Reflect.get(runtime, "reserveBatch").call(runtime, rf.c, rr, [
        { ...ritems[0], generation: "race" },
      ]),
    /OWNER_REQUEST_PENDING/,
  );
  const originalOp = (
    await pool.query(
      "SELECT * FROM c3_eval.service_packets WHERE operation_id=$1",
      [rops[0]],
    )
  ).rows[0];
  const serviceRpc = Reflect.get(service, "rpc");
  t.mock.method(serviceRpc, "getBlockHeight", async () => 100);
  await assert.rejects(
    () =>
      service.dispatch(
        {
          operationId: originalOp.operation_id,
          scope: originalOp.scope,
          purpose: originalOp.purpose,
          packet: originalOp.unsigned_packet,
          lastValidBlockHeight: 1000,
        },
        { publicKey: EVALUATION.keeper, signMessage: mustNotSign },
      ),
    /OWNER_REQUEST_PENDING/,
  );
  planIsPost = true;
  const renewalService = new EvaluationOwnerService(pool, idl),
    recoverRenewal = () =>
      Reflect.get(renewalService, "reconcileRenewal").call(
        renewalService,
        rf.c,
        rrid,
        { signature: rf.r.signature },
        rf.evidence,
      );
  const renewResults = await Promise.all([recoverRenewal(), recoverRenewal()]);
  assert.ok(renewResults.some((v) => v.status === "effects_verified"));
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM c3_eval.plan_generations WHERE intent_id=$1",
        [rid],
      )
    ).rows[0].count,
    "1",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM c3_eval.service_retirements WHERE intent_id=$1",
        [rid],
      )
    ).rows[0].count,
    "1",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT db_revision,chain_revision FROM c3_eval.intents WHERE intent_id=$1",
        [rid],
      )
    ).rows[0].db_revision,
    "3",
  );
  const restartRenewal = new EvaluationOwnerService(pool, idl);
  assert.equal(
    (
      await Reflect.get(restartRenewal, "reconcileRenewal").call(
        restartRenewal,
        rf.c,
        rrid,
        { signature: rf.r.signature },
        rf.evidence,
      )
    ).status,
    "already_reconciled",
  );
  await assert.rejects(
    () =>
      pool.query("DELETE FROM c3_eval.service_packets WHERE operation_id=$1", [
        rops[0],
      ]),
    /IMMUTABLE/,
  );
  await assert.rejects(
    () =>
      service.dispatch(
        {
          operationId: originalOp.operation_id,
          scope: originalOp.scope,
          purpose: originalOp.purpose,
          packet: originalOp.unsigned_packet,
          lastValidBlockHeight: 1000,
        },
        { publicKey: EVALUATION.keeper, signMessage: mustNotSign },
      ),
    /INTENT_CAS|RETIRED/,
  );
  assert.equal(sends, 0);
  t.mock.method(
    Connection.prototype,
    "getGenesisHash",
    async () => "wrong-network",
  );
  await assert.rejects(
    () =>
      service.dispatch(input, {
        publicKey: EVALUATION.governance,
        signMessage: async () => {
          throw Error("MUST_NOT_SIGN");
        },
      }),
    /NETWORK/,
  );
});
function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
