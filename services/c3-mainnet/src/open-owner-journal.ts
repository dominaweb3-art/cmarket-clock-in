/** Server-only owner authentication and exactly-once submission journal.
 * No key loading, wallet callback, payload persistence, transport retry or
 * economic confirmation. The public production entrypoint remains gated. */
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  decodeVersionedMessage,
  encodeBase58,
  publicKeyBytes,
} from "./solana.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_OWNER_" + code);
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const key = (wallet: string) =>
  createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyBytes(wallet)),
    ]),
    format: "der",
    type: "spki",
  });
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
function audience(value: string) {
  const u = new URL(value);
  check(
    u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/" &&
      u.origin === value,
    "AUTH_AUDIENCE",
  );
  return u.origin;
}
/** This internal journal is also exercised with a disposable PG test database.
 * It is NOT a production capability or a bypass of source-controlled policy. */
export class OpenOwnerJournal {
  private readonly pool: Pool;
  private readonly origin: string;
  constructor(pool: Pool, origin: string) {
    this.pool = pool;
    this.origin = audience(origin);
  }
  async challenge(intentId: string) {
    check(uuid.test(intentId), "INTENT_ID");
    const nonce = randomBytes(32).toString("hex"),
      id = randomUUID();
    return atomic(this.pool, async (c) => {
      const r = (
        await c.query(
          "SELECT wallet,clock_timestamp() AS now FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
          [intentId],
        )
      ).rows[0];
      check(r, "INTENT_MISSING");
      const expires = new Date(r.now.getTime() + 120000);
      const message = Buffer.from(
        `C Market owner session v1\nAudience: ${this.origin}\nWallet: ${r.wallet}\nIntent: ${intentId}\nChallenge: ${id}\nNonce: ${nonce}\nExpires: ${expires.toISOString()}`,
      );
      await c.query(
        "INSERT INTO c3_open.owner_challenges(challenge_id,intent_id,wallet,audience,nonce_hash,message_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          intentId,
          r.wallet,
          this.origin,
          hash(nonce),
          hash(message),
          expires,
        ],
      );
      return { challengeId: id, message: message.toString("utf8") };
    });
  }
  async authenticate(
    challengeId: string,
    message: Uint8Array,
    signature: Uint8Array,
  ) {
    check(
      uuid.test(challengeId) &&
        message.length <= 1200 &&
        signature.length === 64,
      "AUTH_SHAPE",
    );
    const token = randomBytes(32).toString("hex");
    return atomic(this.pool, async (c) => {
      const r = (
        await c.query(
          "SELECT c.*,i.wallet AS owner,clock_timestamp() AS now FROM c3_open.owner_challenges c JOIN c3_open.intents i USING(intent_id) WHERE challenge_id=$1 FOR UPDATE OF c,i",
          [challengeId],
        )
      ).rows[0];
      check(
        r &&
          r.wallet === r.owner &&
          r.audience === this.origin &&
          r.expires_at > r.now &&
          r.message_hash.equals(hash(message)) &&
          verify(null, message, key(r.wallet), signature),
        "AUTH_REJECTED",
      );
      await c.query(
        "INSERT INTO c3_open.owner_sessions(session_hash,challenge_id,intent_id,wallet,expires_at) VALUES($1,$2,$3,$4,$5)",
        [
          hash(token),
          challengeId,
          r.intent_id,
          r.wallet,
          new Date(r.now.getTime() + 600000),
        ],
      );
      return token; // opaque bearer; hash only in PG, never log this result
    });
  }
  private async session(c: PoolClient, token: string, requestId: string) {
    check(
      /^[a-f0-9]{64}$/.test(token) && uuid.test(requestId),
      "SESSION_SHAPE",
    );
    const r = (
      await c.query(
        `SELECT r.*,i.wallet,i.vault,i.db_revision,i.chain_revision,i.state,
   s.session_hash,s.expires_at AS session_expiry,clock_timestamp() AS now
   FROM c3_open.owner_requests r JOIN c3_open.intents i USING(intent_id)
   JOIN c3_open.owner_sessions s ON s.intent_id=i.intent_id AND s.wallet=i.wallet
   JOIN c3_open.owner_challenges auth ON auth.challenge_id=s.challenge_id
   WHERE r.request_id=$1 AND s.session_hash=$2 AND auth.audience=$3 FOR UPDATE OF i`,
        [requestId, hash(token), this.origin],
      )
    ).rows[0];
    check(r && r.session_expiry > r.now, "SESSION_REJECTED");
    return r;
  }
  async bindRequest(token: string, requestId: string) {
    return atomic(this.pool, async (c) => {
      const r = await this.session(c, token, requestId);
      check(
        r.expires_at > r.now &&
          r.expected_db_revision === r.db_revision &&
          r.expected_chain_revision === r.chain_revision,
        "REQUEST_STALE",
      );
      await c.query(
        "INSERT INTO c3_open.owner_request_sessions(request_id,session_hash) VALUES($1,$2) ON CONFLICT(request_id,session_hash) DO NOTHING",
        [requestId, r.session_hash],
      );
      const bound = (
        await c.query(
          "SELECT session_hash FROM c3_open.owner_request_sessions WHERE request_id=$1 AND session_hash=$2",
          [requestId, r.session_hash],
        )
      ).rows[0];
      check(bound.session_hash.equals(r.session_hash), "SESSION_BINDING");
    });
  }
  async authorizeRequest(token: string, requestId: string) {
    return atomic(this.pool, async (c) => {
      const r = await this.session(c, token, requestId);
      check(
        (
          await c.query(
            "SELECT 1 FROM c3_open.owner_request_sessions WHERE request_id=$1 AND session_hash=$2",
            [requestId, r.session_hash],
          )
        ).rowCount,
        "SESSION_BINDING",
      );
      return { intentId: r.intent_id as string, wallet: r.wallet as string };
    });
  }
  /** Recovery authorization does not grant permission to send an expired packet.
   * Exact authenticated wallet/intent still required; histories are immutable. */
  async bindRecovery(token: string, requestId: string) {
    return atomic(this.pool, async (c) => {
      const r = await this.session(c, token, requestId);
      await c.query(
        "INSERT INTO c3_open.owner_request_sessions(request_id,session_hash) VALUES($1,$2) ON CONFLICT(request_id,session_hash) DO NOTHING",
        [requestId, r.session_hash],
      );
    });
  }
  /** Claim+verified signature committed before ONE explicit send. If the process
   * stops after the claim, recovery is read-only; no second callback invocation. */
  async submitOnce(
    token: string,
    requestId: string,
    signedPacket: Uint8Array,
    transport: (bytes: Uint8Array) => Promise<string>,
  ) {
    const packet = Buffer.from(signedPacket);
    check(
      packet.length <= 1232 && packet.length > 65 && packet[0] === 1,
      "SIGNED_PACKET",
    );
    const message = packet.subarray(65),
      decoded = decodeVersionedMessage(message.toString("base64"), []);
    check(
      decoded.requiredSignatures === 1 &&
        decoded.lookupTables.length === 0 &&
        decoded.staticAccounts[0]?.writable,
      "SIGNER",
    );
    const signature = encodeBase58(packet.subarray(1, 65));
    const claimed = await atomic(this.pool, async (c) => {
      const r = await this.session(c, token, requestId);
      const bound = (
        await c.query(
          "SELECT session_hash FROM c3_open.owner_request_sessions WHERE request_id=$1 AND session_hash=$2",
          [requestId, r.session_hash],
        )
      ).rows[0];
      check(
        bound?.session_hash.equals(r.session_hash) &&
          decoded.staticAccounts[0]?.address === r.wallet &&
          hash(message).equals(r.message_hash) &&
          decoded.recentBlockhash === r.blockhash &&
          verify(null, message, key(r.wallet), packet.subarray(1, 65)),
        "SIGNED_BINDING",
      );
      const prior = (
        await c.query(
          "SELECT signature FROM c3_open.owner_send_attempts WHERE request_id=$1",
          [requestId],
        )
      ).rows[0];
      if (prior) {
        check(prior.signature === signature, "SIGNATURE_CONFLICT");
        return false;
      }
      check(
        r.expires_at > r.now &&
          r.expected_db_revision === r.db_revision &&
          r.expected_chain_revision === r.chain_revision,
        "REQUEST_STALE",
      );
      check(
        !(
          await c.query(
            "SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount,
        "TERMINAL_REQUEST",
      );
      await c.query(
        "INSERT INTO c3_open.owner_submissions(request_id,signature,message_hash) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING",
        [requestId, signature, r.message_hash],
      );
      const s = (
        await c.query(
          "SELECT * FROM c3_open.owner_submissions WHERE request_id=$1",
          [requestId],
        )
      ).rows[0];
      check(
        s.signature === signature && s.message_hash.equals(r.message_hash),
        "SIGNATURE_CONFLICT",
      );
      await c.query(
        "INSERT INTO c3_open.owner_send_attempts(request_id,signature,message_hash) VALUES($1,$2,$3)",
        [requestId, signature, r.message_hash],
      );
      return true;
    });
    if (!claimed) return { signature, status: "uncertain" as const };
    let result: "accepted" | "uncertain" = "uncertain";
    try {
      if ((await transport(Buffer.from(packet))) === signature)
        result = "accepted";
    } catch {
      /* never retry or expose endpoint errors */
    }
    await this.pool.query(
      "INSERT INTO c3_open.owner_send_results(request_id,result) VALUES($1,$2)",
      [requestId, result],
    );
    return { signature, status: result }; // accepted is NOT finalized or economically confirmed
  }
}
/** Immutable production guard executes before any DB/transport side effect. */
export async function submitProductionOwnerPacket(
  pool: Pool,
  origin: string,
  token: string,
  requestId: string,
  packet: Uint8Array,
  fetcher: typeof fetch = fetch,
) {
  const policy = requireOpenProductionPolicy();
  const r = (
    await pool.query(
      "SELECT r.blockhash,r.last_valid_height,i.wallet,i.vault,i.configuration_hash FROM c3_open.owner_requests r JOIN c3_open.intents i USING(intent_id) WHERE r.request_id=$1",
      [requestId],
    )
  ).rows[0];
  check(
    r &&
      r.wallet === policy.wallet &&
      r.vault === policy.vault &&
      r.configuration_hash === policy.configurationHash,
    "PRODUCTION_SCOPE",
  );
  const heights = (await readIndependentOpenEvidence(
    policy.providers,
    "getBlockHeight",
    [{ commitment: "finalized" }],
    fetcher,
  )) as { primary: unknown; secondary: unknown };
  const validity = (await readIndependentOpenEvidence(
    policy.providers,
    "isBlockhashValid",
    [r.blockhash, { commitment: "finalized" }],
    fetcher,
  )) as { primary: unknown; secondary: unknown };
  check(
    [heights.primary, heights.secondary].every(
      (v) =>
        Number.isSafeInteger(v) &&
        Number(v) >= 1 &&
        BigInt(Number(v)) <= BigInt(r.last_valid_height),
    ) &&
      [validity.primary, validity.secondary].every(
        (v) => v && typeof v === "object" && "value" in v && v.value === true,
      ),
    "BLOCKHASH_EXPIRED",
  );
  return new OpenOwnerJournal(pool, origin).submitOnce(
    token,
    requestId,
    packet,
    async (bytes) => {
      // ONE owner-authorized broadcast, no provider failover or implicit RPC retries.
      const response = await fetcher(policy.providers[0]!.endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [
            Buffer.from(bytes).toString("base64"),
            {
              encoding: "base64",
              skipPreflight: false,
              preflightCommitment: "finalized",
              maxRetries: 0,
            },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const text = await response.text();
      check(response.ok && text.length <= 2000, "SEND_UNCERTAIN");
      const result = JSON.parse(text) as Record<string, unknown>;
      check(
        result.jsonrpc === "2.0" &&
          result.id === 1 &&
          !result.error &&
          typeof result.result === "string",
        "SEND_UNCERTAIN",
      );
      return result.result as string;
    },
  );
}
