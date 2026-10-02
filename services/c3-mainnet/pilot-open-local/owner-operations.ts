/** Durable owner bridge for the isolated validator. No signing, broadcast,
 * wallet callback or production capability. Requests are built from PG and
 * finalized program state, never accounts or amounts supplied by the client. */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  VAULT_PROGRAM,
  VAULT_AUTHORITY,
  vaultAta,
} from "./jupiter-vault-cpi-inspection.ts";
import { C3_MAINNET as c } from "../src/constants.ts";
import { encodeBase58 } from "../src/solana.ts";
import type { Scope } from "./orchestrator.ts";
import {
  inspectOwnerTransaction,
  type OwnerInstructionReview,
} from "../../../apps/c3-pilot/src/owner-transaction-review.ts";
export type OwnerOperation =
  "deposit" | "issue_shares" | "request_redemption" | "claim";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_OWNER_" + code);
};
const token2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ata = (owner: PublicKey, mint: PublicKey, token: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), token.toBuffer(), mint.toBuffer()],
    new PublicKey(c.associatedTokenProgram),
  )[0];
function chainIntent(prefix: string, vault: PublicKey, wallet: PublicKey) {
  const nonce = Buffer.alloc(8);
  nonce.writeBigUInt64LE(1n);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(prefix), vault.toBuffer(), wallet.toBuffer(), nonce],
    VAULT_PROGRAM,
  )[0];
}
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
    UNION ALL SELECT 1 FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_message_receipts m USING(request_id) WHERE r.intent_id=$1 AND m.request_id IS NULL AND ($2::uuid IS NULL OR r.request_id<>$2) LIMIT 1`,
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
) {
  await isolated(rpc, idl);
  const row = (
    await pool.query("SELECT * FROM c3_open.intents WHERE intent_id=$1", [
      scope.intentId,
    ])
  ).rows[0];
  check(
    row && row.wallet === scope.wallet && row.vault === scope.vault,
    "CONTEXT",
  );
  const states = {
    deposit: "draft",
    issue_shares: "buying",
    request_redemption: "active",
    claim: "claimable",
  };
  check(row.state === states[action], "STATE");
  const owner = new PublicKey(row.wallet),
    config = new PublicKey(row.vault),
    coder = new BorshCoder(idl);
  const raw = await rpc.getAccountInfo(config, "finalized");
  check(raw?.owner.equals(VAULT_PROGRAM), "CONFIG_OWNER");
  const cfg = coder.accounts.decode("VaultConfig", raw!.data) as Record<
    string,
    unknown
  >;
  const key = (v: unknown): PublicKey => {
    check(v instanceof PublicKey, "CONFIG_KEY");
    return v as PublicKey;
  };
  check(
    (!cfg.paused || action === "claim") &&
      key(cfg.allowlisted_owner).equals(owner) &&
      key(cfg.share_mint).toBase58() === row.share_mint &&
      String(cfg.config_version) === "1",
    "CONFIGURATION",
  );
  for (const [name, mint] of [
    ["usdc_mint", c.usdcMint],
    ["btc_mint", c.cbBtcMint],
    ["eth_mint", c.portalEthMint],
    ["wsol_mint", c.wrappedSolMint],
  ])
    check(key(cfg[name!]).toBase58() === mint, "MINT");
  check(
    Number(cfg.btc_bps) === 4000 &&
      Number(cfg.eth_bps) === 3000 &&
      Number(cfg.sol_bps) === 3000,
    "WEIGHTS",
  );
  const deposit = chainIntent("deposit", config, owner),
    redemption = chainIntent("redemption", config, owner);
  const plan = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-plan-v1"), deposit.toBuffer()],
    VAULT_PROGRAM,
  )[0];
  check(plan.toBase58() === row.deposit_plan, "DURABLE_PLAN");
  const share = key(cfg.share_mint),
    ownerUsdc = ata(
      owner,
      new PublicKey(c.usdcMint),
      new PublicKey(c.tokenProgram),
    ),
    ownerShares = ata(owner, share, token2022);
  const accounts: Record<string, PublicKey> = {
    owner,
    config,
    intent:
      action === "request_redemption" || action === "claim"
        ? redemption
        : deposit,
    deposit,
    vault_authority: VAULT_AUTHORITY,
    owner_usdc: ownerUsdc,
    owner_shares: ownerShares,
    share_mint: share,
    usdc_mint: new PublicKey(c.usdcMint),
    token_program: new PublicKey(c.tokenProgram),
    share_token_program: token2022,
    system_program: new PublicKey(c.systemProgram),
    vault_usdc: new PublicKey(vaultAta(c.usdcMint)),
    vault_btc: new PublicKey(vaultAta(c.cbBtcMint)),
    vault_eth: new PublicKey(vaultAta(c.portalEthMint)),
    vault_wsol: new PublicKey(vaultAta(c.wrappedSolMint)),
  };
  for (const field of ["vault_usdc", "vault_btc", "vault_eth", "vault_wsol"])
    check(key(cfg[field]).equals(accounts[field]!), "VAULT_ACCOUNT");
  // Require provisioned ATAs: no unreviewed setup instruction can be appended.
  for (const [address, token, mint] of [
    [ownerUsdc, new PublicKey(c.tokenProgram), new PublicKey(c.usdcMint)],
    [ownerShares, token2022, share],
  ] as const) {
    const a = await rpc.getAccountInfo(address, "finalized");
    check(
      a &&
        a.owner.equals(token) &&
        a.data.length >= 165 &&
        new PublicKey(a.data.subarray(0, 32)).equals(mint) &&
        new PublicKey(a.data.subarray(32, 64)).equals(owner) &&
        a.data[108] === 1,
      "ATA_UNAVAILABLE",
    );
    if (action === "deposit" && address.equals(ownerUsdc))
      check(a!.data.readBigUInt64LE(64) >= 1_000_000n, "USDC_BALANCE");
  }
  const clockRaw = await rpc.getAccountInfo(
    new PublicKey("SysvarC1ock11111111111111111111111111111111"),
    "finalized",
  );
  check(clockRaw && clockRaw.data.length === 40, "CLOCK_EVIDENCE");
  const chainNow = clockRaw!.data.readBigInt64LE(32);
  const durableExpiry = BigInt(Math.floor(row.expires_at.getTime() / 1000));
  const expiry =
    durableExpiry < chainNow + 1800n ? durableExpiry : chainNow + 1800n;
  const creation = action === "deposit" || action === "request_redemption";
  check(!creation || expiry > chainNow + 30n, "EXPIRED");
  const names =
    action === "deposit"
      ? ["create_deposit_intent", "deposit_usdc"]
      : action === "request_redemption"
        ? ["create_redemption_intent", "lock_shares_for_redemption"]
        : [action === "issue_shares" ? "issue_initial_shares" : "claim_usdc"];
  const instructions = names.map((name) => {
    const def = idl.instructions.find((i) => i.name === name);
    check(def, "IDL");
    const data = Buffer.from(def!.discriminator);
    const args = Buffer.alloc(32);
    args.writeBigUInt64LE(1n, 0);
    args.writeBigUInt64LE(1_000_000n, 8);
    args.writeBigUInt64LE(1n, 16);
    args.writeBigInt64LE(expiry, 24);
    return new TransactionInstruction({
      programId: VAULT_PROGRAM,
      data: name.startsWith("create_") ? Buffer.concat([data, args]) : data,
      keys: def!.accounts.map((a) => {
        check("name" in a && accounts[a.name], "IDL_ACCOUNT");
        return {
          pubkey: accounts[a.name]!,
          isSigner: "signer" in a && a.signer === true,
          isWritable: "writable" in a && a.writable === true,
        };
      }),
    });
  });
  const block = await rpc.getLatestBlockhash("finalized");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner,
      recentBlockhash: block.blockhash,
      instructions,
    }).compileToV0Message(),
  );
  const packet = tx.serialize();
  check(packet.length <= 1232, "SIZE");
  // Review effective privileges, including cross-instruction privilege unions.
  const templates: OwnerInstructionReview[] = instructions.map((i) => ({
    program: i.programId.toBytes(),
    data: new Uint8Array(i.data),
    accounts: i.keys.map((a) => {
      const index = tx.message.staticAccountKeys.findIndex((k) =>
        k.equals(a.pubkey),
      );
      return {
        key: a.pubkey.toBytes(),
        signer: tx.message.isAccountSigner(index),
        writable: tx.message.isAccountWritable(index),
      };
    }),
  }));
  inspectOwnerTransaction(packet, owner.toBytes(), templates);
  const client = await pool.connect();
  const requestId = randomUUID(),
    messageHash = hash(tx.message.serialize());
  try {
    await client.query("BEGIN");
    const current = await locked(client, scope);
    check(current.state === states[action], "STATE_CHANGED");
    await pending(client, scope.intentId);
    await client.query(
      "INSERT INTO c3_open.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        requestId,
        scope.intentId,
        action,
        scope.expectedDbRevision.toString(),
        scope.expectedChainRevision.toString(),
        messageHash,
        block.blockhash,
        block.lastValidBlockHeight,
        creation
          ? new Date(Number(expiry) * 1000)
          : new Date(Date.now() + 60000),
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
    action,
    intentId: scope.intentId,
    wallet: scope.wallet,
    messageHash: messageHash.toString("hex"),
    packet,
    templates,
    blockhash: block.blockhash,
    lastValidHeight: block.lastValidBlockHeight,
  });
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
