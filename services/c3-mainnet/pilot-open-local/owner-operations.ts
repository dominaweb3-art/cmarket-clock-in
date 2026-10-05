/** Durable owner bridge for the isolated validator. No signing, broadcast,
 * wallet callback or production capability. Requests are built from PG and
 * finalized program state, never accounts or amounts supplied by the client. */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { VAULT_PROGRAM } from "./jupiter-vault-cpi-inspection.ts";
import { C3_MAINNET as c } from "../src/constants.ts";
import { encodeBase58 } from "../src/solana.ts";
import type { Scope } from "./orchestrator.ts";
import { applyReviewedOpenSchema } from "../src/open-owner-schema.ts";
import { prepareOwnerFromDurableState } from "../src/open-owner-service.ts";
import type { OpenCompilerPolicy } from "../src/open-owner-compiler.ts";
export type OwnerOperation =
  "deposit" | "issue_shares" | "request_redemption" | "claim" | "renew_plan";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_OWNER_" + code);
};
async function isolated(rpc: Connection, idl: Idl) {
  check(
    /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint) &&
      idl.address === VAULT_PROGRAM.toBase58() &&
      (await rpc.getGenesisHash()) !== c.genesisHash,
    "ISOLATION_REQUIRED",
  );
}
async function locked(client: PoolClient, scope: Scope) {
  const row = (
    await client.query(
      "SELECT * FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
      [scope.intentId],
    )
  ).rows[0];
  check(
    row &&
      row.wallet === scope.wallet &&
      row.vault === scope.vault &&
      BigInt(row.db_revision) === scope.expectedDbRevision &&
      BigInt(row.chain_revision) === scope.expectedChainRevision,
    "CAS_OR_OWNER",
  );
  return row;
}
async function pending(client: PoolClient, id: string, own?: string) {
  const r = await client.query(
    `SELECT 1 FROM c3_open.legs WHERE intent_id=$1 AND state IN ('signed','submitted','uncertain','manual_review','reconciliation_required')
    UNION ALL SELECT 1 FROM c3_open.signing_requests s JOIN c3_open.quote_authorizations q USING(quote_id) WHERE q.intent_id=$1 AND s.state<>'result'
    UNION ALL SELECT 1 FROM c3_open.renewal_submissions s JOIN c3_open.renewal_requests r USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) LEFT JOIN c3_open.renewal_outcomes o USING(request_id) WHERE r.intent_id=$1 AND g.request_id IS NULL AND o.request_id IS NULL
    UNION ALL SELECT 1 FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) LEFT JOIN c3_open.plan_generations g USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL AND g.request_id IS NULL AND ($2::uuid IS NULL OR r.request_id<>$2) LIMIT 1`,
    [id, own ?? null],
  );
  check(!r.rowCount, "RECONCILE_PENDING_FIRST");
}
/** Atomic create+fund and create+lock prevent an interrupted wallet session
 * from consuming the only pilot slot without committing its associated step. */
export async function prepareLocalOwnerOperation(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  scope: Scope,
  action: OwnerOperation,
  minimumReview?: Parameters<typeof prepareOwnerFromDurableState>[6],
) {
  await isolated(rpc, idl);
  await applyReviewedOpenSchema(pool);
  const row = (
    await pool.query("SELECT * FROM c3_open.intents WHERE intent_id=$1", [
      scope.intentId,
    ])
  ).rows[0];
  check(
    row &&
      row.wallet === scope.wallet &&
      row.vault === scope.vault &&
      row.db_revision === scope.expectedDbRevision.toString() &&
      row.chain_revision === scope.expectedChainRevision.toString(),
    "CAS_OR_OWNER",
  );
  const config = await rpc.getAccountInfo(
    new PublicKey(row.vault),
    "finalized",
  );
  check(config?.owner.equals(VAULT_PROGRAM), "CONFIG_OWNER");
  const cfg = new BorshCoder(idl).accounts.decode(
    "VaultConfig",
    config!.data,
  ) as Record<string, unknown>;
  check(
    cfg.governance instanceof PublicKey && cfg.keeper instanceof PublicKey,
    "CONFIG_ROLES",
  );
  const idlBytes = Buffer.from(JSON.stringify(idl));
  const policy: OpenCompilerPolicy = {
    version: "c3-owner-compiler/v1",
    program: VAULT_PROGRAM.toBase58(),
    vault: row.vault,
    wallet: row.wallet,
    shareMint: row.share_mint,
    governance: (cfg.governance as PublicKey).toBase58(),
    keeper: (cfg.keeper as PublicKey).toBase58(),
    maxSlippageBps: 100,
    idlHash: hash(idlBytes).toString("hex"),
    configurationHash: row.configuration_hash,
    registryRevision: "1",
    quotePolicyRevision: "1",
  };
  // SAME production compiler, manifest and repository; only the read-only RPC
  // transport is isolated. Ephemeral signatures/submission remain in test caller.
  const prepared = await prepareOwnerFromDurableState(
    pool,
    policy,
    idlBytes,
    scope.intentId,
    action,
    {
      read: async (method, params) => {
        const response = await fetch(rpc.rpcEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        });
        const data = (await response.json()) as {
          result?: unknown;
          error?: unknown;
        };
        check(
          response.ok && !data.error && Object.hasOwn(data, "result"),
          "RPC_EVIDENCE",
        );
        return data.result;
      },
    },
    minimumReview,
  );
  return { ...prepared, packet: Buffer.from(prepared.packet, "base64") };
}
/** Persist exact verified owner signature BEFORE any explicit broadcast by the
 * test caller. Result is idempotent even if receipt response is lost. */
