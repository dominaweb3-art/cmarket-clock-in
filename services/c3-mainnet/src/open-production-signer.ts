/** Deploy ONLY in the isolated signing process, with a TLS PostgreSQL role and
 * a reviewed external Ed25519/HSM adapter. No key loading, generation, export,
 * signing fallback, wallet authorization or transaction submission exists here.
 * Current source capability prevents every signing-provider invocation. */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Pool } from "pg";
import {
  deriveQuoteMinimum,
  quoteContextHash,
  quoteIdForNonce,
  type QuoteContextV1,
} from "./quote-seal.ts";
import { C3_MAINNET } from "./constants.ts";
import { publicKeyBytes } from "./solana.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import {
  OpenSigningJournal,
  type DurableQuoteSigningProvider,
} from "./open-signing-journal.ts";
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest();
const check = (c: unknown) => {
  if (!c) throw new Error("C3_OPEN_PRODUCTION_SIGNER_REJECTED");
};

/** Only public record ID/hash crosses this boundary; bytes come from PostgreSQL. */
export type IsolatedEd25519Provider = DurableQuoteSigningProvider;
export class OpenProductionRecordSigner {
  private readonly pool: Pool;
  private readonly provider: IsolatedEd25519Provider;
  constructor(pool: Pool, provider: IsolatedEd25519Provider) {
    this.pool = pool;
    this.provider = provider;
  }
  async signRecord(quoteId: string, expectedHash: string): Promise<Uint8Array> {
    const policy = requireOpenProductionPolicy(); // immutable false/null, before DB/HSM
    const approvedKey = Buffer.from(publicKeyBytes(policy.quoteAuthority));
    check(
      /^[a-f0-9]{64}$/.test(quoteId) && /^[a-f0-9]{64}$/.test(expectedHash),
    );
    check(Buffer.from(this.provider.publicKey).equals(approvedKey));
    let client = await this.pool.connect();
    let released = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      // Never hold an intent lock across a remote hardware-signing call.
      const result = await client.query(
        `SELECT q.*,c.context,c.context_hash,c.scope,
        i.wallet,i.vault,i.configuration_hash,i.db_revision,i.chain_revision,
        i.state AS intent_state,i.expires_at AS intent_expiry,l.state AS leg_state,
        l.submitted_signature,clock_timestamp() AS db_now
        FROM c3_open.quote_authorizations q
        JOIN c3_open.quote_contexts c USING(intent_id,ordinal,intent_revision)
        JOIN c3_open.intents i USING(intent_id)
        JOIN c3_open.legs l USING(intent_id,ordinal)
        WHERE q.quote_id=$1`,
        [Buffer.from(quoteId, "hex")],
      );
      const r = result.rows[0];
      check(
        r &&
          r.scope === "MAINNET_REVIEWED" &&
          ["prepared", "signed"].includes(r.state) &&
          ["pending", "leased", "prepared"].includes(r.leg_state) &&
          !r.submitted_signature &&
          ["funded", "buying", "redemption_requested", "selling"].includes(
            r.intent_state,
          ) &&
          r.expires_at > r.db_now &&
          r.intent_expiry > r.db_now &&
          r.expires_at <= r.intent_expiry &&
          Buffer.from(r.authority).equals(approvedKey) &&
          r.intent_revision === r.db_revision &&
          r.wallet === policy.wallet &&
          r.vault === policy.vault &&
          r.configuration_hash === policy.configurationHash,
      );
      const ctx = r.context as Record<string, string | number>;
      check(
        ctx.wallet === policy.wallet &&
          ctx.vault === policy.vault &&
          ctx.governance === policy.governance &&
          ctx.keeper === policy.keeper &&
          ctx.registry === policy.registry &&
          ctx.registryRevision === policy.registryRevision &&
          ctx.registryHash === policy.registryHash &&
          ctx.policy === policy.quotePolicy &&
          ctx.policyRevision === policy.quotePolicyRevision &&
          ctx.planRevision === r.chain_revision &&
          ctx.configurationHash === policy.configurationHash &&
          ctx.genesisHash ===
            Buffer.from(publicKeyBytes(C3_MAINNET.genesisHash)).toString(
              "hex",
            ) &&
          ctx.authority === approvedKey.toString("hex") &&
          ctx.routerProgram === C3_MAINNET.jupiterProgram &&
          ctx.leg === r.ordinal % 3 &&
          ctx.direction === (r.ordinal < 3 ? 1 : 2),
      );
      const qc: QuoteContextV1 = {
        ...(ctx as unknown as QuoteContextV1),
        genesisHash: Buffer.from(String(ctx.genesisHash), "hex"),
        registryHash: Buffer.from(String(ctx.registryHash), "hex"),
        configVersion: BigInt(String(ctx.configVersion)),
        registryRevision: BigInt(String(ctx.registryRevision)),
        policyRevision: BigInt(String(ctx.policyRevision)),
        planRevision: BigInt(String(ctx.planRevision)),
      };
      const bytes = Buffer.from(r.canonical_payload);
      check(
        bytes.length === 300 &&
          digest(bytes).toString("hex") === expectedHash &&
          digest(bytes).equals(r.payload_hash) &&
          quoteContextHash(qc).equals(r.context_hash) &&
          bytes
            .subarray(0, 17)
            .equals(
              Buffer.concat([
                Buffer.from("C3QUOTESEAL-V1!!"),
                Buffer.from([1]),
              ]),
            ) &&
          bytes.subarray(17, 49).equals(r.context_hash) &&
          bytes.subarray(49, 81).equals(r.quote_id) &&
          bytes.subarray(81, 113).equals(r.nonce) &&
          quoteIdForNonce(r.nonce).equals(r.quote_id) &&
          bytes.readBigUInt64LE(113) === BigInt(String(ctx.inputAmount)) &&
          bytes.readUInt16LE(129) > 0 &&
          bytes.readUInt16LE(129) <= policy.maxSlippageBps &&
          bytes.readBigUInt64LE(131) ===
            deriveQuoteMinimum(
              bytes.readBigUInt64LE(121),
              bytes.readUInt16LE(129),
              BigInt(r.evidence.jupiterThreshold),
            ) &&
          bytes.readBigInt64LE(284) * 1000n ===
            BigInt(r.expires_at.getTime()) &&
          bytes.readBigInt64LE(284) <= BigInt(String(ctx.planExpiresAt)) &&
          bytes.readBigInt64LE(284) - bytes.readBigInt64LE(268) <= 30n &&
          bytes.readBigInt64LE(268) <=
            BigInt(Math.floor(r.db_now.getTime() / 1000)) &&
          bytes.readBigUInt64LE(276) < bytes.readBigUInt64LE(292) &&
          r.evidence.unsignedPacketBytes > 0 &&
          r.evidence.unsignedPacketBytes <= 1232,
      );
      await client.query("COMMIT");
      client.release();
      released = true;
      const signature =
        r.signature ??
        (await new OpenSigningJournal(this.pool, this.provider).obtain(
          r.quote_id,
          bytes,
          approvedKey,
        ));
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          approvedKey,
        ]),
        format: "der",
        type: "spki",
      });
      check(
        signature.length === 64 && verify(null, bytes, publicKey, signature),
      );
      client = await this.pool.connect();
      released = false;
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const current = await client.query(
        `SELECT i.db_revision,i.state AS intent_state,i.expires_at AS intent_expiry,
        l.state AS leg_state,l.submitted_signature,clock_timestamp() AS db_now,q.*
        FROM c3_open.intents i JOIN c3_open.quote_authorizations q USING(intent_id)
        JOIN c3_open.legs l USING(intent_id,ordinal)
        WHERE q.quote_id=$1 FOR UPDATE OF i,q,l`,
        [r.quote_id],
      );
      const now = current.rows[0];
      check(
        now &&
          now.db_revision === r.intent_revision &&
          now.intent_expiry > now.db_now &&
          now.expires_at > now.db_now &&
          now.expires_at <= now.intent_expiry &&
          ["funded", "buying", "redemption_requested", "selling"].includes(
            now.intent_state,
          ) &&
          ["pending", "leased", "prepared"].includes(now.leg_state) &&
          !now.submitted_signature &&
          Buffer.from(now.authority).equals(approvedKey) &&
          Buffer.from(now.canonical_payload).equals(bytes) &&
          ["prepared", "signed"].includes(now.state),
      );
      if (now.state === "signed")
        check(Buffer.from(now.signature).equals(signature));
      else
        await client
          .query(
            "UPDATE c3_open.quote_authorizations SET signature=$2,state='signed',revision=revision+1 WHERE quote_id=$1 AND expires_at>clock_timestamp() RETURNING quote_id",
            [r.quote_id, signature],
          )
          .then((x) => check(x.rowCount === 1));
      await client.query("COMMIT");
      return Buffer.from(signature); // ONLY after durable signature commit
    } catch {
      if (!released) await client.query("ROLLBACK");
      throw new Error("C3_OPEN_PRODUCTION_SIGNER_REJECTED");
    } finally {
      if (!released) client.release();
    }
  }
}
