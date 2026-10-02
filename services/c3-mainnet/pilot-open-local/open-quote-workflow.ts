/** Single server-side entrypoint for an EXISTING durable intent / leg.
 * No caller quote, threshold, destination, signer, policy or ALT is accepted.
 * The isolated signer is injected by server bootstrap, never by a public request.
 * This entrypoint is not exported or enabled in the production package.
 */
import type { Pool } from "pg";
import type { Connection } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import type { QuoteAuthoritySigner } from "../src/quote-seal.ts";
import { captureContext } from "./capture-context.ts";
import { JupiterOpenBuilder } from "./jupiter-open-builder.ts";
import { OpenQuoteAuthority } from "./open-quote.ts";
import type { JupiterV2ReadOnlyClient } from "../src/jupiter-v2.ts";
export async function prepareOpenUnsignedLeg(
  server: Readonly<{
    pool: Pool;
    rpc: Connection;
    idl: Idl;
    signer: QuoteAuthoritySigner;
    jupiter?: JupiterV2ReadOnlyClient;
  }>,
  request: Readonly<{
    intentId: string;
    ordinal: number;
    expectedRevision: bigint;
  }>,
): Promise<
  Readonly<{ quoteId: string; unsignedPackets: readonly Uint8Array[] }>
> {
  await captureContext(
    server.pool,
    server.rpc,
    server.idl,
    request.intentId,
    request.ordinal,
    request.expectedRevision,
  );
  const builder = new JupiterOpenBuilder(server.rpc, server.jupiter);
  const authority = new OpenQuoteAuthority(server.pool, builder);
  const quoteId = await authority.prepare(
    request.intentId,
    request.ordinal,
    request.expectedRevision,
  );
  const signed = await authority.signPersisted(quoteId, server.signer);
  // The signature has committed to PostgreSQL BEFORE packets leave this flow.
  return Object.freeze({
    quoteId,
    unsignedPackets: builder.unsignedPackets(
      quoteId,
      signed.payload,
      signed.signature,
    ),
  });
}
