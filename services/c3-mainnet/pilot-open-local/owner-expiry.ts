/** LOCAL recovery barrier. Cancellation is never a client assertion of failure.
 * Expired blockhash + finalized unchanged account images, including config and
 * on-chain intent, are required. Signatures/evidence remain append-only. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { Connection, PublicKey } from "@solana/web3.js";
import { C3_MAINNET } from "../src/constants.ts";
import { canonicalize } from "../src/manifest.ts";
const hash = (v: string) => createHash("sha256").update(v).digest();
export async function ownerStateImage(
  rpc: Connection,
  addresses: readonly string[],
  minContextSlot?: number,
) {
  if (
    !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint) ||
    (await rpc.getGenesisHash()) === C3_MAINNET.genesisHash
  )
    throw Error("C3_OWNER_ISOLATION_REQUIRED");
  const r = await rpc.getMultipleAccountsInfoAndContext(
    addresses.map((k) => new PublicKey(k)),
    {
      commitment: "finalized",
      ...(minContextSlot === undefined ? {} : { minContextSlot }),
    },
  );
  if (
    !Number.isSafeInteger(r.context.slot) ||
    r.context.slot < Math.max(1, minContextSlot ?? 1) ||
    r.value.length !== addresses.length
  )
    throw Error("C3_OWNER_BARRIER_EVIDENCE");
  return {
    slot: r.context.slot,
    hash: hash(
      canonicalize(
        r.value.map((v, i) => ({
          address: addresses[i],
          value: v
            ? {
                owner: v.owner.toBase58(),
                executable: v.executable,
                data: v.data.toString("base64"),
              }
            : null,
        })),
      ),
    ),
  };
}
export async function closeExpiredLocalOwnerRequest(
  pool: Pool,
  rpc: Connection,
  intentId: string,
  wallet: string,
  requestId: string,
  cancelled = false,
) {
  const r = (
    await pool.query(
      `SELECT r.*,b.accounts,b.state_hash,i.wallet,s.signature FROM c3_open.owner_requests r JOIN c3_open.owner_expiry_barriers b USING(request_id) JOIN c3_open.intents i USING(intent_id) LEFT JOIN c3_open.owner_submissions s USING(request_id) WHERE r.intent_id=$1 AND r.request_id=$2`,
      [intentId, requestId],
    )
  ).rows[0];
  if (!r || r.wallet !== wallet) throw Error("C3_OWNER_EXPIRY_CONTEXT");
  if (
    !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint) ||
    (await rpc.getGenesisHash()) === C3_MAINNET.genesisHash
  )
    throw Error("C3_OWNER_ISOLATION_REQUIRED");
  if (
    (
      await pool.query(
        "SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=$1",
        [requestId],
      )
    ).rowCount
  )
    return { requestId, state: "closed_unexecuted" as const };
  const height = await rpc.getBlockHeight("finalized"),
    valid = await rpc.isBlockhashValid(r.blockhash, {
      commitment: "finalized",
    });
  if (
    !Number.isSafeInteger(height) ||
    BigInt(height) <= BigInt(r.last_valid_height) ||
    valid.value !== false ||
    !Number.isSafeInteger(valid.context.slot) ||
    valid.context.slot < 1
  )
    throw Error("C3_OWNER_EXPIRY_RECONCILE_REQUIRED");
  // AFTER blockhash invalidity: a snapshot collected before this point is unsafe.
  const image = await ownerStateImage(rpc, r.accounts, valid.context.slot);
  if (!image.hash.equals(r.state_hash))
    throw Error("C3_OWNER_EXPIRY_RECONCILE_REQUIRED");
  if (
    r.signature &&
    (
      await rpc.getSignatureStatuses([r.signature], {
        searchTransactionHistory: true,
      })
    ).value[0] !== null
  )
    throw Error("C3_OWNER_EXPIRY_KNOWN_SIGNATURE_RECONCILE");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const current = (
      await c.query(
        "SELECT wallet,db_revision,chain_revision,clock_timestamp() AS now FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [intentId],
      )
    ).rows[0];
    if (
      (
        await c.query(
          "SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=$1",
          [requestId],
        )
      ).rowCount
    ) {
      await c.query("COMMIT");
      return { requestId, state: "closed_unexecuted" as const };
    }
    if (
      current.wallet !== wallet ||
      current.db_revision !== r.expected_db_revision ||
      current.chain_revision !== r.expected_chain_revision ||
      r.expires_at > current.now
    )
      throw Error("C3_OWNER_EXPIRY_CAS");
    if (
      (
        await c.query(
          "SELECT 1 FROM c3_open.owner_message_receipts WHERE request_id=$1",
          [requestId],
        )
      ).rowCount
    )
      throw Error("C3_OWNER_EXPIRY_FINALIZED");
    const evidenceHash = hash(
      canonicalize({
        requestId,
        height,
        slot: image.slot,
        stateHash: image.hash.toString("hex"),
        blockhash: r.blockhash,
      }),
    );
    const live = (
      await c.query(
        "SELECT signature FROM c3_open.owner_submissions WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    if ((live?.signature ?? null) !== (r.signature ?? null))
      throw Error("C3_OWNER_EXPIRY_SIGNATURE_CHANGED");
    await c.query(
      "INSERT INTO c3_open.owner_request_outcomes(request_id,outcome,evidence_hash) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING",
      [
        requestId,
        cancelled ? "cancelled_unexecuted" : "expired_unexecuted",
        evidenceHash,
      ],
    );
    if (r.action === "renew_plan" && r.signature) {
      await c.query(
        "INSERT INTO c3_open.renewal_outcomes(request_id,disposition,finalized_slot,db_revision,evidence,evidence_hash) VALUES($1,'expired_unexecuted',$2,$3,$4,$5)",
        [
          requestId,
          image.slot,
          (BigInt(current.db_revision) + 1n).toString(),
          { ownerOutcomeHash: evidenceHash.toString("hex") },
          evidenceHash,
        ],
      );
    }
    await c.query(
      "UPDATE c3_open.intents SET db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
      [intentId],
    );
    await c.query("COMMIT");
    return { requestId, state: "closed_unexecuted" as const };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
