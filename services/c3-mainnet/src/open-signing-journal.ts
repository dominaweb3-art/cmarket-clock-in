/** Durable quote-signing transport journal, NOT wallet/transaction signing.
 * Caller must validate the persisted quote/context first. No public export,
 * key loader, signing fallback, transaction sender or capability override.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Pool } from "pg";
export interface DurableQuoteSigningProvider {
  readonly publicKey: Uint8Array;
  /** Remote service MUST persist the result under this exact idempotency key. */
  signIdempotently(
    requestId: string,
    canonicalBytes: Uint8Array,
  ): Promise<Uint8Array>;
  /** Read-only lookup. null is uncertain; it NEVER permits another signing call. */
  lookupSignature(requestId: string): Promise<Uint8Array | null>;
}
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
const reject = (): never => {
  throw new Error("C3_OPEN_SIGNING_UNCERTAIN_OR_REJECTED");
};
export class OpenSigningJournal {
  private readonly pool: Pool;
  private readonly provider: DurableQuoteSigningProvider;
  constructor(pool: Pool, provider: DurableQuoteSigningProvider) {
    this.pool = pool;
    this.provider = provider;
  }
  async obtain(
    quoteId: Buffer,
    payload: Buffer,
    authority: Buffer,
  ): Promise<Buffer> {
    if (
      quoteId.length !== 32 ||
      payload.length !== 300 ||
      authority.length !== 32 ||
      !payload.subarray(49, 81).equals(quoteId) ||
      !Buffer.from(this.provider.publicKey).equals(authority)
    )
      reject();
    // Domain, quote, payload, authority all bind the remote request identity.
    const payloadHash = hash(payload),
      request = hash(
        Buffer.concat([
          Buffer.from("c3-open-signing-request-v1"),
          quoteId,
          payloadHash,
          authority,
        ]),
      );
    let client = await this.pool.connect();
    let released = false;
    let fresh = false;
    try {
      await client.query("BEGIN");
      // Same lock order as owner renewal and quote consumption. A quote-only
      // lock allowed dispatch to race a renewal's intent lock/pending query.
      const identity = (
        await client.query(
          "SELECT intent_id FROM c3_open.quote_authorizations WHERE quote_id=$1",
          [quoteId],
        )
      ).rows[0];
      if (!identity) reject();
      await client.query(
        "SELECT intent_id FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [identity.intent_id],
      );
      // A wallet-signed renewal is a possibly executed chain operation. Do not
      // dispatch an incompatible quote until that signature is reconciled.
      const renewal = await client.query(
        `SELECT 1 FROM c3_open.renewal_submissions s
        JOIN c3_open.renewal_requests r USING(request_id)
        LEFT JOIN c3_open.plan_generations g USING(request_id)
        LEFT JOIN c3_open.renewal_outcomes o USING(request_id)
        WHERE r.intent_id=$1 AND g.request_id IS NULL AND o.request_id IS NULL LIMIT 1`,
        [identity.intent_id],
      );
      if (renewal.rowCount) reject();
      const q = (
        await client.query(
          `SELECT *,clock_timestamp() AS db_now FROM c3_open.quote_authorizations WHERE quote_id=$1 FOR UPDATE`,
          [quoteId],
        )
      ).rows[0];
      if (
        !q ||
        !Buffer.from(q.canonical_payload).equals(payload) ||
        !Buffer.from(q.payload_hash).equals(payloadHash) ||
        !Buffer.from(q.authority).equals(authority)
      )
        reject();
      const row = (
        await client.query(
          "SELECT *,clock_timestamp() AS db_now FROM c3_open.signing_requests WHERE quote_id=$1 FOR UPDATE",
          [quoteId],
        )
      ).rows[0];
      if (!row) {
        if (
          !["prepared", "signed"].includes(q.state) ||
          q.expires_at <= q.db_now
        )
          reject();
        // Commit dispatch BEFORE a remote call. A crash here intentionally leads
        // only to lookup/manual review, never a blind second signing request.
        await client.query(
          "INSERT INTO c3_open.signing_requests(request_id,quote_id,payload_hash,authority,state) VALUES($1,$2,$3,$4,'dispatched')",
          [request, quoteId, payloadHash, authority],
        );
        fresh = true;
      } else {
        if (
          !Buffer.from(row.request_id).equals(request) ||
          !Buffer.from(row.payload_hash).equals(payloadHash) ||
          !Buffer.from(row.authority).equals(authority)
        )
          reject();
        if (row.state === "result") {
          await client.query("COMMIT");
          return this.verified(payload, authority, row.signature);
        }
        if (row.state === "manual_review") reject();
        if (row.recovery_attempts >= 3 || row.db_now >= row.recovery_deadline) {
          await client.query(
            "UPDATE c3_open.signing_requests SET state='manual_review',revision=revision+1 WHERE request_id=$1",
            [request],
          );
          await client.query("COMMIT");
          reject();
        }
        await client.query(
          "UPDATE c3_open.signing_requests SET state='uncertain',recovery_attempts=recovery_attempts+1,revision=revision+1 WHERE request_id=$1",
          [request],
        );
      }
      await client.query("COMMIT");
      client.release();
      released = true;
      let result: Uint8Array | null = null;
      try {
        result = fresh
          ? await this.provider.signIdempotently(
              request.toString("hex"),
              Buffer.from(payload),
            )
          : await this.provider.lookupSignature(request.toString("hex"));
      } catch {
        /* transport failure is an uncertain result, not permission to retry */
      }
      if (!result) return reject();
      const signature = this.verified(payload, authority, result);
      // Even a late/expired result survives durably. The caller separately
      // revalidates quote expiry/CAS before returning an executable envelope.
      client = await this.pool.connect();
      released = false;
      await client.query("BEGIN");
      const r = (
        await client.query(
          "SELECT * FROM c3_open.signing_requests WHERE request_id=$1 FOR UPDATE",
          [request],
        )
      ).rows[0];
      if (r.state === "result") {
        if (!Buffer.from(r.signature).equals(signature)) reject();
      } else {
        // A known verified late result is retained even after lookup exhaustion.
        // It does not authorize an expired quote or trigger another signature.
        await client.query(
          "UPDATE c3_open.signing_requests SET signature=$2,state='result',revision=revision+1 WHERE request_id=$1",
          [request, signature],
        );
      }
      await client.query("COMMIT");
      return Buffer.from(signature);
    } catch (error) {
      if (!released) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (!released) client.release();
    }
  }
  private verified(
    payload: Buffer,
    authority: Buffer,
    value: Uint8Array,
  ): Buffer {
    const signature = Buffer.from(value),
      key = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          authority,
        ]),
        format: "der",
        type: "spki",
      });
    if (signature.length !== 64 || !verify(null, payload, key, signature))
      reject();
    return signature;
  }
}
