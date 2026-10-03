/** Test-only HTTP bridge pinned to ONE existing intent. Loopback listener only,
 * no broadcast endpoint, no caller-supplied wallet/amount/PDA/policy/CAS.
 * Production authentication/bootstrap remains separately gated. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import {
  VAULT_PROGRAM,
  VAULT_AUTHORITY,
} from "./jupiter-vault-cpi-inspection.ts";
import { C3_MAINNET } from "../src/constants.ts";
import {
  prepareLocalOwnerOperation,
  recordLocalOwnerSignature,
  type OwnerOperation,
} from "./owner-operations.ts";
import { closeExpiredLocalOwnerRequest } from "./owner-expiry.ts";
export function createIsolatedOwnerServer(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  intentId: string,
  onFailure?: (code: string) => void,
) {
  if (
    !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint) ||
    !/^[a-f0-9-]{36}$/.test(intentId)
  )
    throw Error("C3_OWNER_SERVER_ISOLATION");
  return createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    try {
      if (
        !req.socket.localAddress?.match(
          /^(127\.0\.0\.1|::ffff:127\.0\.0\.1)$/,
        ) ||
        req.headers.origin
      )
        throw Error("C3_OWNER_LOOPBACK_ONLY");
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      let body: Record<string, unknown> = {};
      if (req.method === "POST") {
        const parts: Buffer[] = [];
        let n = 0;
        for await (const part of req) {
          n += part.length;
          if (n > 4096) throw Error("C3_OWNER_BODY_LIMIT");
          parts.push(Buffer.from(part));
        }
        body = JSON.parse(Buffer.concat(parts).toString());
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw Error("C3_OWNER_BODY");
      }
      const row = (
        await pool.query("SELECT * FROM c3_open.intents WHERE intent_id=$1", [
          intentId,
        ])
      ).rows[0];
      if (!row) throw Error("C3_OWNER_INTENT_MISSING");
      const scope = {
        intentId,
        wallet: row.wallet as string,
        vault: row.vault as string,
        expectedDbRevision: BigInt(row.db_revision),
        expectedChainRevision: BigInt(row.chain_revision),
        idempotencyHash: createHash("sha256")
          .update("owner-api:" + intentId + ":" + row.db_revision)
          .digest("hex"),
      };
      if (
        req.method === "POST" &&
        u.pathname === "/v1/c3/owner/close-expired" &&
        Object.keys(body).sort().join(",") === "cancelled,requestId" &&
        typeof body.requestId === "string" &&
        typeof body.cancelled === "boolean"
      ) {
        await closeExpiredLocalOwnerRequest(
          pool,
          rpc,
          intentId,
          row.wallet,
          body.requestId,
          body.cancelled,
        );
        res.end(
          JSON.stringify({
            requestId: body.requestId,
            state: "closed_unexecuted",
          }),
        );
      } else if (
        req.method === "POST" &&
        u.pathname === "/v1/c3/owner/prepare" &&
        Object.keys(body).sort().join(",") === "action,intentId" &&
        body.intentId === intentId &&
        ["deposit", "issue_shares", "request_redemption", "claim"].includes(
          String(body.action),
        )
      ) {
        const p = await prepareLocalOwnerOperation(
          pool,
          rpc,
          idl,
          scope,
          body.action as OwnerOperation,
        );
        const expiry = (
          await pool.query(
            "SELECT expires_at FROM c3_open.owner_requests WHERE request_id=$1",
            [p.requestId],
          )
        ).rows[0].expires_at;
        res.end(
          JSON.stringify({
            ...p,
            packet: Buffer.from(p.packet).toString("base64"),
            templates: undefined,
            expiry: Math.floor(expiry.getTime() / 1000),
          }),
        );
      } else if (
        req.method === "POST" &&
        u.pathname === "/v1/c3/owner/receipt" &&
        Object.keys(body).sort().join(",") === "packet,requestId" &&
        typeof body.requestId === "string" &&
        typeof body.packet === "string" &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(body.packet)
      ) {
        const bytes = Buffer.from(body.packet, "base64");
        if (bytes.toString("base64") !== body.packet)
          throw Error("C3_OWNER_ENCODING");
        const signature = await recordLocalOwnerSignature(
          pool,
          rpc,
          idl,
          scope,
          body.requestId,
          bytes,
        );
        res.end(JSON.stringify({ signature }));
      } else if (
        req.method === "GET" &&
        u.pathname === "/v1/c3/owner/position" &&
        u.search === ""
      ) {
        const token = new PublicKey(
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          ),
          owner = new PublicKey(row.wallet),
          mint = new PublicKey(row.share_mint);
        const account = PublicKey.findProgramAddressSync(
          [owner.toBuffer(), token.toBuffer(), mint.toBuffer()],
          new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        )[0];
        if (
          (await rpc.getGenesisHash()) === C3_MAINNET.genesisHash ||
          idl.address !== VAULT_PROGRAM.toBase58()
        )
          throw Error("C3_OWNER_POSITION_UNVERIFIED");
        const raw = await rpc.getMultipleAccountsInfoAndContext(
          [account, mint, new PublicKey(row.vault)],
          { commitment: "finalized" },
        );
        const [ata, shareMint, config] = raw.value;
        if (!config || !config.owner.equals(VAULT_PROGRAM))
          throw Error("C3_OWNER_POSITION_UNVERIFIED");
        const cfg = new BorshCoder(idl).accounts.decode(
          "VaultConfig",
          config.data,
        ) as {
          allowlisted_owner: PublicKey;
          share_mint: PublicKey;
          schema_version: number;
          btc_bps: number;
          eth_bps: number;
          sol_bps: number;
        };
        if (
          !ata ||
          !shareMint ||
          cfg.schema_version !== 1 ||
          !cfg.allowlisted_owner.equals(owner) ||
          !cfg.share_mint.equals(mint) ||
          cfg.btc_bps !== 4000 ||
          cfg.eth_bps !== 3000 ||
          cfg.sol_bps !== 3000 ||
          !ata.owner.equals(token) ||
          !shareMint.owner.equals(token) ||
          shareMint.data.length < 82 ||
          shareMint.data[44] !== 6 ||
          shareMint.data[45] !== 1 ||
          shareMint.data.readUInt32LE(0) !== 1 ||
          !new PublicKey(shareMint.data.subarray(4, 36)).equals(
            VAULT_AUTHORITY,
          ) ||
          ata.data.length < 165 ||
          !new PublicKey(ata.data.subarray(0, 32)).equals(mint) ||
          !new PublicKey(ata.data.subarray(32, 64)).equals(owner) ||
          ata.data[108] !== 1 ||
          ata.data.readBigUInt64LE(64) > shareMint.data.readBigUInt64LE(36) ||
          !Number.isSafeInteger(raw.context.slot) ||
          raw.context.slot <= 0
        )
          throw Error("C3_OWNER_POSITION_UNVERIFIED");
        res.end(
          JSON.stringify({
            wallet: row.wallet,
            shareMint: row.share_mint,
            shareUnits: ata.data.readBigUInt64LE(64).toString(),
            shareDecimals: 6,
            slot: raw.context.slot,
            scope: "LOCAL_CLONE",
            nav: null,
          }),
        );
      } else if (
        req.method === "GET" &&
        u.pathname === "/v1/c3/owner/status" &&
        [...u.searchParams.keys()].join(",") === "requestId"
      ) {
        const r = (
          await pool.query(
            "SELECT r.request_id,r.message_hash,s.signature,e.evidence_hash,o.evidence_hash AS closure_hash FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_submissions s USING(request_id) LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) WHERE r.request_id=$1 AND r.intent_id=$2",
            [u.searchParams.get("requestId"), intentId],
          )
        ).rows[0];
        if (!r) throw Error("C3_OWNER_REQUEST_MISSING");
        // Economic finality is NOT inferred from owner_message_receipts.
        res.end(
          JSON.stringify({
            requestId: r.request_id,
            messageHash: r.message_hash.toString("hex"),
            signature: r.signature ?? null,
            state: r.closure_hash
              ? "closed_unexecuted"
              : r.evidence_hash
                ? "finalized"
                : r.signature
                  ? "signed"
                  : "uncertain",
            ...(r.evidence_hash || r.closure_hash
              ? {
                  economicEvidenceHash: (
                    r.evidence_hash ?? r.closure_hash
                  ).toString("hex"),
                  evidenceScope: "LOCAL_CLONE",
                }
              : {}),
          }),
        );
      } else throw Error("C3_OWNER_ROUTE_INVALID");
    } catch (error) {
      const code =
        error instanceof Error && /^C3_OWNER_[A-Z_]+$/.test(error.message)
          ? error.message
          : "C3_OWNER_INTERNAL_CHECK_FAILED";
      onFailure?.(code);
      res.statusCode = 409;
      res.end(JSON.stringify({ error: code }));
    }
  });
}
