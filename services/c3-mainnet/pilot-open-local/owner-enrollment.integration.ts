/** Disposable PostgreSQL and ephemeral fixture key only. Never invokes MWA,
 * signs a transaction, enables production or enrolls the owner's real wallet. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPrivateKey,
  createHash,
  sign,
  randomUUID,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import pg from "pg";
import { compilerFixture } from "../tests/open-owner-compiler.test.ts";
import {
  applyReviewedOpenSchema,
  enrollOpenOwner,
} from "../src/open-owner-schema.ts";
import {
  issueOpenEnrollmentChallenge,
  readOpenEnrollmentAccounts,
  enrollmentRequestMessage,
} from "../src/open-owner-enrollment.ts";
import { assertProductionEnrollment } from "../src/open-owner-trust.ts";
import type { OpenProductionPolicy } from "../src/open-production-policy.ts";
import { canonicalize } from "../src/manifest.ts";
const url = new URL(process.env.DATABASE_URL!);
function request(
  policy: Parameters<typeof enrollmentRequestMessage>[0],
  origin: string,
  key: KeyObject,
  requestedAtUnix = Math.floor(Date.now() / 1000),
) {
  const nonce = randomBytes(32).toString("hex");
  return {
    nonce,
    requestedAtUnix,
    signature: sign(
      null,
      enrollmentRequestMessage(policy, origin, nonce, requestedAtUnix),
      key,
    ),
  };
}
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw Error("DISPOSABLE_DB_REQUIRED");
test("pre-enrollment proof is durable, policy-bound, one-use and atomic", async (t) => {
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  t.after(() => pool.end());
  await applyReviewedOpenSchema(pool);
  const f = compilerFixture(),
    origin = "https://c3-api.example.org";
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(f.wallet.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const req = request(f.policy, origin, privateKey);
  await assert.rejects(
    () => issueOpenEnrollmentChallenge(pool, f.policy, origin),
    /SIGNATURE_REQUIRED/,
  );
  await assert.rejects(
    () =>
      issueOpenEnrollmentChallenge(pool, f.policy, origin, {
        ...req,
        signature: new Uint8Array(64),
      }),
    /REQUEST_REJECTED/,
  );
  await assert.rejects(
    () =>
      issueOpenEnrollmentChallenge(
        pool,
        f.policy,
        "https://evil.example.org",
        req,
      ),
    /REQUEST_REJECTED/,
  );
  await assert.rejects(
    () =>
      issueOpenEnrollmentChallenge(
        pool,
        f.policy,
        origin,
        request(
          f.policy,
          origin,
          privateKey,
          Math.floor(Date.now() / 1000) - 120,
        ),
      ),
    /REQUEST_EXPIRED/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.owner_enrollment_challenges",
      )
    ).rows[0].n,
    0,
  );
  const challenge = await issueOpenEnrollmentChallenge(
    pool,
    f.policy,
    origin,
    req,
  );
  await assert.rejects(
    () => issueOpenEnrollmentChallenge(pool, f.policy, origin, req),
    /REQUEST_REPLAY/,
  );
  const message = Buffer.from(challenge.message),
    signature = sign(null, message, privateKey);
  const proof = {
    origin,
    challengeId: challenge.challengeId,
    message,
    signature,
  };
  let rpcCalls = 0;
  const rpc = {
    read: async (method: string, params: readonly unknown[]) => {
      rpcCalls++;
      assert.equal(method, "getMultipleAccounts");
      assert.deepEqual(params, [
        [f.policy.vault, f.policy.shareMint],
        { commitment: "finalized", encoding: "base64" },
      ]);
      return {
        context: { slot: 1 },
        value: [f.accounts[f.policy.vault], f.accounts[f.policy.shareMint]],
      };
    },
  };
  assert.match(challenge.message, /NO transaction, transfer, token approval/);
  await assert.rejects(
    () => enrollOpenOwner(pool, f.policy, f.accounts),
    /PROOF_REQUIRED/,
  );
  for (const p of [
    { ...proof, signature: new Uint8Array(64) },
    { ...proof, message: Buffer.from("C Market DEVICE QA ONLY v1") },
    { ...proof, message: message.subarray(1) },
    { ...proof, origin: "https://evil.example.org" },
    { ...proof, challengeId: randomUUID() },
  ]) {
    await assert.rejects(() => enrollOpenOwner(pool, f.policy, f.accounts, p));
    await assert.rejects(() =>
      readOpenEnrollmentAccounts(pool, f.policy, p, rpc),
    );
  }
  assert.equal(rpcCalls, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.owner_enrollment_rpc_attempts",
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual(
    await readOpenEnrollmentAccounts(pool, f.policy, proof, rpc),
    {
      [f.policy.vault]: f.accounts[f.policy.vault],
      [f.policy.shareMint]: f.accounts[f.policy.shareMint],
    },
  );
  assert.equal(rpcCalls, 1);
  await assert.rejects(
    () =>
      enrollOpenOwner(
        pool,
        { ...f.policy, registryRevision: "2" },
        f.accounts,
        proof,
      ),
    /PROOF_REJECTED/,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM c3_open.intents")).rows[0].n,
    0,
  );
  const expiredId = randomUUID(),
    expires = new Date(Date.now() - 1000);
  const expired = Buffer.from(
    challenge.message
      .replace(challenge.challengeId, expiredId)
      .replace(challenge.expiresAt, expires.toISOString()),
  );
  await pool.query(
    "INSERT INTO c3_open.owner_enrollment_challenges(challenge_id,wallet,audience,policy_hash,nonce_hash,message_hash,expires_at,request_hash) SELECT $1,wallet,audience,policy_hash,nonce_hash,$2,$3,$2 FROM c3_open.owner_enrollment_challenges WHERE challenge_id=$4",
    [
      expiredId,
      createHash("sha256").update(expired).digest(),
      expires,
      proof.challengeId,
    ],
  );
  await assert.rejects(
    () =>
      enrollOpenOwner(pool, f.policy, f.accounts, {
        ...proof,
        challengeId: expiredId,
        message: expired,
        signature: sign(null, expired, privateKey),
      }),
    /PROOF_REJECTED/,
  );
  const outcomes = await Promise.allSettled(
    [0, 1].map(() => enrollOpenOwner(pool, f.policy, f.accounts, proof)),
  );
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM c3_open.intents")).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.owner_enrollment_consumptions",
      )
    ).rows[0].n,
    1,
  );
  const intent = (await pool.query("SELECT intent_id FROM c3_open.intents"))
    .rows[0].intent_id;
  const approved = {
    ...f.policy,
    programId: f.policy.program,
  } as unknown as OpenProductionPolicy;
  await assertProductionEnrollment(pool, approved, intent, "intent");
  // Re-enrollment with a fresh proof preserves one durable intent.
  const fresh = await issueOpenEnrollmentChallenge(
    pool,
    f.policy,
    origin,
    request(f.policy, origin, privateKey),
  );
  const freshMessage = Buffer.from(fresh.message);
  assert.equal(
    await enrollOpenOwner(pool, f.policy, f.accounts, {
      origin,
      challengeId: fresh.challengeId,
      message: freshMessage,
      signature: sign(null, freshMessage, privateKey),
    }),
    intent,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM c3_open.intents")).rows[0].n,
    1,
  );
  // A legacy enrollment with no consumed control proof cannot enter production.
  const legacy = compilerFixture(),
    legacyId = randomUUID();
  await pool.query(
    "INSERT INTO c3_open.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,expires_at) VALUES($1,$2,$3,$4,$5,$6,1000000,clock_timestamp()+interval '30 minutes')",
    [
      legacyId,
      legacy.policy.wallet,
      legacy.policy.vault,
      legacy.policy.shareMint,
      legacy.a.depositPlan,
      legacy.policy.configurationHash,
    ],
  );
  await pool.query(
    "INSERT INTO c3_open.production_enrollments(intent_id,policy_hash,configuration_evidence_hash) VALUES($1,$2,$3)",
    [
      legacyId,
      createHash("sha256").update(canonicalize(legacy.policy)).digest("hex"),
      "a".repeat(64),
    ],
  );
  await assert.rejects(
    () =>
      assertProductionEnrollment(
        pool,
        {
          ...legacy.policy,
          programId: legacy.policy.program,
        } as unknown as OpenProductionPolicy,
        legacyId,
        "intent",
      ),
    /ENROLLMENT_REQUIRED/,
  );
  // A second connection/process view sees consumption; no in-memory flag involved.
  const restarted = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await assert.rejects(
      () => enrollOpenOwner(restarted, f.policy, f.accounts, proof),
      /PROOF_CONSUMED/,
    );
  } finally {
    await restarted.end();
  }
  await assert.rejects(() =>
    pool.query(
      "UPDATE c3_open.owner_enrollment_challenges SET audience='https://evil.example.org' WHERE challenge_id=$1",
      [proof.challengeId],
    ),
  );
  await assert.rejects(() =>
    pool.query(
      "DELETE FROM c3_open.owner_enrollment_consumptions WHERE challenge_id=$1",
      [proof.challengeId],
    ),
  );
  const before = (
    await pool.query(
      "SELECT count(*)::int n FROM c3_open.owner_enrollment_challenges",
    )
  ).rows[0].n;
  await assert.rejects(
    () =>
      issueOpenEnrollmentChallenge(
        pool,
        f.policy,
        origin,
        request(f.policy, origin, privateKey),
      ),
    /CHALLENGE_LIMIT/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.owner_enrollment_challenges",
      )
    ).rows[0].n,
    before,
  );
});

test("RPC attempt budget survives restart; lifetime and concurrent challenge limits bound durable growth", async (t) => {
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  t.after(() => pool.end());
  await applyReviewedOpenSchema(pool);
  const f = compilerFixture(),
    origin = "https://c3-api.example.org";
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(f.wallet.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const challenge = await issueOpenEnrollmentChallenge(
      pool,
      f.policy,
      origin,
      request(f.policy, origin, key),
    ),
    message = Buffer.from(challenge.message);
  const proof = {
    origin,
    challengeId: challenge.challengeId,
    message,
    signature: sign(null, message, key),
  };
  let calls = 0;
  const failedRpc = {
    read: async () => {
      calls++;
      throw Error("isolated RPC unavailable");
    },
  };
  for (let i = 0; i < 3; i++)
    await assert.rejects(
      () => readOpenEnrollmentAccounts(pool, f.policy, proof, failedRpc),
      /unavailable/,
    );
  const restarted = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await assert.rejects(
      () => readOpenEnrollmentAccounts(restarted, f.policy, proof, failedRpc),
      /RPC_LIMIT/,
    );
  } finally {
    await restarted.end();
  }
  assert.equal(calls, 3);
  await assert.rejects(() =>
    pool.query(
      "DELETE FROM c3_open.owner_enrollment_rpc_attempts WHERE challenge_id=$1",
      [proof.challengeId],
    ),
  );
  await Promise.allSettled(
    [0, 1, 2, 3, 4].map(() =>
      issueOpenEnrollmentChallenge(
        pool,
        f.policy,
        origin,
        request(f.policy, origin, key),
      ),
    ),
  );
  const count = (
    await pool.query(
      "SELECT count(*)::int n FROM c3_open.owner_enrollment_challenges WHERE wallet=$1",
      [f.policy.wallet],
    )
  ).rows[0].n;
  assert.ok(count <= 3);
  // Only test fixtures may insert historic rows: cap counts all generations.
  await pool.query(
    "INSERT INTO c3_open.owner_enrollment_challenges(challenge_id,wallet,audience,policy_hash,nonce_hash,message_hash,expires_at,created_at,request_hash) SELECT md5($1::text||n::text)::uuid,wallet,audience,policy_hash,nonce_hash,message_hash,clock_timestamp()-interval '8 minutes',clock_timestamp()-interval '10 minutes',decode(md5($1::text||n::text)||md5($1::text||n::text),'hex') FROM c3_open.owner_enrollment_challenges CROSS JOIN generate_series(1,$2::int) n WHERE challenge_id=$1::uuid",
    [proof.challengeId, 60 - count],
  );
  await assert.rejects(
    () =>
      issueOpenEnrollmentChallenge(
        pool,
        f.policy,
        origin,
        request(f.policy, origin, key),
      ),
    /CHALLENGE_LIMIT/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM c3_open.owner_enrollment_challenges WHERE wallet=$1",
        [f.policy.wallet],
      )
    ).rows[0].n,
    60,
  );
});
