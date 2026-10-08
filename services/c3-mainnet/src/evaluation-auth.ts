/** Durable Devnet enrollment proof before allocating a wallet-specific vault.
 * Explicit message signature, never a spending authorization. Secrets stay server-side. */
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { Pool, PoolClient } from "pg";
import { EVALUATION } from "./evaluation-scope.ts";

export const EVALUATION_ORIGIN = "https://cmarket-nine.vercel.app";
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_AUTH_" + code);
};
async function atomic<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='3s'");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export function evaluationProofMessage(
  wallet: string,
  id: string,
  nonce: string,
  expires: Date,
) {
  const owner = new PublicKey(wallet);
  check(
    PublicKey.isOnCurve(owner.toBytes()) &&
      uuid.test(id) &&
      /^[a-f0-9]{64}$/.test(nonce) &&
      Number.isFinite(expires.getTime()),
    "SHAPE",
  );
  return Buffer.from(
    `C Market Devnet evaluation wallet proof v1\nAudience: ${EVALUATION_ORIGIN}\nNetwork: solana:devnet\nTokens have no monetary value. This message does not transfer funds.\nWallet: ${wallet}\nChallenge: ${id}\nNonce: ${nonce}\nExpires: ${expires.toISOString()}`,
  );
}
export function verifyEvaluationProof(
  wallet: string,
  message: Uint8Array,
  signature: Uint8Array,
) {
  const owner = new PublicKey(wallet);
  check(
    PublicKey.isOnCurve(owner.toBytes()) &&
      message instanceof Uint8Array &&
      message.length <= 1200 &&
      signature instanceof Uint8Array &&
      signature.length === 64,
    "SHAPE",
  );
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      owner.toBuffer(),
    ]),
    format: "der",
    type: "spki",
  });
  check(verify(null, message, publicKey, signature), "SIGNATURE");
}
export class EvaluationAuth {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  async challenge(wallet: string) {
    const key = new PublicKey(wallet);
    check(
      key.toBase58() === wallet && PublicKey.isOnCurve(key.toBytes()),
      "WALLET",
    );
    return atomic(this.pool, async (c) => {
      // Server-clock throttling and cross-process lock, not ephemeral Function memory.
      await c.query("SELECT pg_advisory_xact_lock(6321221)");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,6321))", [
        wallet,
      ]);
      const r = (
        await c.query(
          `SELECT clock_timestamp() AS now,
        (SELECT count(*) FROM c3_eval.wallet_challenges WHERE wallet=$1 AND created_at>clock_timestamp()-interval '10 minutes') AS owner_count,
        (SELECT count(*) FROM c3_eval.wallet_challenges WHERE created_at>clock_timestamp()-interval '1 minute') AS global_count`,
          [wallet],
        )
      ).rows[0];
      check(
        Number(r.owner_count) < 5 && Number(r.global_count) < 100,
        "RATE_LIMIT",
      );
      const id = randomUUID(),
        nonce = randomBytes(32).toString("hex"),
        expires = new Date(r.now.getTime() + 119000);
      const message = evaluationProofMessage(wallet, id, nonce, expires);
      await c.query(
        "INSERT INTO c3_eval.wallet_challenges(challenge_id,wallet,audience,genesis,message_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          wallet,
          EVALUATION_ORIGIN,
          EVALUATION.genesis,
          hash(message),
          expires,
        ],
      );
      return {
        challengeId: id,
        wallet,
        cluster: EVALUATION.cluster,
        message: message.toString("utf8"),
        expiresAt: expires.toISOString(),
      };
    });
  }
  async authenticate(id: string, message: Uint8Array, signature: Uint8Array) {
    check(uuid.test(id), "CHALLENGE_ID");
    const token = randomBytes(32).toString("hex");
    return atomic(this.pool, async (c) => {
      const r = (
        await c.query(
          "SELECT *,clock_timestamp() AS now FROM c3_eval.wallet_challenges WHERE challenge_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      check(
        r &&
          r.audience === EVALUATION_ORIGIN &&
          r.genesis === EVALUATION.genesis &&
          r.expires_at > r.now &&
          hash(message).equals(r.message_hash),
        "CHALLENGE",
      );
      verifyEvaluationProof(r.wallet, message, signature);
      check(
        !(
          await c.query(
            "SELECT 1 FROM c3_eval.wallet_proofs WHERE challenge_id=$1",
            [id],
          )
        ).rowCount,
        "REPLAY",
      );
      await c.query(
        "INSERT INTO c3_eval.wallet_proofs(challenge_id,signature) VALUES($1,$2)",
        [id, Buffer.from(signature)],
      );
      const expiry = new Date(r.now.getTime() + 599000);
      await c.query(
        "INSERT INTO c3_eval.wallet_sessions(session_hash,challenge_id,expires_at) VALUES($1,$2,$3)",
        [hash(token), id, expiry],
      );
      return {
        sessionToken: token,
        wallet: r.wallet as string,
        expiresAt: expiry.toISOString(),
      }; // never log
    });
  }
  async authorize(token: string) {
    check(typeof token === "string" && /^[a-f0-9]{64}$/.test(token), "SESSION");
    const r = (
      await this.pool.query(
        `SELECT c.wallet,c.challenge_id FROM c3_eval.wallet_sessions s
      JOIN c3_eval.wallet_proofs p USING(challenge_id) JOIN c3_eval.wallet_challenges c USING(challenge_id)
      WHERE s.session_hash=$1 AND s.expires_at>clock_timestamp() AND c.audience=$2 AND c.genesis=$3`,
        [hash(token), EVALUATION_ORIGIN, EVALUATION.genesis],
      )
    ).rows[0];
    check(r, "SESSION");
    return {
      wallet: r.wallet as string,
      challengeId: r.challenge_id as string,
    };
  }
}
