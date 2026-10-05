/** Existing intent -> verified server context -> unsigned compiler -> immutable
 * PostgreSQL seal -> isolated durable signer -> signed-record commit -> packets.
 * No transaction signing, authorization override or broadcast lives here. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Connection } from "@solana/web3.js";
import {
  quoteIdForNonce,
  encodeQuoteSealV1,
  deriveQuoteMinimum,
} from "./quote-seal.ts";
import { JupiterLegCompiler } from "./open-jupiter-compiler.ts";
import { verifiedGenerationDeadline } from "./open-record-signer.ts";
import type { DurableQuoteSigningProvider } from "./open-signing-journal.ts";
import {
  isolatedLegFactory,
  captureProductionLeg,
  type SettlementServerPolicy,
} from "./open-leg-factory.ts";
import {
  type StoredQuoteContext,
  openQuoteContext,
} from "./open-quote-context.ts";
import { quoteContextHash } from "./quote-seal.ts";
import type { OwnerReadonlyRpc } from "./open-owner-service.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { OpenProductionRecordSigner } from "./open-production-signer.ts";
import { C3_MAINNET } from "./constants.ts";
import { productionQuorumConnection } from "./open-quorum-connection.ts";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
const check = (v: unknown): void => {
  if (!v) throw Error("C3_VERIFIED_QUOTE_REJECTED");
};
export async function persistVerifiedLegQuote(
  pool: Pool,
  id: string,
  ordinal: number,
  revision: bigint,
  ctx: StoredQuoteContext,
  compiler: JupiterLegCompiler,
) {
  const material = await compiler.validateAndBuild(ctx),
    contextHash = quoteContextHash(openQuoteContext(ctx));
  check(
    material.unsignedPacketBytes > 0 &&
      material.unsignedPacketBytes <= 1232 &&
      material.executionMessageHash &&
      material.effectManifest &&
      material.slippageBps > 0 &&
      material.slippageBps <= ctx.maxSlippageBps &&
      material.expiresAt - material.builderTimestamp <=
        BigInt(ctx.maxQuoteAgeSeconds),
  );
  const nonce = Buffer.from(material.authorizationNonce),
    quoteId = quoteIdForNonce(nonce),
    seal = {
      ...material,
      contextHash,
      quoteId,
      nonce,
      inputAmount: BigInt(ctx.inputAmount),
      minimumOutput: deriveQuoteMinimum(
        material.quotedOutput,
        material.slippageBps,
        material.jupiterThreshold,
        ctx.planMinimumOutput === undefined
          ? undefined
          : BigInt(ctx.planMinimumOutput),
      ),
    },
    bytes = encodeQuoteSealV1(seal);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const r = (
      await client.query(
        `SELECT i.*,clock_timestamp() AS db_now,l.state AS leg_state,l.submitted_signature,v.context_hash,v.scope,COALESCE(g.generation::text,'0') AS generation,COALESCE(g.generation::text,'0') AS latest_generation,g.expires_at AS generation_expiry,i.expires_at AS intent_expiry FROM c3_open.intents i JOIN c3_open.legs l USING(intent_id) JOIN c3_open.leg_context_verifications v USING(intent_id,ordinal) LEFT JOIN LATERAL (SELECT generation,expires_at FROM c3_open.plan_generations WHERE intent_id=i.intent_id AND plan=$4 ORDER BY generation DESC LIMIT 1) g ON true WHERE i.intent_id=$1 AND l.ordinal=$2 AND v.intent_revision=$3 FOR UPDATE OF i,l`,
        [id, ordinal, revision.toString(), ctx.plan],
      )
    ).rows[0];
    check(
      r &&
        r.db_revision === revision.toString() &&
        r.chain_revision === ctx.planRevision &&
        r.context_hash.equals(contextHash) &&
        !r.submitted_signature &&
        ["pending", "leased", "prepared"].includes(r.leg_state) &&
        ["funded", "buying", "redemption_requested", "selling"].includes(
          r.state,
        ),
    );
    const expires = new Date(Number(material.expiresAt) * 1000);
    verifiedGenerationDeadline({
      ...r,
      plan_expiry: ctx.planExpiresAt,
      expires_at: expires,
    });
    check(
      material.builderTimestamp <=
        BigInt(Math.floor(r.db_now.getTime() / 1000)) &&
        material.expiresAt > material.builderTimestamp &&
        material.builderSlot < material.expiresSlot,
    );
    await client.query(
      `INSERT INTO c3_open.quote_authorizations(quote_id,nonce,intent_id,ordinal,intent_revision,canonical_payload,payload_hash,evidence,authority,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        quoteId,
        nonce,
        id,
        ordinal,
        revision.toString(),
        bytes,
        hash(bytes),
        {
          quotedOutput: seal.quotedOutput.toString(),
          jupiterThreshold: material.jupiterThreshold.toString(),
          minimumOutput: seal.minimumOutput.toString(),
          inputAmount: seal.inputAmount.toString(),
          slippageBps: seal.slippageBps,
          unsignedPacketBytes: material.unsignedPacketBytes,
          executionMessageHash: material.executionMessageHash,
          effectManifest: material.effectManifest,
        },
        Buffer.from(ctx.authority, "hex"),
        expires,
      ],
    );
    await client.query("COMMIT");
    return {
      quoteId: quoteId.toString("hex"),
      bytes,
      payloadHash: hash(bytes).toString("hex"),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
/** Shared service core; adapters vary, persistence/compiler/signer do not. */
export async function prepareIsolatedVerifiedLeg(
  server: Readonly<{
    pool: Pool;
    rpc: OwnerReadonlyRpc;
    connection: Connection;
    genesis: string;
    policy: SettlementServerPolicy;
    recordSigner: Readonly<{
      signRecord: (id: string, hash: string) => Promise<Uint8Array>;
    }>;
    compiler?: JupiterLegCompiler;
  }>,
  request: Readonly<{
    intentId: string;
    ordinal: number;
    expectedRevision: bigint;
  }>,
) {
  if (server.genesis === C3_MAINNET.genesisHash)
    throw Error("C3_ISOLATED_MAINNET_FORBIDDEN");
  const ctx = await isolatedLegFactory(
    server.pool,
    server.policy,
    server.rpc,
    server.genesis,
  ).capture(request.intentId, request.ordinal, request.expectedRevision);
  const compiler = server.compiler ?? new JupiterLegCompiler(server.connection),
    q = await persistVerifiedLegQuote(
      server.pool,
      request.intentId,
      request.ordinal,
      request.expectedRevision,
      ctx,
      compiler,
    );
  const signature = await server.recordSigner.signRecord(
    q.quoteId,
    q.payloadHash,
  );
  const persisted = (
    await server.pool.query(
      "SELECT state,signature,payload_hash FROM c3_open.quote_authorizations WHERE quote_id=$1",
      [Buffer.from(q.quoteId, "hex")],
    )
  ).rows[0];
  check(
    persisted?.state === "signed" &&
      persisted.signature.equals(Buffer.from(signature)) &&
      persisted.payload_hash.toString("hex") === q.payloadHash,
  );
  return {
    quoteId: q.quoteId,
    unsignedPackets: compiler.unsignedPackets(
      q.quoteId,
      q.bytes,
      Buffer.from(signature),
    ),
  };
}
export async function prepareProductionVerifiedLeg(
  pool: Pool,
  signer: DurableQuoteSigningProvider,
  request: Readonly<{
    intentId: string;
    ordinal: number;
    expectedRevision: bigint;
  }>,
) {
  requireOpenProductionPolicy();
  const ctx = await captureProductionLeg(
      pool,
      request.intentId,
      request.ordinal,
      request.expectedRevision,
    ),
    compiler = new JupiterLegCompiler(productionQuorumConnection());
  const q = await persistVerifiedLegQuote(
    pool,
    request.intentId,
    request.ordinal,
    request.expectedRevision,
    ctx,
    compiler,
  );
  const signature = await new OpenProductionRecordSigner(
    pool,
    signer,
  ).signRecord(q.quoteId, q.payloadHash);
  return {
    quoteId: q.quoteId,
    unsignedPackets: compiler.unsignedPackets(
      q.quoteId,
      q.bytes,
      Buffer.from(signature),
    ),
  };
}
