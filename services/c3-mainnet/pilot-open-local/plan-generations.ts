/** Owner renewal on an ISOLATED validator. Never submits/signs a transaction.
 * No RPC call occurs under a PostgreSQL lock. Public pre/post account images are
 * immutable audit evidence, not private keys or unsigned transaction payloads.
 */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Pool } from "pg";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { decodeBase58, encodeBase58 } from "../src/solana.ts";
import { C3_MAINNET } from "../src/constants.ts";
import { VAULT_PROGRAM } from "./jupiter-vault-cpi-inspection.ts";
import type { Scope } from "./orchestrator.ts";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_RENEWAL_" + code);
};
const discriminator = hash(
  Buffer.from("global:renew_settlement_plan"),
).subarray(0, 8);
const planDiscriminator = hash(Buffer.from("account:SettlementPlan")).subarray(
  0,
  8,
);
/** All fields except revision, expiry, and active authorization MUST survive. */
export function verifyRenewalImages(
  before: Buffer,
  after: Buffer,
  revision: bigint,
  expiry: bigint,
): void {
  check(
    before.length === 901 &&
      after.length === 901 &&
      before.subarray(0, 8).equals(planDiscriminator) &&
      before[8] === 2,
    "LAYOUT",
  );
  check(
    before.readBigUInt64LE(716) === revision && revision < (1n << 64n) - 1n,
    "REVISION",
  );
  check([0, 1, 3].includes(before[714]!), "PROGRESS");
  const direction = before[145],
    bitmap = before[714]!;
  check(direction === 1 || direction === 2, "DIRECTION");
  check(
    before[715] ===
      (bitmap === 0 ? (direction === 1 ? 1 : 4) : direction === 1 ? 2 : 5) ||
      (bitmap !== 0 && before[715] === 9),
    "LIFECYCLE",
  );
  for (let n = 0; n < 3; n++) {
    const input = before.readBigUInt64LE(756 + n * 8),
      budget = before.readBigUInt64LE(780 + n * 8),
      output = before.readBigUInt64LE(804 + n * 8),
      minimum = before.readBigUInt64LE(672 + n * 8);
    check(
      budget > 0n &&
        minimum > 0n &&
        ((bitmap & (1 << n)) !== 0
          ? input === budget && output >= minimum
          : input === 0n && output === 0n),
      "INVENTORY",
    );
  }
  check(expiry > before.readBigInt64LE(706), "EXPIRY");
  const expected = Buffer.from(before);
  expected.writeBigInt64LE(expiry, 706);
  expected.writeBigUInt64LE(revision + 1n, 716);
  expected.fill(0, 860, 900);
  check(expected.equals(after), "PRESERVED_FIELDS");
}
async function local(rpc: Connection, idl: Idl) {
  check(
    /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint) &&
      idl.address === VAULT_PROGRAM.toBase58(),
    "ISOLATION",
  );
  check(
    (await rpc.getGenesisHash()) !== C3_MAINNET.genesisHash,
    "MAINNET_FORBIDDEN",
  );
}
async function intent(pool: Pool, scope: Scope) {
  const r = (
    await pool.query("SELECT * FROM c3_open.intents WHERE intent_id=$1", [
      scope.intentId,
    ])
  ).rows[0];
  check(
    r &&
      r.wallet === scope.wallet &&
      r.vault === scope.vault &&
      BigInt(r.db_revision) === scope.expectedDbRevision &&
      BigInt(r.chain_revision) === scope.expectedChainRevision,
    "CAS_OR_OWNER",
  );
  check(
    ["funded", "buying", "redemption_requested", "selling"].includes(r.state),
    "STATE",
  );
  return r;
}
async function pending(pool: Pool, intentId: string, ownRequest?: string) {
  // Quote signatures are not spend signatures, but a lost signer response must
  // still be recovered. Renewing never resets that journal's attempt/deadline.
  const r = await pool.query(
    `SELECT 1 FROM c3_open.legs WHERE intent_id=$1
    AND state IN ('signed','submitted','uncertain','reconciliation_required','manual_review')
    UNION ALL SELECT 1 FROM c3_open.signing_requests s JOIN c3_open.quote_authorizations q USING(quote_id)
    WHERE q.intent_id=$1 AND s.state<>'result'
    UNION ALL SELECT 1 FROM c3_open.renewal_submissions s
      JOIN c3_open.renewal_requests r USING(request_id)
      LEFT JOIN c3_open.plan_generations g USING(request_id)
      LEFT JOIN c3_open.renewal_outcomes o USING(request_id)
      WHERE r.intent_id=$1 AND g.request_id IS NULL AND o.request_id IS NULL
        AND ($2::uuid IS NULL OR r.request_id<>$2::uuid)
    UNION ALL SELECT 1 FROM c3_open.owner_requests r
      LEFT JOIN c3_open.owner_message_receipts m USING(request_id)
      LEFT JOIN c3_open.owner_request_outcomes o USING(request_id)
      WHERE r.intent_id=$1 AND m.request_id IS NULL AND o.request_id IS NULL LIMIT 1`,
    [intentId, ownRequest ?? null],
  );
  check(!r.rowCount, "RECONCILE_PENDING_FIRST");
}
/** Signature-only durable receipt before broadcast. The caller performs no
 * automatic send here. Ephemeral local keys belong ONLY to the test caller.
 * Repeating the exact signed message is idempotent; a different signature,
 * wallet, message or stale chain revision cannot replace the receipt. */