export async function recordLocalOwnerSignature(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  scope: Scope,
  requestId: string,
  packet: Uint8Array,
) {
  await isolated(rpc, idl);
  check(packet.length <= 1232, "SIZE");
  const tx = VersionedTransaction.deserialize(packet),
    owner = new PublicKey(scope.wallet),
    message = tx.message.serialize();
  check(
    tx.message.version === 0 &&
      tx.message.header.numRequiredSignatures === 1 &&
      tx.signatures.length === 1 &&
      tx.message.staticAccountKeys[0]!.equals(owner) &&
      verify(
        null,
        message,
        createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            owner.toBuffer(),
          ]),
          format: "der",
          type: "spki",
        }),
        tx.signatures[0]!,
      ),
    "SIGNATURE",
  );
  const signature = encodeBase58(tx.signatures[0]!);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await locked(client, scope);
    const request = (
      await client.query(
        "SELECT * FROM c3_open.owner_requests WHERE request_id=$1 AND intent_id=$2",
        [requestId, scope.intentId],
      )
    ).rows[0];
    check(
      request && request.message_hash.equals(hash(message)),
      "MESSAGE_BINDING",
    );
    const prior = (
      await client.query(
        "SELECT * FROM c3_open.owner_submissions WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    if (prior)
      check(
        prior.signature === signature &&
          prior.message_hash.equals(hash(message)),
        "IMMUTABLE_RESULT",
      );
    else {
      check(
        !(
          await client.query(
            "SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount,
        "TERMINAL_REQUEST",
      );
      check(
        BigInt(request.expected_db_revision) === BigInt(current.db_revision) &&
          BigInt(request.expected_chain_revision) ===
            BigInt(current.chain_revision),
        "REVISION",
      );
      await pending(client, scope.intentId, requestId);
      await client.query(
        "INSERT INTO c3_open.owner_submissions(request_id,signature,message_hash) VALUES($1,$2,$3)",
        [requestId, signature, hash(message)],
      );
    }
    if (request.action === "renew_plan") {
      const renewal = (
        await client.query(
          "SELECT * FROM c3_open.renewal_requests WHERE request_id=$1 AND intent_id=$2",
          [requestId, scope.intentId],
        )
      ).rows[0];
      const latest = (
        await client.query(
          "SELECT request_id FROM c3_open.renewal_requests WHERE intent_id=$1 AND plan=$2 AND expected_chain_revision=$3 ORDER BY created_at DESC,request_id DESC LIMIT 1",
          [scope.intentId, renewal?.plan, renewal?.expected_chain_revision],
        )
      ).rows[0];
      check(
        renewal &&
          (prior || latest?.request_id === requestId) &&
          renewal.message_hash.equals(hash(message)) &&
          renewal.expected_chain_revision === request.expected_chain_revision &&
          renewal.expected_db_revision === request.expected_db_revision,
        "EXACT_OWNER_RENEWAL_MESSAGE",
      );
      await client.query(
        "INSERT INTO c3_open.renewal_submissions(request_id,signature,message_hash) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING",
        [requestId, signature, hash(message)],
      );
      const stored = (
        await client.query(
          "SELECT * FROM c3_open.renewal_submissions WHERE request_id=$1",
          [requestId],
        )
      ).rows[0];
      check(
        stored.signature === signature &&
          stored.message_hash.equals(hash(message)),
        "IMMUTABLE_RENEWAL_RESULT",
      );
    }
    await client.query("COMMIT");
    return signature;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
/** Does NOT promote lifecycle: that requires the separate effects verifier. */
export async function recordLocalFinalizedOwnerMessage(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  scope: Scope,
  requestId: string,
) {
  await isolated(rpc, idl);
  const r = (
    await pool.query(
      "SELECT r.*,s.signature FROM c3_open.owner_requests r JOIN c3_open.owner_submissions s USING(request_id) WHERE r.request_id=$1 AND r.intent_id=$2",
      [requestId, scope.intentId],
    )
  ).rows[0];
  check(r, "SUBMISSION_REQUIRED");
  const tx = await rpc.getTransaction(r.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  const status = (
    await rpc.getSignatureStatuses([r.signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  check(
    tx &&
      tx.meta?.err === null &&
      status?.confirmationStatus === "finalized" &&
      status.err === null &&
      status.slot === tx.slot &&
      tx.transaction.signatures[0] === r.signature &&
      hash(tx.transaction.message.serialize()).equals(r.message_hash),
    "FINALIZED_MESSAGE_REQUIRED",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await locked(client, scope);
    await client.query(
      "INSERT INTO c3_open.owner_message_receipts(request_id,slot,evidence_hash) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING",
      [
        requestId,
        tx!.slot,
        hash(
          Buffer.from(
            JSON.stringify({
              signature: r.signature,
              slot: tx!.slot,
              messageHash: r.message_hash.toString("hex"),
            }),
          ),
        ),
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return {
    status: "FINALIZED_MESSAGE_REQUIRES_EFFECTS" as const,
    signature: r.signature,
  };
}
