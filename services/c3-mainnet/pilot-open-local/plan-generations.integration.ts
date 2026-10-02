/** Real disposable PostgreSQL; synthetic signed RPC fixtures, NOT Jupiter or MWA. */
import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import {
  applyOpenLocalMigration,
  OpenLocalSettlementRepository,
  type Scope,
} from "./orchestrator.ts";
import {
  prepareLocalRenewal,
  reconcileLocalRenewal,
  verifyRenewalImages,
  recordLocalRenewalSignature,
  resolveLocalRenewalOutcome,
} from "./plan-generations.ts";
import { VAULT_PROGRAM } from "./jupiter-vault-cpi-inspection.ts";
import { encodeBase58 } from "../src/solana.ts";
import { C3_MAINNET } from "../src/constants.ts";
import { loadOpenSignerRecord } from "./open-quote.ts";
import { OpenSigningJournal } from "../src/open-signing-journal.ts";
import { OwnerFlow } from "../../../apps/c3-pilot/src/owner-flow.ts";
import { inspectOwnerTransaction } from "../../../apps/c3-pilot/src/owner-transaction-review.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw Error("DISPOSABLE_DB_REQUIRED");
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
const idl = JSON.parse(
  readFileSync(
    new URL(
      "../../../programs/c3-pilot-vault/target/idl/c3_pilot_vault.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Idl;
const h = (s: string) => createHash("sha256").update(s).digest();
test("append-only owner generations, CAS and uncertainty preserve previous evidence", async (t) => {
  t.after(() => pool.end());
  const client = await pool.connect();
  try {
    await applyOpenLocalMigration(client);
  } finally {
    client.release();
  }
  async function fixture(bitmap = 0, direction = 1) {
    const owner = Keypair.generate(),
      share = Keypair.generate().publicKey,
      chainIntent = Keypair.generate().publicKey;
    const vault = PublicKey.findProgramAddressSync(
      [Buffer.from("c3-vault-v1")],
      VAULT_PROGRAM,
    )[0];
    const [plan, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("c3-plan-v1"), chainIntent.toBuffer()],
      VAULT_PROGRAM,
    );
    const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool),
      id = randomUUID();
    await db.createDraft({
      intentId: id,
      wallet: owner.publicKey.toBase58(),
      vault: vault.toBase58(),
      shareMint: share.toBase58(),
      depositPlan: plan.toBase58(),
      configurationHash: h("config").toString("hex"),
      expiresAt: new Date(Date.now() + 600000),
      idempotencyHash: h(randomUUID()).toString("hex"),
    });
    const revision = bitmap === 0 ? 0n : bitmap === 1 ? 1n : 2n;
    await pool.query(
      "UPDATE c3_open.intents SET state=$2,chain_revision=$3,db_revision=2,redemption_plan=$4 WHERE intent_id=$1",
      [
        id,
        direction === 1
          ? bitmap
            ? "buying"
            : "funded"
          : bitmap
            ? "selling"
            : "redemption_requested",
        revision.toString(),
        direction === 2 ? plan.toBase58() : null,
      ],
    );
    // Synthetic confirmed setup has full immutable evidence; no actual effects claimed.
    for (let ordinal = 0; ordinal < 3; ordinal++)
      if (bitmap & (1 << ordinal))
        await pool.query(
          `UPDATE c3_open.legs SET state='confirmed',chain_revision=$3,route_hash=$4,instruction_hash=$4,authorization_hash=$4,minimum_output=1,quote_expires_at=clock_timestamp(),submitted_signature=$5,evidence_hash=$4,observed_effects='{}' WHERE intent_id=$1 AND ordinal=$2`,
          [
            id,
            ordinal + (direction === 2 ? 3 : 0),
            String(ordinal + 1),
            h(randomUUID()).toString("hex"),
            encodeBase58(randomBytes(64)),
          ],
        );
    const pre = Buffer.alloc(901);
    h("account:SettlementPlan").subarray(0, 8).copy(pre);
    pre[8] = 2;
    pre.writeBigUInt64LE(1n, 9);
    vault.toBuffer().copy(pre, 17);
    chainIntent.toBuffer().copy(pre, 49);
    owner.publicKey.toBuffer().copy(pre, 81);
    share.toBuffer().copy(pre, 113);
    pre[145] = direction;
    pre.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000) - 1), 706);
    pre[714] = bitmap;
    pre[715] = direction === 1 ? (bitmap ? 2 : 1) : bitmap ? 5 : 4;
    pre.writeBigUInt64LE(revision, 716);
    pre[900] = bump;
    for (let n = 0; n < 3; n++) {
      pre.writeBigUInt64LE(1n, 672 + n * 8);
      pre.writeBigUInt64LE([400000n, 300000n, 300000n][n]!, 780 + n * 8);
      if (bitmap & (1 << n)) {
        pre.writeBigUInt64LE([400000n, 300000n, 300000n][n]!, 756 + n * 8);
        pre.writeBigUInt64LE(42n, 804 + n * 8);
      }
    }
    const config = Buffer.alloc(546);
    h("account:VaultConfig").subarray(0, 8).copy(config);
    config[8] = 1;
    config.writeBigUInt64LE(1n, 9);
    owner.publicKey.toBuffer().copy(config, 113); // 8+1+8+3*32
    share.toBuffer().copy(config, 274);
    [
      C3_MAINNET.usdcMint,
      C3_MAINNET.cbBtcMint,
      C3_MAINNET.portalEthMint,
      C3_MAINNET.wrappedSolMint,
    ].forEach((mint, i) =>
      new PublicKey(mint).toBuffer().copy(config, 146 + i * 32),
    );
    const clock = Buffer.alloc(40);
    clock.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 32);
    let post = Buffer.from(pre),
      transaction: VersionedTransaction | undefined;
    const account = (data: Buffer) => ({
      data,
      owner: VAULT_PROGRAM,
      lamports: 10000,
      executable: false,
    });
    const rpc = {
      rpcEndpoint: "http://127.0.0.1:9999",
      getGenesisHash: async () => Keypair.generate().publicKey.toBase58(),
      getMultipleAccountsInfoAndContext: async () => ({
        context: { slot: 100 },
        value: [
          account(config),
          account(pre),
          {
            ...account(clock),
            owner: new PublicKey("Sysvar1111111111111111111111111111111111111"),
          },
        ],
      }),
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 200,
      }),
      isBlockhashValid: async () => ({ context: { slot: 100 }, value: true }),
      getBlockHeight: async () => 201,
      getSlot: async () => 101,
      getSignatureStatuses: async () => ({
        context: { slot: 101 },
        value: [{ confirmationStatus: "finalized", err: null, slot: 101 }],
      }),
      getTransaction: async () => ({
        slot: 101,
        transaction: {
          message: transaction!.message,
          signatures: transaction!.signatures.map(encodeBase58),
        },
        meta: {
          err: null,
          fee: 5000,
          preBalances: [10000, 10000, 10000, 10000],
          postBalances: [5000, 10000, 10000, 10000],
          preTokenBalances: [],
          postTokenBalances: [],
          innerInstructions: [],
        },
      }),
      getAccountInfoAndContext: async () => ({
        context: { slot: 101 },
        value: account(post),
      }),
    } as unknown as Connection;
    const scope: Scope = {
      intentId: id,
      wallet: owner.publicKey.toBase58(),
      vault: vault.toBase58(),
      expectedDbRevision: 2n,
      expectedChainRevision: revision,
      idempotencyHash: h(randomUUID()).toString("hex"),
    };
    const prepare = (customScope = scope) =>
      prepareLocalRenewal(pool, rpc, idl, customScope);
    const signed = (r: Awaited<ReturnType<typeof prepareLocalRenewal>>) => {
      transaction = VersionedTransaction.deserialize(r.transaction);
      transaction.sign([owner]);
      post = Buffer.from(pre);
      post.writeBigUInt64LE(pre.readBigUInt64LE(716) + 1n, 716);
      post.writeBigInt64LE(r.expiresAt, 706);
      post.fill(0, 860, 900);
      return encodeBase58(transaction.signatures[0]!);
    };
    const record = async (
      r: Awaited<ReturnType<typeof prepareLocalRenewal>>,
      s = scope,
    ) => {
      assert.ok(transaction);
      return recordLocalRenewalSignature(
        pool,
        rpc,
        idl,
        s,
        r.requestId,
        transaction.serialize(),
      );
    };
    return {
      id,
      pre,
      clock,
      scope,
      rpc,
      prepare,
      signed,
      record,
      packet: () => transaction!.serialize(),
      post: () => post,
      db,
    };
  }
  await t.test(
    "owner, revision and every preserved byte including partial inventory",
    async () => {
      for (const [bitmap, direction] of [
        [0, 1],
        [1, 1],
        [3, 1],
        [0, 2],
        [1, 2],
        [3, 2],
      ]) {
        const f = await fixture(bitmap, direction);
        const pendingOrdinal =
          (bitmap === 0 ? 0 : bitmap === 1 ? 1 : 2) + (direction === 2 ? 3 : 0);
        const oldQuote = randomBytes(32),
          oldNonce = randomBytes(32),
          oldPayload = randomBytes(300),
          oldSignature = randomBytes(64);
        oldQuote.copy(oldPayload, 49);
        oldNonce.copy(oldPayload, 81);
        const oldAuthority = new PublicKey(f.scope.wallet).toBuffer();
        const oldPlan = (
          await pool.query(
            "SELECT deposit_plan FROM c3_open.intents WHERE intent_id=$1",
            [f.id],
          )
        ).rows[0].deposit_plan;
        await pool.query(
          "INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope) VALUES($1,$2,2,$3,$4,'LOCAL_MOCK')",
          [
            f.id,
            pendingOrdinal,
            {
              plan: oldPlan,
              planRevision: f.scope.expectedChainRevision.toString(),
            },
            h(randomUUID()),
          ],
        );
        await pool.query(
          `INSERT INTO c3_open.quote_authorizations(quote_id,nonce,intent_id,ordinal,intent_revision,canonical_payload,payload_hash,evidence,authority,signature,state,expires_at)
          VALUES($1,$2,$3,$4,2,$5,$6,'{}',$7,$8,'signed',clock_timestamp()+interval '20 seconds')`,
          [
            oldQuote,
            oldNonce,
            f.id,
            pendingOrdinal,
            oldPayload,
            createHash("sha256").update(oldPayload).digest(),
            oldAuthority,
            oldSignature,
          ],
        );
        await pool.query(
          `UPDATE c3_open.legs SET state='prepared',route_hash=$3,instruction_hash=$3,authorization_hash=$3,
          minimum_output=1,quote_expires_at=clock_timestamp()+interval '10 seconds',expected_effects='{}'
          WHERE intent_id=$1 AND ordinal=$2`,
          [f.id, pendingOrdinal, h(randomUUID()).toString("hex")],
        );
        const r = await f.prepare(),
          sig = f.signed(r);
        const resumed = await prepareLocalRenewal(pool, f.rpc, idl, f.scope, {
          resumeRequestId: r.requestId,
        });
        assert.deepEqual(
          resumed.transaction,
          r.transaction,
          "crash before delivery reconstructs exact bytes without storing the payload",
        );
        await f.record(r);
        await assert.rejects(
          () =>
            prepareLocalRenewal(pool, f.rpc, idl, f.scope, {
              replaceExpired: true,
            }),
          /RECONCILE_PENDING_FIRST/,
        );
        for (const offset of [
          17, 49, 81, 113, 145, 154, 576, 672, 714, 715, 756, 780, 804, 828,
          900,
        ]) {
          const mutated = Buffer.from(f.post());
          mutated[offset] = mutated[offset]! ^ 1;
          assert.throws(() =>
            verifyRenewalImages(
              f.pre,
              mutated,
              f.scope.expectedChainRevision,
              r.expiresAt,
            ),
          );
        }
        await assert.rejects(
          () =>
            prepareLocalRenewal(pool, f.rpc, idl, {
              ...f.scope,
              wallet: Keypair.generate().publicKey.toBase58(),
            }),
          /OWNER/,
        );
        await assert.rejects(
          () =>
            prepareLocalRenewal(pool, f.rpc, idl, {
              ...f.scope,
              expectedChainRevision: 99n,
            }),
          /CAS/,
        );
        const results = await Promise.allSettled([
          reconcileLocalRenewal(pool, f.rpc, idl, f.scope, r.requestId, sig),
          reconcileLocalRenewal(pool, f.rpc, idl, f.scope, r.requestId, sig),
        ]);
        assert.ok(results.some((x) => x.status === "fulfilled"));
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM c3_open.plan_generations WHERE intent_id=$1",
              [f.id],
            )
          ).rows[0].count,
          "1",
        );
        const old = (
          await pool.query(
            "SELECT state,canonical_payload,signature FROM c3_open.quote_authorizations WHERE quote_id=$1",
            [oldQuote],
          )
        ).rows[0];
        assert.equal(old.state, "manual_review");
        assert.deepEqual(old.canonical_payload, oldPayload);
        assert.deepEqual(old.signature, oldSignature);
        await assert.rejects(
          () =>
            loadOpenSignerRecord(pool, oldQuote.toString("hex"), oldAuthority),
          /NOT_SIGNABLE/,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT generation::text FROM c3_open.quote_generations WHERE quote_id=$1",
              [oldQuote],
            )
          ).rows[0].generation,
          "0",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM c3_open.leg_attempt_history WHERE intent_id=$1",
              [f.id],
            )
          ).rows[0].count,
          String(3 - (bitmap === 0 ? 0 : bitmap === 1 ? 1 : 2)),
        );
        assert.equal(
          (
            await reconcileLocalRenewal(
              pool,
              f.rpc,
              idl,
              f.scope,
              r.requestId,
              sig,
            )
          ).generation,
          1n,
          "restart/lost response returns prior result without a second effect",
        );
        await assert.rejects(
          () =>
            pool.query(
              "UPDATE c3_open.plan_generations SET generation=generation+1 WHERE intent_id=$1",
              [f.id],
            ),
          /IMMUTABLE/,
        );
        await assert.rejects(
          () =>
            pool.query(
              "DELETE FROM c3_open.leg_attempt_history WHERE intent_id=$1",
              [f.id],
            ),
          /IMMUTABLE/,
        );
        await assert.rejects(
          () =>
            pool.query(
              "UPDATE c3_open.intents SET expires_at=expires_at+interval '1 hour',db_revision=db_revision+1 WHERE intent_id=$1",
              [f.id],
            ),
          /EXPIRY_IMMUTABLE/,
        );
        const restart =
          await OpenLocalSettlementRepository.fromVerifiedPool(pool);
        assert.equal(
          (await restart.read(f.id))!.chainRevision,
          f.scope.expectedChainRevision + 1n,
        );
      }
    },
  );
  await t.test(
    "a second renewal appends generation two, preserving the first owner signature and archived attempts",
    async () => {
      const f = await fixture(1),
        r = await f.prepare(),
        sig = f.signed(r);
      await f.record(r);
      const proof = await reconcileLocalRenewal(
        pool,
        f.rpc,
        idl,
        f.scope,
        r.requestId,
        sig,
      );
      f.post().copy(f.pre);
      f.clock.writeBigInt64LE(r.expiresAt, 32);
      const nextScope = {
        ...f.scope,
        expectedDbRevision: proof.dbRevision,
        expectedChainRevision: proof.chainRevision,
      };
      const next = await f.prepare(nextScope),
        nextSig = f.signed(next);
      await f.record(next, nextScope);
      const second = await reconcileLocalRenewal(
        pool,
        f.rpc,
        idl,
        nextScope,
        next.requestId,
        nextSig,
      );
      assert.equal(second.generation, 2n);
      assert.equal(second.chainRevision, 3n);
      assert.deepEqual(
        (
          await pool.query(
            "SELECT generation::text,renewal_signature FROM c3_open.plan_generations WHERE intent_id=$1 ORDER BY generation",
            [f.id],
          )
        ).rows,
        [
          { generation: "1", renewal_signature: sig },
          { generation: "2", renewal_signature: nextSig },
        ],
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.leg_attempt_history WHERE intent_id=$1",
            [f.id],
          )
        ).rows[0].count,
        "4",
      );
      await assert.rejects(
        () =>
          recordLocalRenewalSignature(
            pool,
            f.rpc,
            idl,
            { ...f.scope, expectedChainRevision: 1n },
            r.requestId,
            f.packet(),
          ),
        /EXACT_OWNER_MESSAGE/,
      );
    },
  );
  await t.test(
    "durable owner signature blocks replacement after restart and is immutable/idempotent",
    async () => {
      const f = await fixture();
      const r = await f.prepare();
      const sig = f.signed(r);
      assert.equal(await f.record(r), sig);
      assert.equal(await f.record(r), sig);
      await assert.rejects(f.prepare, /RECONCILE_PENDING_FIRST/);
      await assert.rejects(
        () =>
          pool.query(
            "DELETE FROM c3_open.renewal_submissions WHERE request_id=$1",
            [r.requestId],
          ),
        /IMMUTABLE/,
      );
      const previous = f.rpc.getSignatureStatuses;
      f.rpc.getSignatureStatuses = async () => ({
        context: { slot: 100 },
        value: [null],
      });
      await assert.rejects(
        () =>
          reconcileLocalRenewal(pool, f.rpc, idl, f.scope, r.requestId, sig),
        /FINALITY_REQUIRED/,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT signature FROM c3_open.renewal_submissions WHERE request_id=$1",
            [r.requestId],
          )
        ).rows[0].signature,
        sig,
      );
      f.rpc.getSignatureStatuses = previous;
      await reconcileLocalRenewal(pool, f.rpc, idl, f.scope, r.requestId, sig);
    },
  );
  await t.test(
    "benign lease revision permits exact resume, but replacement requires both expired message and dead blockhash",
    async () => {
      const f = await fixture();
      const r = await f.prepare();
      await pool.query(
        "UPDATE c3_open.intents SET db_revision=db_revision+1 WHERE intent_id=$1",
        [f.id],
      );
      const next = { ...f.scope, expectedDbRevision: 3n };
      const resumed = await prepareLocalRenewal(pool, f.rpc, idl, next, {
        resumeRequestId: r.requestId,
      });
      assert.deepEqual(resumed.transaction, r.transaction);
      await assert.rejects(
        () =>
          prepareLocalRenewal(pool, f.rpc, idl, next, { replaceExpired: true }),
        /EXPLICIT_RESUME/,
      );
      f.clock.writeBigInt64LE(r.expiresAt, 32);
      await assert.rejects(
        () =>
          prepareLocalRenewal(pool, f.rpc, idl, next, { replaceExpired: true }),
        /EXPLICIT_RESUME/,
      );
      f.rpc.isBlockhashValid = async () => ({
        context: { slot: 100 },
        value: false,
      });
      const replacement = await prepareLocalRenewal(pool, f.rpc, idl, next, {
        replaceExpired: true,
      });
      assert.notEqual(replacement.requestId, r.requestId);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.renewal_requests WHERE intent_id=$1",
            [f.id],
          )
        ).rows[0].count,
        "2",
      );
      const sig = f.signed(replacement);
      await f.record(replacement, next);
      await reconcileLocalRenewal(
        pool,
        f.rpc,
        idl,
        next,
        replacement.requestId,
        sig,
      );
    },
  );
  await t.test(
    "terminal append-only resolution requires failed finality or expired validity plus unchanged plan; null alone is uncertain",
    async () => {
      for (const failed of [false, true]) {
        const f = await fixture(),
          r = await f.prepare();
        const sig = f.signed(r);
        await f.record(r);
        const actual = f.rpc.getTransaction;
        f.rpc.getAccountInfoAndContext = async () => ({
          context: { slot: 101 },
          value: {
            data: f.pre,
            owner: VAULT_PROGRAM,
            lamports: 10000,
            executable: false,
            rentEpoch: 0,
          },
        });
        if (failed) {
          f.rpc.getSignatureStatuses = async () => ({
            context: { slot: 101 },
            value: [
              {
                slot: 101,
                confirmations: null,
                confirmationStatus: "finalized",
                err: { InstructionError: [0, "Custom"] },
              },
            ],
          });
          f.rpc.getTransaction = (async () => ({
            ...(await actual(sig, {
              commitment: "finalized",
              maxSupportedTransactionVersion: 0,
            })),
            meta: {
              ...(await actual(sig, {
                commitment: "finalized",
                maxSupportedTransactionVersion: 0,
              }))!.meta!,
              err: { InstructionError: [0, "Custom"] },
            },
          })) as Connection["getTransaction"];
        } else {
          f.rpc.getSignatureStatuses = async () => ({
            context: { slot: 101 },
            value: [null],
          });
          f.rpc.getTransaction = async () => null;
          f.rpc.getBlockHeight = async () => 201;
          await assert.rejects(
            () =>
              resolveLocalRenewalOutcome(
                pool,
                f.rpc,
                idl,
                f.scope,
                r.requestId,
              ),
            /UNCERTAIN_RENEWAL/,
          );
          f.rpc.isBlockhashValid = async () => ({
            context: { slot: 101 },
            value: false,
          });
        }
        const outcome = await resolveLocalRenewalOutcome(
          pool,
          f.rpc,
          idl,
          f.scope,
          r.requestId,
        );
        assert.equal(
          outcome.disposition,
          failed ? "failed_finalized" : "expired_unexecuted",
        );
        await resolveLocalRenewalOutcome(
          pool,
          f.rpc,
          idl,
          f.scope,
          r.requestId,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*) FROM c3_open.renewal_outcomes WHERE request_id=$1",
              [r.requestId],
            )
          ).rows[0].count,
          "1",
        );
        assert.equal(
          (
            await pool.query(
              "SELECT signature FROM c3_open.renewal_submissions WHERE request_id=$1",
              [r.requestId],
            )
          ).rows[0].signature,
          sig,
        );
        await assert.rejects(
          () =>
            pool.query(
              "DELETE FROM c3_open.renewal_outcomes WHERE request_id=$1",
              [r.requestId],
            ),
          /IMMUTABLE/,
        );
        f.clock.writeBigInt64LE(r.expiresAt, 32);
        f.rpc.isBlockhashValid = async () => ({
          context: { slot: 101 },
          value: false,
        });
        const replacement = await prepareLocalRenewal(
          pool,
          f.rpc,
          idl,
          { ...f.scope, expectedDbRevision: outcome.dbRevision },
          { replaceExpired: true },
        );
        assert.notEqual(replacement.requestId, r.requestId);
      }
    },
  );
  await t.test(
    "expiry barrier precedes absence; execution during expiry checks never resolves as unexecuted",
    async () => {
      const f = await fixture(),
        r = await f.prepare();
      const sig = f.signed(r);
      await f.record(r);
      let finalized = false;
      const order: string[] = [];
      const actual = f.rpc.getTransaction;
      f.rpc.isBlockhashValid = async () => {
        order.push("expiry");
        finalized = true;
        return { context: { slot: 101 }, value: false };
      };
      f.rpc.getSignatureStatuses = async () => {
        order.push("status");
        return {
          context: { slot: 101 },
          value: [
            finalized
              ? {
                  slot: 101,
                  confirmations: null,
                  err: null,
                  confirmationStatus: "finalized" as const,
                }
              : null,
          ],
        };
      };
      f.rpc.getTransaction = (async () =>
        finalized
          ? actual(sig, {
              commitment: "finalized",
              maxSupportedTransactionVersion: 0,
            })
          : null) as Connection["getTransaction"];
      await assert.rejects(
        () =>
          resolveLocalRenewalOutcome(pool, f.rpc, idl, f.scope, r.requestId),
        /UNCHANGED_FINALIZED_PLAN_REQUIRED|UNCERTAIN_RENEWAL/,
      );
      assert.deepEqual(order, ["expiry", "status"]);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.renewal_outcomes WHERE request_id=$1",
            [r.requestId],
          )
        ).rows[0].count,
        "0",
      );
      await reconcileLocalRenewal(pool, f.rpc, idl, f.scope, r.requestId, sig);
      await assert.rejects(
        () =>
          resolveLocalRenewalOutcome(pool, f.rpc, idl, f.scope, r.requestId),
        /CAS_OR_OWNER|ALREADY_EXECUTED/,
      );
    },
  );
  await t.test(
    "terminal failure wins over a later contradictory generation and bumps the common CAS revision",
    async () => {
      const f = await fixture(),
        r = await f.prepare();
      const sig = f.signed(r);
      await f.record(r);
      const status = f.rpc.getSignatureStatuses,
        transaction = f.rpc.getTransaction,
        state = f.rpc.getAccountInfoAndContext;
      f.rpc.isBlockhashValid = async () => ({
        context: { slot: 101 },
        value: false,
      });
      f.rpc.getSignatureStatuses = async () => ({
        context: { slot: 101 },
        value: [null],
      });
      f.rpc.getTransaction = async () => null;
      f.rpc.getAccountInfoAndContext = async () => ({
        context: { slot: 101 },
        value: {
          data: f.pre,
          owner: VAULT_PROGRAM,
          lamports: 10000,
          executable: false,
          rentEpoch: 0,
        },
      });
      const result = await resolveLocalRenewalOutcome(
        pool,
        f.rpc,
        idl,
        f.scope,
        r.requestId,
      );
      assert.equal(result.dbRevision, 3n);
      f.rpc.getSignatureStatuses = status;
      f.rpc.getTransaction = transaction;
      f.rpc.getAccountInfoAndContext = state;
      await assert.rejects(
        () =>
          reconcileLocalRenewal(
            pool,
            f.rpc,
            idl,
            { ...f.scope, expectedDbRevision: 3n },
            r.requestId,
            sig,
          ),
        /RESULT_CONFLICT/,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.plan_generations WHERE request_id=$1",
            [r.requestId],
          )
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await resolveLocalRenewalOutcome(
            pool,
            f.rpc,
            idl,
            f.scope,
            r.requestId,
          )
        ).dbRevision,
        3n,
        "cached terminal result survives restart and old CAS without RPC reclassification",
      );
    },
  );
  await t.test(
    "late signature for a replaced unsigned request cannot block its replacement",
    async () => {
      const f = await fixture(),
        r = await f.prepare();
      f.signed(r);
      const old = f.packet();
      f.clock.writeBigInt64LE(r.expiresAt, 32);
      f.rpc.isBlockhashValid = async () => ({
        context: { slot: 101 },
        value: false,
      });
      const next = await prepareLocalRenewal(pool, f.rpc, idl, f.scope, {
        replaceExpired: true,
      });
      await assert.rejects(
        () =>
          recordLocalRenewalSignature(
            pool,
            f.rpc,
            idl,
            f.scope,
            r.requestId,
            old,
          ),
        /OBSOLETE_RENEWAL_REQUEST/,
      );
      f.signed(next);
      await f.record(next);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.renewal_submissions s JOIN c3_open.renewal_requests r USING(request_id) WHERE r.intent_id=$1",
            [f.id],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "pending/uncertain signatures prevent incompatible renewal without deletion",
    async () => {
      const f = await fixture();
      await pool.query(
        `UPDATE c3_open.legs SET state='uncertain',route_hash=$2,instruction_hash=$2,authorization_hash=$2,minimum_output=1,quote_expires_at=clock_timestamp(),submitted_signature=$3,submitted_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=0`,
        [
          f.id,
          h(randomUUID()).toString("hex"),
          encodeBase58(Buffer.alloc(64, 99)),
        ],
      );
      await assert.rejects(f.prepare, /RECONCILE_PENDING_FIRST/);
      assert.equal(
        (
          await pool.query(
            "SELECT submitted_signature FROM c3_open.legs WHERE intent_id=$1 AND ordinal=0",
            [f.id],
          )
        ).rows[0].submitted_signature,
        encodeBase58(Buffer.alloc(64, 99)),
      );
    },
  );
  await t.test(
    "signer dispatch and wallet renewal serialize in both orders; remote uncertainty is never erased",
    async () => {
      for (const renewalFirst of [false, true]) {
        const f = await fixture(),
          r = await f.prepare();
        const quote = randomBytes(32),
          nonce = randomBytes(32),
          payload = randomBytes(300),
          authority = new PublicKey(f.scope.wallet).toBuffer();
        quote.copy(payload, 49);
        nonce.copy(payload, 81);
        await pool.query(
          "INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope) VALUES($1,0,2,$2,$3,'LOCAL_MOCK')",
          [f.id, { plan: r.plan, planRevision: "0" }, h(randomUUID())],
        );
        await pool.query(
          "INSERT INTO c3_open.quote_authorizations(quote_id,nonce,intent_id,ordinal,intent_revision,canonical_payload,payload_hash,evidence,authority,state,expires_at) VALUES($1,$2,$3,0,2,$4,$5,'{}',$6,'prepared',clock_timestamp()+interval '30 seconds')",
          [
            quote,
            nonce,
            f.id,
            payload,
            createHash("sha256").update(payload).digest(),
            authority,
          ],
        );
        let calls = 0,
          release!: () => void,
          entered!: () => void;
        const hold = new Promise<void>((resolve) => {
          release = resolve;
        });
        const entry = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const journal = new OpenSigningJournal(pool, {
          publicKey: authority,
          signIdempotently: async () => {
            calls++;
            entered();
            await hold;
            throw Error("lost remote result");
          },
          lookupSignature: async () => null,
        });
        if (renewalFirst) {
          f.signed(r);
          await f.record(r);
          await assert.rejects(
            () => journal.obtain(quote, payload, authority),
            /UNCERTAIN_OR_REJECTED/,
          );
          assert.equal(calls, 0);
        } else {
          const flight = journal.obtain(quote, payload, authority);
          const failed = assert.rejects(() => flight, /UNCERTAIN_OR_REJECTED/);
          await entry;
          f.signed(r);
          await assert.rejects(() => f.record(r), /RECONCILE_PENDING_FIRST/);
          await assert.rejects(f.prepare, /RECONCILE_PENDING_FIRST/);
          release();
          await failed;
          await assert.rejects(
            () =>
              new OpenSigningJournal(pool, {
                publicKey: authority,
                signIdempotently: async () => {
                  throw Error("must not re-sign");
                },
                lookupSignature: async () => null,
              }).obtain(quote, payload, authority),
            /UNCERTAIN_OR_REJECTED/,
          );
          assert.equal(calls, 1);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*) FROM c3_open.signing_requests WHERE quote_id=$1",
                [quote],
              )
            ).rows[0].count,
            "1",
          );
          await assert.rejects(f.prepare, /RECONCILE_PENDING_FIRST/);
        }
      }
    },
  );
  await t.test(
    "two PostgreSQL connections: terminal outcome invalidates a reconcile snapshot taken before the intent lock",
    async () => {
      const f = await fixture(),
        r = await f.prepare();
      const sig = f.signed(r);
      await f.record(r);
      let snapshotReady!: () => void, unlock!: () => void;
      const ready = new Promise<void>((resolve) => {
        snapshotReady = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const delayedPool = new Proxy(pool, {
        get(target, key) {
          if (key === "connect")
            return async () => {
              const client = await target.connect();
              return new Proxy(client, {
                get(connection, field) {
                  if (field === "query")
                    return async (sql: string, values?: unknown[]) => {
                      const result = await connection.query(sql, values);
                      if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE") {
                        await connection.query(
                          "SELECT db_revision FROM c3_open.intents WHERE intent_id=$1",
                          [f.id],
                        );
                        snapshotReady();
                        await hold;
                      }
                      return result;
                    };
                  const value = Reflect.get(connection, field);
                  return typeof value === "function"
                    ? value.bind(connection)
                    : value;
                },
              });
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const flight = reconcileLocalRenewal(
        delayedPool,
        f.rpc,
        idl,
        f.scope,
        r.requestId,
        sig,
      );
      const rejected = assert.rejects(
        () => flight,
        /could not serialize|RESULT_CONFLICT|CAS_OR_OWNER/,
      );
      await ready;
      const absent = Object.assign(Object.create(f.rpc) as Connection, {
        isBlockhashValid: async () => ({
          context: { slot: 101 },
          value: false,
        }),
        getSignatureStatuses: async () => ({
          context: { slot: 101 },
          value: [null],
        }),
        getTransaction: async () => null,
        getAccountInfoAndContext: async () => ({
          context: { slot: 101 },
          value: {
            data: f.pre,
            owner: VAULT_PROGRAM,
            lamports: 10000,
            executable: false,
            rentEpoch: 0,
          },
        }),
      });
      try {
        await resolveLocalRenewalOutcome(
          pool,
          absent,
          idl,
          f.scope,
          r.requestId,
        );
      } finally {
        unlock();
      }
      await rejected;
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.renewal_outcomes WHERE request_id=$1",
            [r.requestId],
          )
        ).rows[0].count,
        "1",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.plan_generations WHERE request_id=$1",
            [r.requestId],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "PostgreSQL renewal packet passes mobile review and explicit MWA-compatible isolated response before durable receipt",
    async () => {
      const f = await fixture(1),
        r = await f.prepare();
      const data = Buffer.alloc(24);
      createHash("sha256")
        .update("global:renew_settlement_plan")
        .digest()
        .subarray(0, 8)
        .copy(data);
      data.writeBigUInt64LE(f.scope.expectedChainRevision, 8);
      data.writeBigInt64LE(r.expiresAt, 16);
      const expected = [
        {
          program: VAULT_PROGRAM.toBuffer(),
          accounts: [
            {
              key: new PublicKey(f.scope.wallet).toBuffer(),
              signer: true,
              writable: true,
            },
            {
              key: new PublicKey(f.scope.vault).toBuffer(),
              signer: false,
              writable: false,
            },
            {
              key: new PublicKey(r.plan).toBuffer(),
              signer: false,
              writable: true,
            },
          ],
          data,
        },
      ];
      const review = inspectOwnerTransaction(
        r.transaction,
        new PublicKey(f.scope.wallet).toBuffer(),
        expected,
      );
      const flow = new OwnerFlow();
      flow.start(
        r.requestId,
        createHash("sha256").update(review.message).digest("hex"),
      );
      flow.review();
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM c3_open.renewal_submissions WHERE request_id=$1",
            [r.requestId],
          )
        ).rows[0].count,
        "0",
      );
      // Protocol-shaped isolated adapter with an ephemeral local owner. This is
      // NOT Phantom, a physical MWA session, or evidence of explicit user approval.
      let approved = false,
        calls = 0;
      const signTransactions = async ({ payloads }: { payloads: string[] }) => {
        assert.equal(approved, true);
        calls++;
        assert.deepEqual(
          Buffer.from(payloads[0]!, "base64"),
          Buffer.from(r.transaction),
        );
        f.signed(r);
        return {
          signed_payloads: [Buffer.from(f.packet()).toString("base64")],
        };
      };
      approved = true;
      flow.authorize();
      const response = await signTransactions({
        payloads: [Buffer.from(r.transaction).toString("base64")],
      });
      const bytes = Buffer.from(response.signed_payloads[0]!, "base64");
      const after = inspectOwnerTransaction(
        bytes,
        new PublicKey(f.scope.wallet).toBuffer(),
        expected,
        true,
      );
      assert.deepEqual(after.message, review.message);
      const sig = await recordLocalRenewalSignature(
        pool,
        f.rpc,
        idl,
        f.scope,
        r.requestId,
        bytes,
      );
      flow.signed(sig);
      flow.interrupted();
      assert.throws(() => flow.start(r.requestId, "b".repeat(64)));
      const proof = await reconcileLocalRenewal(
        pool,
        f.rpc,
        idl,
        f.scope,
        r.requestId,
        sig,
      );
      flow.finalized(sig);
      assert.equal(proof.generation, 1n);
      assert.equal(calls, 1);
    },
  );
});
