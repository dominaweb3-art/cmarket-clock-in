/** Real disposable PG, shared production compiler/repository, in-memory PUBLIC
 * account evidence and ephemeral test signature. NOT Jupiter or Mainnet QA. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { VersionedTransaction } from "@solana/web3.js";
import { compilerFixture } from "../tests/open-owner-compiler.test.ts";
import {
  applyReviewedOpenSchema,
  verifyOpenOwnerSchema,
  enrollOpenOwner,
} from "../src/open-owner-schema.ts";
import {
  prepareOwnerFromDurableState,
  readOwnerPosition,
} from "../src/open-owner-service.ts";
import { OpenOwnerJournal } from "../src/open-owner-journal.ts";
import { verifiedGenerationDeadline } from "../src/open-production-signer.ts";
import {
  issueOpenEnrollmentChallenge,
  enrollmentRequestMessage,
} from "../src/open-owner-enrollment.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw Error("DISPOSABLE_DB_REQUIRED");
test("shared compiler enrollment, manifest, authentication and submission durability", async (t) => {
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  t.after(() => pool.end());
  await applyReviewedOpenSchema(pool);
  await applyReviewedOpenSchema(pool);
  await verifyOpenOwnerSchema(pool);
  const f = compilerFixture(),
    now = Math.floor(Date.now() / 1000),
    clock = Buffer.alloc(40);
  clock.writeBigInt64LE(BigInt(now), 32);
  f.accounts["SysvarC1ock11111111111111111111111111111111"] = f.raw(
    clock,
    "Sysvar1111111111111111111111111111111111111",
  );
  const origin = "https://cmarket.example.org";
  const ownerPrivate = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(f.wallet.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const proof = async () => {
    const nonce = randomBytes(32).toString("hex"),
      requestedAtUnix = Math.floor(Date.now() / 1000);
    const challenge = await issueOpenEnrollmentChallenge(
      pool,
      f.policy,
      origin,
      {
        nonce,
        requestedAtUnix,
        signature: sign(
          null,
          enrollmentRequestMessage(f.policy, origin, nonce, requestedAtUnix),
          ownerPrivate,
        ),
      },
    );
    const message = Buffer.from(challenge.message);
    return {
      origin,
      challengeId: challenge.challengeId,
      message,
      signature: sign(null, message, ownerPrivate),
    };
  };
  await assert.rejects(
    () => enrollOpenOwner(pool, f.policy, f.accounts),
    /MWA_ENROLLMENT_PROOF_REQUIRED/,
  );
  const firstProof = await proof();
  const intentId = await enrollOpenOwner(
    pool,
    f.policy,
    f.accounts,
    firstProof,
  );
  await assert.rejects(
    () => enrollOpenOwner(pool, f.policy, f.accounts, firstProof),
    /PROOF_CONSUMED/,
  );
  assert.equal(
    await enrollOpenOwner(pool, f.policy, f.accounts, await proof()),
    intentId,
  );
  const rpc = {
    read: async (method: string, params: unknown[]) => {
      if (method === "getMultipleAccounts")
        return {
          context: { slot: 42 },
          value: (params[0] as string[]).map((k) => f.accounts[k] ?? null),
        };
      if (method === "getLatestBlockhash")
        return {
          value: { blockhash: f.context.blockhash, lastValidBlockHeight: 200 },
        };
      if (method === "getMinimumBalanceForRentExemption") return 3000000;
      throw Error("UNEXPECTED_RPC");
    },
  };
  const pos = await readOwnerPosition(pool, f.policy, intentId, rpc);
  assert.equal(pos.shareUnits, "0");
  assert.equal(pos.shareDecimals, 6);
  assert.equal(pos.nav, null);
  const attempts = await Promise.allSettled(
    [0, 1].map(() =>
      prepareOwnerFromDurableState(
        pool,
        f.policy,
        f.idl,
        intentId,
        "deposit",
        rpc,
      ),
    ),
  );
  assert.equal(attempts.filter((v) => v.status === "fulfilled").length, 1);
  const p = attempts.find(
    (v) => v.status === "fulfilled",
  )! as PromiseFulfilledResult<
    Awaited<ReturnType<typeof prepareOwnerFromDurableState>>
  >;
  const prepared = p.value;
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM c3_open.owner_requests"))
      .rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.owner_authorization_manifests",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.owner_economic_manifests",
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () =>
      pool.query(
        "UPDATE c3_open.owner_authorization_manifests SET manifest='{}' WHERE request_id=$1",
        [prepared.requestId],
      ),
    /IMMUTABLE/,
  );
  await assert.rejects(
    () =>
      prepareOwnerFromDurableState(
        pool,
        f.policy,
        f.idl,
        intentId,
        "deposit",
        rpc,
      ),
    /RECONCILE_FIRST/,
  );
  const journal = new OpenOwnerJournal(pool, "https://cmarket.example.org"),
    challenge = await journal.challenge(intentId),
    key = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(f.wallet.secretKey.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    });
  const token = await journal.authenticate(
    challenge.challengeId,
    Buffer.from(challenge.message),
    sign(null, Buffer.from(challenge.message), key),
  );
  await journal.authorizeIntent(token, intentId);
  await journal.bindRequest(token, prepared.requestId);
  const tx = VersionedTransaction.deserialize(
    Buffer.from(prepared.packet, "base64"),
  );
  tx.sign([f.wallet]);
  let sends = 0;
  const result = await journal.submitOnce(
    token,
    prepared.requestId,
    tx.serialize(),
    async () => {
      sends++;
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM c3_open.owner_submissions WHERE request_id=$1",
            [prepared.requestId],
          )
        ).rows[0].n,
        1,
      );
      throw Error("ISOLATED_UNCERTAIN");
    },
  );
  assert.equal(result.status, "uncertain");
  assert.equal(sends, 1);
  const restart = new OpenOwnerJournal(pool, "https://cmarket.example.org");
  const second = await restart.submitOnce(
    token,
    prepared.requestId,
    tx.serialize(),
    async () => {
      sends++;
      return "invalid";
    },
  );
  assert.equal(second.signature, result.signature);
  assert.equal(sends, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.production_enrollments",
      )
    ).rows[0].n,
    1,
  );
  await t.test(
    "actual production signer SELECTs execute on PG and reject a generation changed across signing",
    async () => {
      const source = await readFile(
        new URL("../src/open-record-signer.ts", import.meta.url),
        "utf8",
      );
      const queries = [
        ...source.matchAll(
          /`(SELECT[\s\S]*?WHERE q\.quote_id=\$1(?: FOR UPDATE OF i,q,l)?)`/g,
        ),
      ].map((m) => m[1]!);
      assert.equal(queries.length, 2);
      const quoteId = randomBytes(32),
        nonce = randomBytes(32),
        payload = Buffer.alloc(300);
      Buffer.alloc(32, 1).copy(payload, 17);
      quoteId.copy(payload, 49);
      nonce.copy(payload, 81);
      const hash = createHash("sha256").update(payload).digest();
      await pool.query(
        "INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope) VALUES($1,0,1,$2,$3,'LOCAL_MOCK')",
        [
          intentId,
          { plan: f.a.depositPlan, planRevision: "0" },
          Buffer.alloc(32, 1),
        ],
      );
      await pool.query(
        "INSERT INTO c3_open.quote_authorizations(quote_id,nonce,intent_id,ordinal,intent_revision,canonical_payload,payload_hash,evidence,authority,expires_at) VALUES($1,$2,$3,0,1,$4,$5,'{}',$6,clock_timestamp()+interval '20 seconds')",
        [quoteId, nonce, intentId, payload, hash, Buffer.alloc(32, 2)],
      );
      for (const sql of queries) {
        const row = (await pool.query(sql, [quoteId])).rows[0];
        assert.equal(row.generation, "0");
        assert.equal(row.latest_generation, "0");
        if ("scope" in row) assert.equal(row.scope, "LOCAL_MOCK");
        verifiedGenerationDeadline({
          ...row,
          plan_expiry: String(Math.floor(Date.now() / 1000) + 120),
        });
      }
      const renewalId = randomUUID(),
        post = Buffer.alloc(901);
      post.writeBigUInt64LE(1n, 716);
      await pool.query(
        "INSERT INTO c3_open.renewal_requests(request_id,intent_id,plan,expected_db_revision,expected_chain_revision,expires_at,pre_state,message_hash,observed_slot,blockhash,last_valid_block_height) VALUES($1,$2,$3,1,0,$4,$5,$6,42,$7,200)",
        [
          renewalId,
          intentId,
          f.a.depositPlan,
          now + 120,
          Buffer.alloc(901),
          Buffer.alloc(32, 1),
          f.context.blockhash,
        ],
      );
      await pool.query(
        "INSERT INTO c3_open.renewal_submissions(request_id,signature,message_hash) VALUES($1,$2,$3)",
        [renewalId, "3".repeat(88), Buffer.alloc(32, 1)],
      );
      await pool.query(
        "INSERT INTO c3_open.plan_generations(intent_id,plan,generation,base_revision,request_id,renewal_signature,finalized_slot,post_state,evidence_hash,expires_at) VALUES($1,$2,1,1,$3,$4,43,$5,$6,clock_timestamp()+interval '120 seconds')",
        [
          intentId,
          f.a.depositPlan,
          renewalId,
          "3".repeat(88),
          post,
          Buffer.alloc(32, 1),
        ],
      );
      for (const sql of queries) {
        const row = (await pool.query(sql, [quoteId])).rows[0];
        assert.equal(row.latest_generation, "1");
        assert.throws(
          () =>
            verifiedGenerationDeadline({
              ...row,
              plan_expiry: String(now + 120),
            }),
          /SIGNER_REJECTED/,
        );
      }
      // No migration silently promotes clone authorization into production.
      await assert.rejects(
        () =>
          pool.query(
            "INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope) VALUES($1,1,1,'{}',$2,'MAINNET_REVIEWED')",
            [intentId, Buffer.alloc(32, 1)],
          ),
        /scope_check/,
      );
    },
  );
});
