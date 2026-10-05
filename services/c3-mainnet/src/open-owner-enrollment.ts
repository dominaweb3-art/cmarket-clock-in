/** Pre-intent owner control proof. Message only; no wallet callback, transaction,
 * key loading, session creation, approval or execution capability. */
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OpenCompilerPolicy } from "./open-owner-compiler.ts";
import { canonicalize } from "./manifest.ts";
import { publicKeyBytes } from "./solana.ts";
import type { OwnerReadonlyRpc } from "./open-owner-service.ts";
import type { OpenAccount } from "./open-state-semantics.ts";
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const policyHash = (p: OpenCompilerPolicy) =>
  hash(canonicalize(p)).toString("hex");
function audience(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.origin !== value ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw Error("C3_OWNER_ENROLLMENT_AUDIENCE");
  return u.origin;
}
export type OpenEnrollmentProof = Readonly<{
  origin: string;
  challengeId: string;
  message: Uint8Array;
  signature: Uint8Array;
}>;
export type OpenEnrollmentRequest = Readonly<{
  nonce: string;
  requestedAtUnix: number;
  signature: Uint8Array;
}>;
export function enrollmentRequestMessage(
  policy: OpenCompilerPolicy,
  origin: string,
  nonce: string,
  requestedAtUnix: number,
) {
  if (
    !/^[a-f0-9]{64}$/.test(nonce) ||
    !Number.isSafeInteger(requestedAtUnix) ||
    requestedAtUnix < 1
  )
    throw Error("C3_OWNER_ENROLLMENT_REQUEST_REJECTED");
  return Buffer.from(
    [
      "C Market owner enrollment challenge request v1",
      "Purpose: request one control-proof challenge; NO transaction, transfer, token approval, login or Mainnet execution authorization.",
      `Audience: ${audience(origin)}`,
      `Wallet: ${policy.wallet}`,
      `Program: ${policy.program}`,
      `Vault: ${policy.vault}`,
      `Policy SHA-256: ${policyHash(policy)}`,
      `Nonce: ${nonce}`,
      `Requested at Unix: ${requestedAtUnix}`,
    ].join("\n"),
  );
}
function ownerSignature(
  policy: OpenCompilerPolicy,
  message: Uint8Array,
  signature: Uint8Array,
) {
  if (!(signature instanceof Uint8Array) || signature.length !== 64)
    return false;
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyBytes(policy.wallet)),
    ]),
    format: "der",
    type: "spki",
  });
  return verify(null, message, key, signature);
}
function enrollmentMessage(
  policy: OpenCompilerPolicy,
  origin: string,
  id: string,
  nonce: string,
  expires: Date,
) {
  return Buffer.from(
    [
      "C Market owner enrollment control proof v1",
      "Purpose: enroll this wallet only; NO transaction, transfer, token approval or Mainnet execution authorization.",
      "Network: solana:mainnet (message only)",
      `Audience: ${origin}`,
      `Wallet: ${policy.wallet}`,
      `Program: ${policy.program}`,
      `Vault: ${policy.vault}`,
      `Policy SHA-256: ${policyHash(policy)}`,
      `Registry revision: ${policy.registryRevision}`,
      `Quote policy revision: ${policy.quotePolicyRevision}`,
      `Challenge: ${id}`,
      `Nonce: ${nonce}`,
      `Expires: ${expires.toISOString()}`,
    ].join("\n"),
  );
}
export async function issueOpenEnrollmentChallenge(
  pool: Pool,
  policy: OpenCompilerPolicy,
  origin: string,
  request?: OpenEnrollmentRequest,
) {
  if (!request) throw Error("C3_OWNER_ENROLLMENT_REQUEST_SIGNATURE_REQUIRED");
  const requestMessage = enrollmentRequestMessage(
    policy,
    origin,
    request.nonce,
    request.requestedAtUnix,
  );
  if (!ownerSignature(policy, requestMessage, request.signature))
    throw Error("C3_OWNER_ENROLLMENT_REQUEST_REJECTED");
  const requestHash = hash(requestMessage);
  const boundOrigin = audience(origin),
    id = randomUUID(),
    nonce = randomBytes(32).toString("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SELECT pg_advisory_xact_lock(734432992)");
    const now = (await client.query("SELECT clock_timestamp() AS now")).rows[0]
      .now as Date;
    const age = now.getTime() / 1000 - request.requestedAtUnix;
    if (age < -5 || age >= 120)
      throw Error("C3_OWNER_ENROLLMENT_REQUEST_EXPIRED");
    if (
      (
        await client.query(
          "SELECT 1 FROM c3_open.owner_enrollment_challenges WHERE request_hash=$1",
          [requestHash],
        )
      ).rowCount
    )
      throw Error("C3_OWNER_ENROLLMENT_REQUEST_REPLAY");
    const counts = (
      await client.query(
        "SELECT count(*)::int total,count(*) FILTER(WHERE created_at>$2::timestamptz-interval '1 minute')::int recent FROM c3_open.owner_enrollment_challenges WHERE wallet=$1",
        [policy.wallet, now],
      )
    ).rows[0];
    // Restricted one-position pilot: hard lifetime storage cap, never delete history.
    if (counts.total >= 60 || counts.recent >= 3)
      throw Error("C3_OWNER_ENROLLMENT_CHALLENGE_LIMIT");
    const expires = new Date(now.getTime() + 120000),
      digest = policyHash(policy);
    const message = enrollmentMessage(policy, boundOrigin, id, nonce, expires);
    await client.query(
      "INSERT INTO c3_open.owner_enrollment_challenges(challenge_id,wallet,audience,policy_hash,nonce_hash,message_hash,expires_at,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        policy.wallet,
        boundOrigin,
        digest,
        hash(nonce),
        hash(message),
        expires,
        requestHash,
      ],
    );
    await client.query("COMMIT");
    return {
      challengeId: id,
      message: message.toString(),
      expiresAt: expires.toISOString(),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Validate before costly RPC, reserving at most three explicit reads per
 * challenge durably. Enrollment revalidates/consumes under its own transaction.
 * No DB lock is held over network I/O; this is not automatic retry. */
export async function readOpenEnrollmentAccounts(
  pool: Pool,
  policy: OpenCompilerPolicy,
  proof: OpenEnrollmentProof,
  rpc: OwnerReadonlyRpc,
): Promise<Readonly<Record<string, OpenAccount | null>>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SELECT pg_advisory_xact_lock(734432992)");
    await verifyOpenEnrollmentProof(client, policy, proof);
    const count = (
      await client.query(
        "SELECT count(*)::int n FROM c3_open.owner_enrollment_rpc_attempts WHERE challenge_id=$1",
        [proof.challengeId],
      )
    ).rows[0].n;
    if (count >= 3) throw Error("C3_OWNER_ENROLLMENT_RPC_LIMIT");
    await client.query(
      "INSERT INTO c3_open.owner_enrollment_rpc_attempts(challenge_id,attempt) VALUES($1,$2)",
      [proof.challengeId, count + 1],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const response = (await rpc.read("getMultipleAccounts", [
    [policy.vault, policy.shareMint],
    { commitment: "finalized", encoding: "base64" },
  ])) as { context: { slot: number }; value: OpenAccount[] };
  if (
    !Number.isSafeInteger(response.context?.slot) ||
    response.context.slot < 1 ||
    response.value?.length !== 2
  )
    throw Error("C3_OWNER_ENROLLMENT_EVIDENCE");
  return {
    [policy.vault]: response.value[0]!,
    [policy.shareMint]: response.value[1]!,
  };
}
/** Called under the enrollment SERIALIZABLE transaction/advisory lock. A caller
 * cannot self-certify a proof: immutable server challenge and signature verify. */
export async function verifyOpenEnrollmentProof(
  client: PoolClient,
  policy: OpenCompilerPolicy,
  proof: OpenEnrollmentProof,
) {
  if (
    !proof ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      proof.challengeId,
    ) ||
    !(proof.message instanceof Uint8Array) ||
    proof.message.length > 1400 ||
    !(proof.signature instanceof Uint8Array) ||
    proof.signature.length !== 64
  )
    throw Error("C3_OWNER_MWA_ENROLLMENT_PROOF_REQUIRED");
  const origin = audience(proof.origin);
  const r = (
    await client.query(
      "SELECT c.*,clock_timestamp() AS now FROM c3_open.owner_enrollment_challenges c WHERE challenge_id=$1 FOR UPDATE",
      [proof.challengeId],
    )
  ).rows[0];
  if (
    !r ||
    r.wallet !== policy.wallet ||
    r.audience !== origin ||
    r.policy_hash !== policyHash(policy) ||
    r.expires_at <= r.now ||
    r.now < r.created_at ||
    r.expires_at <= r.created_at ||
    r.expires_at.getTime() - r.created_at.getTime() > 120000 ||
    !r.message_hash.equals(hash(proof.message))
  )
    throw Error("C3_OWNER_ENROLLMENT_PROOF_REJECTED");
  const nonce = Buffer.from(proof.message)
    .toString()
    .match(/^Nonce: ([a-f0-9]{64})$/m)?.[1];
  if (
    !nonce ||
    !r.nonce_hash.equals(hash(nonce)) ||
    !Buffer.from(proof.message).equals(
      enrollmentMessage(policy, origin, proof.challengeId, nonce, r.expires_at),
    )
  )
    throw Error("C3_OWNER_ENROLLMENT_PROOF_REJECTED");
  if (!ownerSignature(policy, proof.message, proof.signature))
    throw Error("C3_OWNER_ENROLLMENT_PROOF_REJECTED");
  if (
    (
      await client.query(
        "SELECT 1 FROM c3_open.owner_enrollment_consumptions WHERE challenge_id=$1",
        [proof.challengeId],
      )
    ).rowCount
  )
    throw Error("C3_OWNER_ENROLLMENT_PROOF_CONSUMED");
  return {
    challengeId: proof.challengeId,
    signatureHash: hash(proof.signature),
  };
}
