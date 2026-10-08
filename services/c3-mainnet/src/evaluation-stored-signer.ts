/** Server-only quote signing, never wallet or transaction signing. The key is
 * injected by the server bootstrap, not loaded from a path or HTTP request.
 * EvaluationQuoteService separately pins the provider to EVALUATION.quotes.
 * Results use the EXISTING PostgreSQL journal and commit before returning. */
import {
  createHash,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import type { Pool } from "pg";
import type { DurableQuoteSigningProvider } from "./open-signing-journal.ts";
import { assertEvaluationDatabase } from "./evaluation-scope.ts";

const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_SIGNER_" + code);
};
export class StoredEvaluationQuoteSigner implements DurableQuoteSigningProvider {
  readonly publicKey: Uint8Array;
  private readonly key: KeyObject;
  private readonly pool: Pool;
  constructor(pool: Pool, key: KeyObject) {
    check(
      key.type === "private" && key.asymmetricKeyType === "ed25519",
      "KEY_TYPE",
    );
    this.pool = pool;
    this.key = key;
    this.publicKey = Buffer.from(
      createPublicKey(key).export({ format: "der", type: "spki" }),
    ).subarray(-32);
  }
  private verified(payload: Buffer, signature: Buffer) {
    check(
      signature.length === 64 &&
        verify(null, payload, createPublicKey(this.key), signature),
      "RESULT_SIGNATURE",
    );
    return Buffer.from(signature);
  }
  async signIdempotently(requestId: string, canonicalBytes: Uint8Array) {
    check(/^[a-f0-9]{64}$/.test(requestId), "REQUEST_ID");
    const payload = Buffer.from(canonicalBytes);
    check(
      payload.length === 300 &&
        payload.subarray(0, 16).toString("ascii") === "C3QUOTESEAL-V1!!" &&
        payload[16] === 1,
      "QUOTE_DOMAIN",
    );
    await assertEvaluationDatabase(this.pool);
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      const identity = (
        await c.query(
          "SELECT q.intent_id,q.quote_id FROM c3_eval.signing_requests r JOIN c3_eval.quote_authorizations q USING(quote_id) WHERE r.request_id=$1",
          [Buffer.from(requestId, "hex")],
        )
      ).rows[0];
      check(identity, "NOT_DISPATCHED");
      const intent = (
        await c.query(
          "SELECT * FROM c3_eval.intents WHERE intent_id=$1 FOR UPDATE",
          [identity.intent_id],
        )
      ).rows[0];
      const q = (
        await c.query(
          "SELECT *,clock_timestamp() AS now FROM c3_eval.quote_authorizations WHERE quote_id=$1 FOR UPDATE",
          [identity.quote_id],
        )
      ).rows[0];
      const r = (
        await c.query(
          "SELECT * FROM c3_eval.signing_requests WHERE request_id=$1 FOR UPDATE",
          [Buffer.from(requestId, "hex")],
        )
      ).rows[0];
      const authority = Buffer.from(this.publicKey),
        payloadHash = hash(payload);
      const expectedId = hash(
        Buffer.concat([
          Buffer.from("c3-open-signing-request-v1"),
          q.quote_id,
          payloadHash,
          authority,
        ]),
      ).toString("hex");
      check(
        requestId === expectedId &&
          q.canonical_payload.equals(payload) &&
          q.payload_hash.equals(payloadHash) &&
          q.authority.equals(authority) &&
          r.payload_hash.equals(payloadHash) &&
          r.authority.equals(authority),
        "CANONICAL_RECORD",
      );
      if (r.state === "result") {
        const signature = this.verified(payload, r.signature);
        await c.query("COMMIT");
        return signature;
      }
      // A direct second call after transport uncertainty is not a retry permit.
      // Only the dispatched call may sign; lookupSignature never signs.
      check(r.state === "dispatched", "LOOKUP_ONLY_AFTER_UNCERTAINTY");
      check(
        ["buying", "selling"].includes(intent.state) &&
          String(intent.db_revision) === String(q.intent_revision) &&
          q.state === "prepared" &&
          q.expires_at > q.now,
        "CURRENT_INTENT_OR_EXPIRY",
      );
      const context = (
        await c.query(
          "SELECT v.context,g.plan_revision,g.generation FROM c3_eval.leg_context_verifications v JOIN c3_eval.quote_generations g USING(intent_id) WHERE g.quote_id=$1 AND v.intent_id=$2 AND v.ordinal=$3 AND v.intent_revision=$4",
          [q.quote_id, q.intent_id, q.ordinal, q.intent_revision],
        )
      ).rows;
      check(context.length === 1, "VERIFIED_CONTEXT");
      check(
        context[0].context.planRevision === String(intent.chain_revision) &&
          String(context[0].plan_revision) === String(intent.chain_revision),
        "PLAN_REVISION",
      );
      const pending = await c.query(
        `SELECT 1 FROM c3_eval.renewal_submissions s JOIN c3_eval.renewal_requests r USING(request_id)
         LEFT JOIN c3_eval.plan_generations g USING(request_id) LEFT JOIN c3_eval.renewal_outcomes o USING(request_id)
         WHERE r.intent_id=$1 AND g.request_id IS NULL AND o.request_id IS NULL
         UNION ALL SELECT 1 FROM c3_eval.owner_requests r LEFT JOIN c3_eval.owner_message_receipts m USING(request_id)
         LEFT JOIN c3_eval.owner_request_outcomes o USING(request_id) LEFT JOIN c3_eval.plan_generations g USING(request_id)
         WHERE r.intent_id=$1 AND m.request_id IS NULL AND o.request_id IS NULL AND g.request_id IS NULL LIMIT 1`,
        [q.intent_id],
      );
      check(!pending.rowCount, "RECONCILE_INCOMPATIBLE_FIRST");
      const signature = sign(null, payload, this.key);
      this.verified(payload, signature);
      await c.query(
        "UPDATE c3_eval.signing_requests SET state='result',signature=$2,revision=revision+1 WHERE request_id=$1",
        [r.request_id, signature],
      );
      await c.query("COMMIT");
      return Buffer.from(signature);
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  async lookupSignature(requestId: string) {
    check(/^[a-f0-9]{64}$/.test(requestId), "REQUEST_ID");
    await assertEvaluationDatabase(this.pool);
    const rows = (
      await this.pool.query(
        "SELECT r.state,r.signature,r.authority,r.payload_hash,q.canonical_payload FROM c3_eval.signing_requests r JOIN c3_eval.quote_authorizations q USING(quote_id) WHERE r.request_id=$1",
        [Buffer.from(requestId, "hex")],
      )
    ).rows;
    if (!rows.length || rows[0].state !== "result") return null;
    const r = rows[0];
    check(
      r.authority.equals(Buffer.from(this.publicKey)) &&
        hash(r.canonical_payload).equals(r.payload_hash),
      "LOOKUP_RECORD",
    );
    return this.verified(r.canonical_payload, r.signature);
  }
}
