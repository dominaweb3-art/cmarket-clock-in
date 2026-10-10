/** Disposable PostgreSQL + account fixtures + ephemeral quote key ONLY.
 * No chain, wallet, transaction signer, hosted identity or secret is accessed.
 * These tests prove journal semantics, not physical/Devnet settlement. */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import pg from "pg";
import { evaluationContextFixture } from "./evaluation-leg-context.test.ts";
import { EvaluationQuoteService } from "../src/evaluation-quote-service.ts";
import { EvaluationOwnerService } from "../src/evaluation-owner-service.ts";
import { evaluationJournalPool, EVALUATION } from "../src/evaluation-scope.ts";
import { evaluationTestRoute } from "../src/evaluation-route.ts";
import { OpenSigningJournal } from "../src/open-signing-journal.ts";
import { StoredEvaluationQuoteSigner } from "../src/evaluation-stored-signer.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw Error("DISPOSABLE_DB_REQUIRED");
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
test("Devnet quote preparation and existing signer journal use real PG CAS/triggers", async (t) => {
  t.after(() => pool.end());
  const sql = execFileSync(
    process.execPath,
    ["../../scripts/c3-evaluation-schema.mjs"],
    { encoding: "utf8" },
  );
  await pool.query(sql);
  const f = await evaluationContextFixture(
    1,
    0,
    BigInt(Math.floor(Date.now() / 1000)),
  );
  const intent = randomUUID();
  await pool.query(
    `INSERT INTO c3_eval.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,created_at,expires_at,state,db_revision)
    VALUES($1,$2,$3,$4,$5,$6,1000000,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour','buying',2)`,
    [
      intent,
      f.c.config.wallet,
      f.c.vault.toBase58(),
      f.c.config.shareMint,
      f.planAddress.toBase58(),
      hash("test").toString("hex"),
    ],
  );
  await pool.query(
    "INSERT INTO c3_eval.legs(intent_id,ordinal) SELECT $1,n FROM generate_series(0,5) AS n",
    [intent],
  );
  let captures = 0;
  t.mock.method(EvaluationOwnerService.prototype, "context", async () => {
    captures++;
    return {
      proof: { wallet: f.c.config.wallet, challengeId: randomUUID() },
      client: f.c,
      accounts: f.accounts,
      slot: Number(f.snapshot.slot),
    };
  });
  t.mock.method(
    Connection.prototype,
    "getGenesisHash",
    async () => EVALUATION.genesis,
  );
  t.mock.method(Connection.prototype, "getBlockTime", async () =>
    Number(f.snapshot.chainTime),
  );
  t.mock.method(Connection.prototype, "getLatestBlockhash", async () => ({
    blockhash: PublicKey.default.toBase58(),
    lastValidBlockHeight: 9999,
  }));
  t.mock.method(
    Connection.prototype,
    "getMultipleAccountsInfoAndContext",
    async (addresses: PublicKey[]) => ({
      context: { slot: Number(f.snapshot.slot) },
      value: addresses.map((key) => {
        const a = f.accounts.get(key.toBase58());
        return a
          ? {
              ...a,
              owner: new PublicKey(a.owner),
              lamports: 1_000_000,
              data: Buffer.from(a.data[0]!, "base64"),
            }
          : null;
      }),
    }),
  );
  const service = new EvaluationQuoteService(pool, f.c.idl);
  const prepared = await Promise.all([
    service.prepare("test-only-session"),
    service.prepare("test-only-session"),
  ]);
  assert.equal(prepared[0]!.quoteId, prepared[1]!.quoteId);
  assert.equal(
    (await pool.query("SELECT count(*) FROM c3_eval.quote_authorizations"))
      .rows[0].count,
    "1",
  );
  assert.equal(
    (
      await new EvaluationQuoteService(pool, f.c.idl).prepare(
        "test-only-session",
      )
    ).quoteId,
    prepared[0]!.quoteId,
  );
  const q = (
    await pool.query(
      "SELECT * FROM c3_eval.quote_authorizations WHERE quote_id=$1",
      [Buffer.from(prepared[0]!.quoteId, "hex")],
    )
  ).rows[0];
  assert.equal(q.canonical_payload.length, 300);
  assert.equal(
    (await pool.query("SELECT count(*) FROM c3_eval.quote_generations")).rows[0]
      .count,
    "1",
  );
  await assert.rejects(
    () =>
      pool.query(
        "UPDATE c3_eval.quote_authorizations SET canonical_payload=$2,revision=revision+1 WHERE quote_id=$1",
        [q.quote_id, Buffer.alloc(300)],
      ),
    /IMMUTABLE/,
  );
  let called = 0;
  await assert.rejects(
    () =>
      service.signStored("test-only-session", prepared[0]!.quoteId, {
        publicKey: randomBytes(32),
        signIdempotently: async () => {
          called++;
          return Buffer.alloc(64);
        },
        lookupSignature: async () => null,
      }),
    /REJECTED/,
  );
  assert.equal(called, 0);
  // Enrollment lifetime is not the funded plan lifetime. A verified live plan
  // can continue after a long restart; the original intent is never replaced.
  await assert.rejects(
    () =>
      pool.query(
        "UPDATE c3_eval.intents SET expires_at=clock_timestamp()+interval '1 hour' WHERE intent_id=$1",
        [intent],
      ),
    /ORIGINAL_EXPIRY_IMMUTABLE/,
  );
  const before = captures;
  await assert.rejects(
    () =>
      service.prepareAndSign("test-only-session", {
        publicKey: randomBytes(32),
        signIdempotently: async () => {
          called++;
          return Buffer.alloc(64);
        },
        lookupSignature: async () => null,
      }),
    /REJECTED/,
  );
  assert.equal(
    captures - before,
    1,
    "one server-owned finalized capture per request",
  );
  assert.equal(called, 0, "untrusted provider still cannot sign");
  const originalPlan = f.accounts.get(f.planAddress.toBase58())!;
  const expiredPlan = Buffer.from(originalPlan.data[0]!, "base64");
  expiredPlan.writeBigInt64LE(f.snapshot.chainTime, 706);
  f.accounts.set(f.planAddress.toBase58(), {
    ...originalPlan,
    data: [expiredPlan.toString("base64"), "base64"],
  });
  await assert.rejects(
    () => service.prepare("test-only-session"),
    /EXPIRED_OR_SLIPPAGE/,
  );
  f.accounts.set(f.planAddress.toBase58(), originalPlan);
  await pool.query(
    "UPDATE c3_eval.intents SET db_revision=db_revision+1 WHERE intent_id=$1",
    [intent],
  );
  await assert.rejects(
    () =>
      service.signStored("test-only-session", prepared[0]!.quoteId, {
        publicKey: new PublicKey(EVALUATION.quotes).toBytes(),
        signIdempotently: async () => {
          called++;
          return Buffer.alloc(64);
        },
        lookupSignature: async () => null,
      }),
    /STORED_RECORD/,
  );
  assert.equal(called, 0);

  await t.test(
    "ephemeral provider commits before reply; restart/lost reply/concurrency do not resign",
    async () => {
      // Independent synthetic persisted quote: no claim that this key is the
      // deployed evaluation authority or that these fixture accounts exist on-chain.
      const key = generateKeyPairSync("ed25519");
      const provider = new StoredEvaluationQuoteSigner(pool, key.privateKey);
      const f2 = await evaluationContextFixture(
        1,
        0,
        BigInt(Math.floor(Date.now() / 1000)),
      );
      const id = randomUUID(),
        route = evaluationTestRoute(f2.c, f2.verify(), randomBytes(32));
      await pool.query(
        `INSERT INTO c3_eval.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,expires_at,state,db_revision)
      VALUES($1,$2,$3,$4,$5,$6,1000000,clock_timestamp()+interval '1 hour','buying',2)`,
        [
          id,
          f2.c.config.wallet,
          f2.c.vault.toBase58(),
          f2.c.config.shareMint,
          f2.planAddress.toBase58(),
          hash("test").toString("hex"),
        ],
      );
      await pool.query(
        "INSERT INTO c3_eval.legs(intent_id,ordinal) SELECT $1,n FROM generate_series(0,5) AS n",
        [id],
      );
      await pool.query(
        `INSERT INTO c3_eval.leg_context_verifications(verification_id,intent_id,ordinal,intent_revision,context_hash,policy_hash,evidence_hash,genesis_hash,scope,finalized_slot,context,evidence)
      VALUES($1,$2,0,2,$3,$4,$4,$5,'ISOLATED_VERIFIED',1000,$6,'{"fixture":true}')`,
        [
          randomUUID(),
          id,
          route.seal.contextHash,
          hash("test"),
          EVALUATION.genesis,
          { plan: f2.planAddress.toBase58(), planRevision: "0" },
        ],
      );
      await pool.query(
        `INSERT INTO c3_eval.quote_authorizations(quote_id,nonce,intent_id,ordinal,intent_revision,canonical_payload,payload_hash,evidence,authority,expires_at)
      VALUES($1,$2,$3,0,2,$4,$5,'{"fixture":true}',$6,to_timestamp($7))`,
        [
          route.seal.quoteId,
          route.seal.nonce,
          id,
          route.payload,
          hash(route.payload),
          provider.publicKey,
          route.seal.expiresAt.toString(),
        ],
      );
      let signCalls = 0,
        lost = true;
      const transport = {
        publicKey: provider.publicKey,
        signIdempotently: async (rid: string, bytes: Uint8Array) => {
          signCalls++;
          const signature = await provider.signIdempotently(rid, bytes);
          const row = (
            await pool.query(
              "SELECT state,signature FROM c3_eval.signing_requests WHERE request_id=$1",
              [Buffer.from(rid, "hex")],
            )
          ).rows[0];
          assert.equal(row.state, "result");
          assert.deepEqual(row.signature, signature);
          if (lost) {
            lost = false;
            throw Error("test lost reply after durable commit");
          }
          return signature;
        },
        lookupSignature: (rid: string) =>
          new StoredEvaluationQuoteSigner(pool, key.privateKey).lookupSignature(
            rid,
          ),
      };
      const journal = () =>
        new OpenSigningJournal(evaluationJournalPool(pool), transport);
      await assert.rejects(
        () =>
          journal().obtain(
            Buffer.from(route.seal.quoteId),
            route.payload,
            Buffer.from(provider.publicKey),
          ),
        /UNCERTAIN/,
      );
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          journal().obtain(
            Buffer.from(route.seal.quoteId),
            route.payload,
            Buffer.from(provider.publicKey),
          ),
        ),
      );
      assert.equal(signCalls, 1);
      assert.equal(results[0]!.length, 64);
      results.forEach((r) => assert.deepEqual(r, results[0]));
      await assert.rejects(
        () =>
          pool.query("DELETE FROM c3_eval.signing_requests WHERE quote_id=$1", [
            route.seal.quoteId,
          ]),
        /IMMUTABLE/,
      );
      await assert.rejects(
        () =>
          pool.query(
            "UPDATE c3_eval.signing_requests SET signature=$2,revision=revision+1 WHERE quote_id=$1",
            [route.seal.quoteId, Buffer.alloc(64)],
          ),
        /IMMUTABLE/,
      );
      const corrupted = Buffer.from(route.payload);
      corrupted[121] = corrupted[121]! ^ 1;
      await assert.rejects(
        () => provider.signIdempotently("a".repeat(64), corrupted),
        /NOT_DISPATCHED|CANONICAL/,
      );
      await assert.rejects(
        () => provider.signIdempotently("a".repeat(64), Buffer.alloc(300)),
        /DOMAIN/,
      );
      assert.equal(await provider.lookupSignature("a".repeat(64)), null);
    },
  );
});