export async function recordLocalRenewalSignature(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  scope: Scope,
  requestId: string,
  signedPacket: Uint8Array,
): Promise<string> {
  await local(rpc, idl);
  check(signedPacket.length > 0 && signedPacket.length <= 1232, "SIZE");
  const tx = VersionedTransaction.deserialize(signedPacket);
  const message = tx.message.serialize();
  const owner = new PublicKey(scope.wallet);
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
    "OWNER_SIGNATURE",
  );
  const signature = encodeBase58(tx.signatures[0]!);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT intent_id FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
      [scope.intentId],
    );
    const request = (
      await client.query(
        "SELECT * FROM c3_open.renewal_requests WHERE request_id=$1 AND intent_id=$2",
        [requestId, scope.intentId],
      )
    ).rows[0];
    check(
      request &&
        hash(message).equals(request.message_hash) &&
        request.expected_chain_revision ===
          scope.expectedChainRevision.toString() &&
        BigInt(request.expected_db_revision) <= scope.expectedDbRevision,
      "EXACT_OWNER_MESSAGE",
    );
    const prior = (
      await client.query(
        "SELECT * FROM c3_open.renewal_submissions WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    if (prior) {
      const ownerRow = (
        await client.query(
          "SELECT wallet,vault FROM c3_open.intents WHERE intent_id=$1",
          [scope.intentId],
        )
      ).rows[0];
      check(
        ownerRow.wallet === scope.wallet &&
          ownerRow.vault === scope.vault &&
          prior.signature === signature &&
          prior.message_hash.equals(request.message_hash),
        "RESULT_BINDING",
      );
    } else {
      await intent(client as unknown as Pool, scope);
      await pending(client as unknown as Pool, scope.intentId);
      const latest = (
        await client.query(
          "SELECT request_id FROM c3_open.renewal_requests WHERE intent_id=$1 AND plan=$2 AND expected_chain_revision=$3 ORDER BY created_at DESC,request_id DESC LIMIT 1",
          [scope.intentId, request.plan, request.expected_chain_revision],
        )
      ).rows[0];
      check(latest?.request_id === requestId, "OBSOLETE_RENEWAL_REQUEST");
      await client.query(
        "INSERT INTO c3_open.renewal_submissions(request_id,signature,message_hash) VALUES($1,$2,$3)",
        [requestId, signature, request.message_hash],
      );
    }
    await client.query("COMMIT");
    return signature;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
/** Explicit, read-only recovery of a failed or provably unexecuted LOCAL
 * renewal. A null status alone NEVER resolves it. Requires finalized unchanged
 * plan bytes; expiry also requires null tx, dead blockhash and finalized block
 * height beyond validity. No retry, signature deletion, new quote or broadcast.
 * Production must use independently reviewed two-operator evidence instead. */
export async function resolveLocalRenewalOutcome(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  scope: Scope,
  requestId: string,
) {
  await local(rpc, idl);
  const r = (
    await pool.query(
      `SELECT r.*,s.signature FROM c3_open.renewal_requests r
    JOIN c3_open.renewal_submissions s USING(request_id) WHERE request_id=$1 AND intent_id=$2`,
      [requestId, scope.intentId],
    )
  ).rows[0];
  check(
    r &&
      r.expected_chain_revision === scope.expectedChainRevision.toString() &&
      BigInt(r.expected_db_revision) <= scope.expectedDbRevision,
    "REQUEST",
  );
  const saved = (
    await pool.query(
      `SELECT o.*,i.wallet,i.vault FROM c3_open.renewal_outcomes o
       JOIN c3_open.renewal_requests r USING(request_id)
       JOIN c3_open.intents i USING(intent_id) WHERE request_id=$1`,
      [requestId],
    )
  ).rows[0];
  if (saved) {
    check(
      saved.wallet === scope.wallet && saved.vault === scope.vault,
      "OWNER",
    );
    return Object.freeze({
      disposition: saved.disposition as
        "failed_finalized" | "expired_unexecuted",
      signature: r.signature,
      mainnetApproved: false,
      wallet: saved.wallet as string,
      dbRevision: BigInt(saved.db_revision),
    });
  }
  const row = await intent(pool, scope);
  check(
    !(
      await pool.query(
        "SELECT 1 FROM c3_open.plan_generations WHERE request_id=$1",
        [requestId],
      )
    ).rowCount,
    "ALREADY_EXECUTED",
  );
  // Establish expiry BEFORE absence observations. Observing absence first and
  // expiry later can race a successful execution between those RPC requests.
  const validity = await rpc.isBlockhashValid(r.blockhash, {
    commitment: "finalized",
  });
  const height = await rpc.getBlockHeight("finalized");
  const barrier = await rpc.getSlot("finalized");
  check(
    Number.isSafeInteger(height) &&
      Number.isSafeInteger(barrier) &&
      barrier >= Number(r.observed_slot) &&
      Number.isSafeInteger(validity.context.slot) &&
      barrier >= validity.context.slot,
    "FINALIZED_BARRIER",
  );
  const statuses = await rpc.getSignatureStatuses([r.signature], {
    searchTransactionHistory: true,
  });
  check(
    Number.isSafeInteger(statuses.context.slot) &&
      statuses.context.slot >= barrier,
    "STALE_STATUS_CONTEXT",
  );
  const status = statuses.value[0];
  const tx = await rpc.getTransaction(r.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  const state = await rpc.getAccountInfoAndContext(new PublicKey(r.plan), {
    commitment: "finalized",
    minContextSlot: Math.max(barrier, status?.slot ?? 0),
  });
  check(
    state.value?.owner.equals(VAULT_PROGRAM) &&
      !state.value.executable &&
      Number.isSafeInteger(state.context.slot) &&
      state.context.slot >= Math.max(barrier, status?.slot ?? 0) &&
      state.value.data.equals(r.pre_state),
    "UNCHANGED_FINALIZED_PLAN_REQUIRED",
  );
  let disposition: "failed_finalized" | "expired_unexecuted";
  let failure: unknown = null;
  if (status?.confirmationStatus === "finalized" && status.err !== null) {
    check(
      tx?.meta &&
        tx.meta.err !== null &&
        JSON.stringify(tx.meta.err) === JSON.stringify(status.err) &&
        tx.slot === status.slot &&
        state.context.slot >= tx.slot &&
        tx.transaction.signatures.length === 1 &&
        tx.transaction.signatures[0] === r.signature &&
        hash(tx.transaction.message.serialize()).equals(r.message_hash),
      "FAILED_TRANSACTION_REQUIRED",
    );
    const meta = tx!.meta!;
    check(
      meta.preTokenBalances?.length === 0 &&
        meta.postTokenBalances?.length === 0 &&
        meta.preBalances.length ===
          tx!.transaction.message.staticAccountKeys.length &&
        meta.postBalances.length === meta.preBalances.length &&
        Number.isSafeInteger(meta.fee) &&
        meta.fee >= 0 &&
        meta.preBalances.every(
          (n, i) =>
            Number.isSafeInteger(n) &&
            n >= 0 &&
            Number.isSafeInteger(meta.postBalances[i]) &&
            meta.postBalances[i]! >= 0 &&
            n - meta.postBalances[i]! === (i === 0 ? meta.fee : 0),
        ),
      "FAILED_UNEXPECTED_EFFECTS",
    );
    disposition = "failed_finalized";
    failure = status.err;
  } else {
    check(status === null && tx === null, "UNCERTAIN_RENEWAL");
    check(
      validity.value === false &&
        Number.isSafeInteger(height) &&
        height > Number(r.last_valid_block_height),
      "UNCERTAIN_RENEWAL",
    );
    disposition = "expired_unexecuted";
  }
  const evidence = {
    scope: "LOCAL_VALIDATOR_ONLY",
    signature: r.signature,
    disposition,
    finalizedSlot: state.context.slot,
    blockHeight: height,
    error: failure,
    messageHash: r.message_hash.toString("hex"),
    planHash: hash(state.value!.data).toString("hex"),
  };
  const digest = hash(Buffer.from(JSON.stringify(evidence)));
  const client = await pool.connect();
  let dbRevision = scope.expectedDbRevision + 1n;
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT intent_id FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
      [scope.intentId],
    );
    await intent(client as unknown as Pool, scope);
    check(
      !(
        await client.query(
          "SELECT 1 FROM c3_open.plan_generations WHERE request_id=$1",
          [requestId],
        )
      ).rowCount,
      "ALREADY_EXECUTED",
    );
    const prior = (
      await client.query(
        "SELECT disposition,evidence_hash FROM c3_open.renewal_outcomes WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    if (prior) check(prior.disposition === disposition, "OUTCOME_CONFLICT");
    else {
      // Write the common intent row, not only lock it: a concurrent serializable
      // generation reconciliation must abort rather than see an old snapshot.
      const changed = await client.query(
        "UPDATE c3_open.intents SET db_revision=db_revision+1 WHERE intent_id=$1 AND db_revision=$2 AND chain_revision=$3 RETURNING db_revision",
        [
          scope.intentId,
          scope.expectedDbRevision.toString(),
          scope.expectedChainRevision.toString(),
        ],
      );
      check(changed.rowCount === 1, "CAS_OR_OWNER");
      dbRevision = BigInt(changed.rows[0].db_revision);
      await client.query(
        "INSERT INTO c3_open.renewal_outcomes(request_id,disposition,finalized_slot,db_revision,evidence,evidence_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          requestId,
          disposition,
          state.context.slot,
          dbRevision.toString(),
          evidence,
          digest,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return Object.freeze({
    disposition,
    signature: r.signature,
    mainnetApproved: false,
    wallet: row.wallet,
    dbRevision,
  });
}
/** Prepare exact owner-only renewal bytes and durable preimage before MWA.
 * The caller must preserve the request id. No automatic refresh/resubmission. */
export async function prepareLocalRenewal(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  scope: Scope,
  options: Readonly<{
    resumeRequestId?: string;
    replaceExpired?: boolean;
  }> = {},
) {
  await local(rpc, idl);
  const row = await intent(pool, scope);
  await pending(pool, scope.intentId);
  const plan =
    row.state === "funded" || row.state === "buying"
      ? row.deposit_plan
      : row.redemption_plan;
  const raw = await rpc.getMultipleAccountsInfoAndContext(
    [
      new PublicKey(row.vault),
      new PublicKey(plan),
      new PublicKey("SysvarC1ock11111111111111111111111111111111"),
    ],
    "finalized",
  );
  const [cfg, p, clock] = raw.value;
  check(
    cfg?.owner.equals(VAULT_PROGRAM) &&
      p?.owner.equals(VAULT_PROGRAM) &&
      !p.executable &&
      clock?.data.length === 40 &&
      clock.owner.toBase58() === "Sysvar1111111111111111111111111111111111111",
    "ACCOUNT_OWNER",
  );
  const c = new BorshCoder(idl).accounts.decode(
    "VaultConfig",
    cfg!.data,
  ) as Record<string, unknown>;
  check(
    c.allowlisted_owner instanceof PublicKey &&
      c.allowlisted_owner.toBase58() === row.wallet,
    "CONFIG_OWNER",
  );
  const pre = p!.data;
  check(pre.length === 901, "LAYOUT");
  check(
    PublicKey.findProgramAddressSync(
      [Buffer.from("c3-vault-v1")],
      VAULT_PROGRAM,
    )[0].toBase58() === row.vault &&
      c.share_mint instanceof PublicKey &&
      c.share_mint.toBase58() === row.share_mint &&
      String(c.config_version) === pre.readBigUInt64LE(9).toString(),
    "CONFIG_BINDING",
  );
  for (const [field, mint] of [
    ["usdc_mint", C3_MAINNET.usdcMint],
    ["btc_mint", C3_MAINNET.cbBtcMint],
    ["eth_mint", C3_MAINNET.portalEthMint],
    ["wsol_mint", C3_MAINNET.wrappedSolMint],
  ]) {
    check(
      c[field!] instanceof PublicKey &&
        (c[field!] as PublicKey).toBase58() === mint,
      "ASSET_POLICY",
    );
  }
  const planPda = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-plan-v1"), pre.subarray(49, 81)],
    VAULT_PROGRAM,
  );
  check(
    planPda[0].toBase58() === plan &&
      planPda[1] === pre[900] &&
      pre.subarray(17, 49).equals(new PublicKey(row.vault).toBuffer()) &&
      pre.subarray(81, 113).equals(new PublicKey(row.wallet).toBuffer()) &&
      pre.subarray(113, 145).equals(new PublicKey(row.share_mint).toBuffer()),
    "PLAN_BINDING",
  );
  const latest = (
    await pool.query(
      "SELECT * FROM c3_open.renewal_requests WHERE intent_id=$1 AND plan=$2 AND expected_chain_revision=$3 ORDER BY created_at DESC,request_id DESC LIMIT 1",
      [scope.intentId, plan, scope.expectedChainRevision.toString()],
    )
  ).rows[0];
  const now = clock!.data.readBigInt64LE(32);
  let expiry = now + 120n;
  let blockhash: { blockhash: string; lastValidBlockHeight: number };
  let resume = false;
  if (latest) {
    check(
      latest.pre_state.equals(pre) &&
        BigInt(latest.expected_db_revision) <= scope.expectedDbRevision,
      "PREIMAGE_CHANGED",
    );
    const valid = (
      await rpc.isBlockhashValid(latest.blockhash, { commitment: "finalized" })
    ).value;
    if (options.resumeRequestId === latest.request_id) {
      check(
        valid && now < BigInt(latest.expires_at),
        "RENEWAL_MESSAGE_EXPIRED",
      );
      expiry = BigInt(latest.expires_at);
      blockhash = {
        blockhash: latest.blockhash,
        lastValidBlockHeight: Number(latest.last_valid_block_height),
      };
      resume = true;
    } else {
      check(
        options.replaceExpired === true &&
          !valid &&
          now >= BigInt(latest.expires_at),
        "EXPLICIT_RESUME_OR_EXPIRED_REPLACEMENT_REQUIRED",
      );
      blockhash = await rpc.getLatestBlockhash("finalized");
    }
  } else blockhash = await rpc.getLatestBlockhash("finalized");
  check(now >= pre.readBigInt64LE(706), "NOT_EXPIRED");
  const predicted = Buffer.from(pre);
  predicted.writeBigInt64LE(expiry, 706);
  predicted.writeBigUInt64LE(scope.expectedChainRevision + 1n, 716);
  predicted.fill(0, 860, 900);
  verifyRenewalImages(pre, predicted, scope.expectedChainRevision, expiry);
  const legRows = (
    await pool.query(
      "SELECT ordinal,state FROM c3_open.legs WHERE intent_id=$1 ORDER BY ordinal",
      [scope.intentId],
    )
  ).rows;
  const start = pre[145] === 1 ? 0 : 3;
  check(
    start === (row.state === "funded" || row.state === "buying" ? 0 : 3),
    "DIRECTION_BINDING",
  );
  check(
    legRows.length === 6 &&
      legRows
        .slice(start, start + 3)
        .every(
          (l, n) =>
            (l.state === "confirmed") === ((pre[714]! & (1 << n)) !== 0),
        ),
    "UNRECONCILED_PROGRESS",
  );
  const data = Buffer.alloc(24);
  discriminator.copy(data);
  data.writeBigUInt64LE(scope.expectedChainRevision, 8);
  data.writeBigInt64LE(expiry, 16);
  const ix = new TransactionInstruction({
    programId: VAULT_PROGRAM,
    keys: [
      { pubkey: new PublicKey(row.wallet), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(row.vault), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(plan), isSigner: false, isWritable: true },
    ],
    data,
  });
  const message = new TransactionMessage({
    payerKey: new PublicKey(row.wallet),
    recentBlockhash: blockhash.blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message),
    packet = tx.serialize();
  check(packet.length <= 1232, "SIZE");
  if (resume) {
    check(
      hash(message.serialize()).equals(latest.message_hash),
      "RESUME_MESSAGE_CHANGED",
    );
    return Object.freeze({
      requestId: latest.request_id as string,
      transaction: packet,
      blockhash,
      expiresAt: expiry,
      plan,
      expectedRevision: scope.expectedChainRevision,
    });
  }
  const requestId = randomUUID(),
    client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT intent_id FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
      [scope.intentId],
    );
    await intent(client as unknown as Pool, scope);
    await pending(client as unknown as Pool, scope.intentId);
    const currentLatest = (
      await client.query(
        "SELECT request_id FROM c3_open.renewal_requests WHERE intent_id=$1 AND plan=$2 AND expected_chain_revision=$3 ORDER BY created_at DESC,request_id DESC LIMIT 1",
        [scope.intentId, plan, scope.expectedChainRevision.toString()],
      )
    ).rows[0];
    check(
      currentLatest?.request_id === latest?.request_id,
      "CONCURRENT_RENEWAL_REQUEST",
    );
    await client.query(
      `INSERT INTO c3_open.renewal_requests(request_id,intent_id,plan,expected_db_revision,expected_chain_revision,expires_at,pre_state,message_hash,observed_slot,blockhash,last_valid_block_height)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        requestId,
        scope.intentId,
        plan,
        scope.expectedDbRevision.toString(),
        scope.expectedChainRevision.toString(),
        expiry.toString(),
        pre,
        hash(message.serialize()),
        raw.context.slot,
        blockhash.blockhash,
        blockhash.lastValidBlockHeight,
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return Object.freeze({
    requestId,
    transaction: packet,
    blockhash,
    expiresAt: expiry,
    plan,
    expectedRevision: scope.expectedChainRevision,
  });
}
/** Only actual finalized owner bytes can advance the generation. Null/timeout
 * remains pending. Never signs, submits, deletes a signature or retries a leg. */
export async function reconcileLocalRenewal(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  scope: Scope,
  requestId: string,
  signature: string,
) {
  await local(rpc, idl);
  const request = (
    await pool.query(
      "SELECT * FROM c3_open.renewal_requests WHERE request_id=$1 AND intent_id=$2",
      [requestId, scope.intentId],
    )
  ).rows[0];
  check(
    request &&
      BigInt(request.expected_db_revision) <= scope.expectedDbRevision &&
      request.expected_chain_revision ===
        scope.expectedChainRevision.toString(),
    "REQUEST",
  );
  const cached = (
    await pool.query(
      `SELECT g.*,i.wallet,i.vault,e.db_revision FROM c3_open.plan_generations g
    JOIN c3_open.intents i USING(intent_id) JOIN c3_open.events e ON e.intent_id=g.intent_id
      AND e.evidence_hash=encode(g.evidence_hash,'hex') AND e.safe_reason='OWNER_PLAN_RENEWED'
    WHERE g.request_id=$1`,
      [requestId],
    )
  ).rows[0];
  if (cached) {
    check(
      cached.renewal_signature === signature &&
        cached.wallet === scope.wallet &&
        cached.vault === scope.vault,
      "RESULT_BINDING",
    );
    return Object.freeze({
      generation: BigInt(cached.generation),
      chainRevision: BigInt(cached.base_revision),
      dbRevision: BigInt(cached.db_revision),
      evidenceHash: cached.evidence_hash.toString("hex"),
    });
  }
  const row = await intent(pool, scope);
  await pending(pool, scope.intentId, requestId);
  check(
    !(
      await pool.query(
        "SELECT 1 FROM c3_open.renewal_outcomes WHERE request_id=$1",
        [requestId],
      )
    ).rowCount,
    "RESULT_CONFLICT",
  );
  const submitted = (
    await pool.query(
      "SELECT signature FROM c3_open.renewal_submissions WHERE request_id=$1",
      [requestId],
    )
  ).rows[0];
  check(submitted?.signature === signature, "DURABLE_OWNER_SIGNATURE_REQUIRED");
  const status = (
    await rpc.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  check(
    status?.confirmationStatus === "finalized" && status.err === null,
    "FINALITY_REQUIRED",
  );
  const tx = await rpc.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  check(
    tx?.meta &&
      tx.meta.err === null &&
      tx.slot === status!.slot &&
      tx.slot >= Number(request.observed_slot),
    "TRANSACTION",
  );
  const msg = tx!.transaction.message;
  check(
    msg.header.numRequiredSignatures === 1 &&
      tx!.transaction.signatures.length === 1 &&
      tx!.transaction.signatures[0] === signature &&
      msg.staticAccountKeys[0]!.toBase58() === row.wallet &&
      hash(msg.serialize()).equals(request.message_hash),
    "EXACT_OWNER_MESSAGE",
  );
  check(
    verify(
      null,
      msg.serialize(),
      createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          new PublicKey(row.wallet).toBuffer(),
        ]),
        format: "der",
        type: "spki",
      }),
      decodeBase58(signature),
    ),
    "OWNER_SIGNATURE",
  );
  check(
    Array.isArray(tx!.meta!.innerInstructions) &&
      tx!.meta!.innerInstructions!.every((g) => g.instructions.length === 0) &&
      (tx!.meta!.preTokenBalances?.length ?? -1) === 0 &&
      (tx!.meta!.postTokenBalances?.length ?? -1) === 0,
    "UNEXPECTED_EFFECTS",
  );
  check(
    Number.isSafeInteger(tx!.meta!.fee) &&
      tx!.meta!.fee >= 0 &&
      tx!.meta!.preBalances.length === msg.staticAccountKeys.length &&
      tx!.meta!.preBalances.length === tx!.meta!.postBalances.length &&
      tx!.meta!.preBalances.every(
        (v, i) =>
          Number.isSafeInteger(v) &&
          v >= 0 &&
          tx!.meta!.postBalances[i]! >= 0 &&
          Number.isSafeInteger(tx!.meta!.postBalances[i]) &&
          v - tx!.meta!.postBalances[i]! === (i === 0 ? tx!.meta!.fee : 0),
      ),
    "LAMPORT_EFFECTS",
  );
  const post = await rpc.getAccountInfoAndContext(new PublicKey(request.plan), {
    commitment: "finalized",
    minContextSlot: tx!.slot,
  });
  check(
    post.value?.owner.equals(VAULT_PROGRAM) &&
      !post.value.executable &&
      Number.isSafeInteger(post.context.slot) &&
      post.context.slot >= tx!.slot,
    "POST_OWNER",
  );
  verifyRenewalImages(
    request.pre_state,
    post.value!.data,
    scope.expectedChainRevision,
    BigInt(request.expires_at),
  );
  const evidenceHash = hash(
    Buffer.concat([
      request.message_hash,
      decodeBase58(signature),
      post.value!.data,
    ]),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT intent_id FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
      [scope.intentId],
    );
    await intent(client as unknown as Pool, scope);
    await pending(client as unknown as Pool, scope.intentId, requestId);
    check(
      !(
        await client.query(
          "SELECT 1 FROM c3_open.renewal_outcomes WHERE request_id=$1",
          [requestId],
        )
      ).rowCount,
      "RESULT_CONFLICT",
    );
    const generation =
      BigInt(
        (
          await client.query(
            "SELECT COALESCE(max(generation),0)::text AS n FROM c3_open.plan_generations WHERE intent_id=$1 AND plan=$2",
            [scope.intentId, request.plan],
          )
        ).rows[0].n,
      ) + 1n;
    const revision = scope.expectedChainRevision + 1n;
    await client.query(
      `INSERT INTO c3_open.plan_generations(intent_id,plan,generation,base_revision,request_id,renewal_signature,finalized_slot,post_state,evidence_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10))`,
      [
        scope.intentId,
        request.plan,
        generation.toString(),
        revision.toString(),
        requestId,
        signature,
        tx!.slot,
        post.value!.data,
        evidenceHash,
        request.expires_at,
      ],
    );
    await client.query(
      "UPDATE c3_open.intents SET chain_revision=$2,db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
      [scope.intentId, revision.toString()],
    );
    const start = request.pre_state[145] === 1 ? 0 : 3;
    for (let ordinal = start; ordinal < start + 3; ordinal++) {
      const l = (
        await client.query(
          "SELECT * FROM c3_open.legs WHERE intent_id=$1 AND ordinal=$2 FOR UPDATE",
          [scope.intentId, ordinal],
        )
      ).rows[0];
      if (l.state === "confirmed") continue;
      check(
        ["pending", "leased", "prepared"].includes(l.state) &&
          !l.submitted_signature,
        "PENDING_LEG",
      );
      await client.query(
        "INSERT INTO c3_open.leg_attempt_history SELECT intent_id,ordinal,$3,$4,to_jsonb(l) FROM c3_open.legs l WHERE intent_id=$1 AND ordinal=$2",
        [scope.intentId, ordinal, generation.toString(), request.plan],
      );
      await client.query(
        `UPDATE c3_open.legs SET state='pending',route_hash=NULL,instruction_hash=NULL,authorization_hash=NULL,input_mint=NULL,output_mint=NULL,
       source_account=NULL,destination_account=NULL,input_amount=NULL,minimum_output=NULL,quote_expires_at=NULL,expected_effects=NULL,
       lease_owner=NULL,lease_expires_at=NULL,reason_code=NULL,updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2`,
        [scope.intentId, ordinal],
      );
      await client.query(
        "UPDATE c3_open.quote_authorizations SET state='manual_review',revision=revision+1 WHERE intent_id=$1 AND ordinal=$2 AND state IN ('prepared','signed')",
        [scope.intentId, ordinal],
      );
    }
    const eventId = randomUUID();
    await client.query(
      "INSERT INTO c3_open.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash,safe_reason) VALUES($1,$2,$3,$4,$5,$6,'OWNER_PLAN_RENEWED')",
      [
        eventId,
        scope.intentId,
        hash(
          Buffer.concat([
            Buffer.from("c3-owner-renewal-event-v1"),
            Buffer.from(requestId),
            request.message_hash,
          ]),
        ).toString("hex"),
        (scope.expectedDbRevision + 1n).toString(),
        row.state,
        evidenceHash.toString("hex"),
      ],
    );
    await client.query("INSERT INTO c3_open.outbox(event_id) VALUES($1)", [
      eventId,
    ]);
    await client.query("COMMIT");
    return Object.freeze({
      generation,
      chainRevision: revision,
      dbRevision: scope.expectedDbRevision + 1n,
      evidenceHash: evidenceHash.toString("hex"),
    });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
