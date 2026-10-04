/** Local transport only. Context/compiler/durable signer use the SAME src core. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Connection } from "@solana/web3.js";
import type { Idl } from "@coral-xyz/anchor";
import type { QuoteAuthoritySigner } from "../src/quote-seal.ts";
import type { JupiterV2ReadOnlyClient } from "../src/jupiter-v2.ts";
import type { OwnerReadonlyRpc } from "../src/open-owner-service.ts";
import { C3_MAINNET } from "../src/constants.ts";
import { accountBytes, type OpenAccount } from "../src/open-state-semantics.ts";
import {
  encodeBase58,
  findProgramAddress,
  publicKeyBytes,
} from "../src/solana.ts";
import { VAULT_PROGRAM } from "../src/open-v0-envelope.ts";
import {
  verifyLegGovernance,
  type SettlementServerPolicy,
} from "../src/open-leg-factory.ts";
import { prepareIsolatedVerifiedLeg } from "../src/open-leg-authorization.ts";
import { JupiterLegCompiler } from "../src/open-jupiter-compiler.ts";

export function isolatedReadonlyRpc(connection: Connection): OwnerReadonlyRpc {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(connection.rpcEndpoint))
    throw Error("C3_OPEN_WORKFLOW_LOOPBACK_REQUIRED");
  return {
    read: async (method, params) => {
      if (
        ![
          "getGenesisHash",
          "getMultipleAccounts",
          "getAccountInfo",
          "getLatestBlockhash",
          "getMinimumBalanceForRentExemption",
          "getSignatureStatuses",
          "getTransaction",
        ].includes(method)
      )
        throw Error("C3_OPEN_WORKFLOW_READ_ONLY");
      const response = await fetch(connection.rpcEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      const body = (await response.json()) as {
        result?: unknown;
        error?: unknown;
      };
      if (!response.ok || body.error || !Object.hasOwn(body, "result"))
        throw Error("C3_OPEN_WORKFLOW_RPC_EVIDENCE");
      return body.result;
    },
  };
}

/** Derive server policy from durable enrollment and raw finalized governance;
 * this isolated adapter does NOT manufacture a Mainnet approval. */
export async function isolatedServerPolicy(
  pool: Pool,
  connection: Connection,
  idl: Idl,
  intentId: string,
) {
  const rpc = isolatedReadonlyRpc(connection),
    genesis = String(await rpc.read("getGenesisHash", []));
  if (
    genesis === C3_MAINNET.genesisHash ||
    idl.address !== VAULT_PROGRAM.toBase58()
  )
    throw Error("C3_OPEN_WORKFLOW_ISOLATION");
  const row = (
    await pool.query(
      "SELECT wallet,vault,share_mint,configuration_hash FROM c3_open.intents WHERE intent_id=$1",
      [intentId],
    )
  ).rows[0];
  if (!row) throw Error("C3_OPEN_WORKFLOW_INTENT");
  const pda = (seed: string) =>
    findProgramAddress(
      [Buffer.from(seed), publicKeyBytes(row.vault)],
      idl.address,
    ).address;
  const registry = pda("c3-route-reg-v1"),
    quotePolicy = pda("c3-quote-policy-v1"),
    names = [row.vault, registry, quotePolicy];
  const snapshot = (await rpc.read("getMultipleAccounts", [
    names,
    { commitment: "finalized", encoding: "base64" },
  ])) as { context: { slot: number }; value: OpenAccount[] };
  if (snapshot.value?.length !== 3) throw Error("C3_OPEN_WORKFLOW_ACCOUNTS");
  const cfg = accountBytes(snapshot.value[0], idl.address, 546, "VaultConfig"),
    reg = accountBytes(
      snapshot.value[1],
      idl.address,
      652,
      "RouteProgramRegistry",
    ),
    q = accountBytes(
      snapshot.value[2],
      idl.address,
      181,
      "QuoteAuthorityPolicy",
    );
  const policy: SettlementServerPolicy = {
    programId: idl.address,
    idlHash: createHash("sha256").update(JSON.stringify(idl)).digest("hex"),
    configurationHash: row.configuration_hash,
    vault: row.vault,
    wallet: row.wallet,
    shareMint: row.share_mint,
    governance: encodeBase58(cfg.subarray(17, 49)),
    keeper: encodeBase58(cfg.subarray(81, 113)),
    registry,
    registryRevision: reg.readBigUInt64LE(81).toString(),
    registryHash: reg.subarray(89, 121).toString("hex"),
    quotePolicy,
    quotePolicyRevision: q.readBigUInt64LE(81).toString(),
    quoteAuthority: encodeBase58(q.subarray(89, 121)),
    maxSlippageBps: q.readUInt16LE(130),
  };
  verifyLegGovernance(policy, {
    genesis,
    slot: snapshot.context.slot,
    accounts: Object.fromEntries(names.map((n, i) => [n, snapshot.value[i]!])),
  });
  return { policy, genesis, rpc };
}

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
  const context = await isolatedServerPolicy(
    server.pool,
    server.rpc,
    server.idl,
    request.intentId,
  );
  return prepareIsolatedVerifiedLeg(
    {
      pool: server.pool,
      connection: server.rpc,
      ...context,
      compiler: new JupiterLegCompiler(server.rpc, server.jupiter),
      recordSigner: {
        signRecord: async (id, hash) => {
          const row = (
            await server.pool.query(
              "SELECT canonical_payload,payload_hash FROM c3_open.quote_authorizations WHERE encode(quote_id,'hex')=$1",
              [id],
            )
          ).rows[0];
          if (
            !row ||
            row.canonical_payload.length !== 300 ||
            row.payload_hash.toString("hex") !== hash ||
            createHash("sha256").update(row.canonical_payload).digest("hex") !==
              hash
          )
            throw Error("C3_OPEN_WORKFLOW_EXACT_RECORD");
          // Child IPC carries record ID/hash only; it signs the exact stored bytes.
          return server.signer.signCanonicalBytes(row.canonical_payload);
        },
      },
    },
    request,
  );
}
