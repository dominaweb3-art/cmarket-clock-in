/** Server reconciler ingestion; never accept trusted context in a public request.
 * Reads actual program-owned accounts using the source-controlled Anchor layout.
 * LOCAL validator only. No keys, mutation on-chain, wallet or transaction creation.
 */
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { C3_MAINNET } from "../src/constants.ts";
import { quoteContextHash } from "../src/quote-seal.ts";
import { openQuoteContext, type StoredQuoteContext } from "./open-quote.ts";
import {
  VAULT_PROGRAM,
  VAULT_AUTHORITY,
} from "./jupiter-vault-cpi-inspection.ts";
const assert = (c: unknown, code: string): void => {
  if (!c) throw new Error(`C3_CONTEXT_${code}`);
};
const record = (value: unknown): Record<string, unknown> => {
  assert(value && typeof value === "object", "INVALID_ACCOUNT");
  return value as Record<string, unknown>;
};
const key = (r: Record<string, unknown>, n: string): string => {
  const v = r[n];
  assert(v instanceof PublicKey, "INVALID_KEY");
  return (v as PublicKey).toBase58();
};
const integer = (r: Record<string, unknown>, n: string): bigint => {
  const v = r[n];
  assert(v !== undefined && v !== null, "MISSING_INTEGER");
  const s = String(v);
  assert(/^(0|[1-9][0-9]{0,19})$/.test(s), "INVALID_INTEGER");
  return BigInt(s);
};
const bytes = (
  r: Record<string, unknown>,
  n: string,
  length: number,
): Buffer => {
  const v = r[n];
  assert(
    Array.isArray(v) &&
      v.length === length &&
      v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255),
    "INVALID_BYTES",
  );
  return Buffer.from(v as number[]);
};

export async function captureContext(
  pool: Pool,
  rpc: Connection,
  idl: Idl,
  intentId: string,
  ordinal: number,
  expectedRevision: bigint,
): Promise<void> {
  assert(
    /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint),
    "LOCAL_RPC_REQUIRED",
  );
  assert(idl.address === VAULT_PROGRAM.toBase58(), "IDL_ADDRESS");
  assert(Number.isInteger(ordinal) && ordinal >= 0 && ordinal < 6, "LEG");
  const genesis = await rpc.getGenesisHash();
  assert(genesis !== C3_MAINNET.genesisHash, "MAINNET_FORBIDDEN");
  const row = (
    await pool.query<{
      wallet: string;
      vault: string;
      share_mint: string;
      deposit_plan: string;
      redemption_plan: string | null;
      configuration_hash: string;
      db_revision: string;
      chain_revision: string;
    }>(
      "SELECT wallet,vault,share_mint,deposit_plan,redemption_plan,configuration_hash,db_revision,chain_revision FROM c3_open.intents WHERE intent_id=$1",
      [intentId],
    )
  ).rows[0];
  assert(row && row.db_revision === expectedRevision.toString(), "CAS");
  const config = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-vault-v1")],
    VAULT_PROGRAM,
  )[0];
  assert(config.toBase58() === row!.vault, "VAULT_PDA");
  const registry = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-route-reg-v1"), config.toBuffer()],
    VAULT_PROGRAM,
  )[0];
  const policy = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-quote-policy-v1"), config.toBuffer()],
    VAULT_PROGRAM,
  )[0];
  const planKey = ordinal < 3 ? row!.deposit_plan : row!.redemption_plan;
  assert(planKey, "PLAN_MISSING");
  const snapshot = await rpc.getMultipleAccountsInfoAndContext(
    [config, registry, policy, new PublicKey(planKey!)],
    "confirmed",
  );
  const coder = new BorshCoder(idl);
  const names = [
    "VaultConfig",
    "RouteProgramRegistry",
    "QuoteAuthorityPolicy",
    "SettlementPlan",
  ];
  const decoded = snapshot.value.map((a, i) => {
    assert(
      a && !a.executable && a.owner.equals(VAULT_PROGRAM),
      "OWNER_OR_MISSING",
    );
    return record(coder.accounts.decode(names[i]!, a!.data));
  });
  const [c, r, q, p] = decoded as [
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  assert(
    c.paused === false && r.enabled === true && q.enabled === true,
    "DISABLED_POLICY",
  );
  assert(
    key(c, "allowlisted_owner") === row!.wallet &&
      key(c, "share_mint") === row!.share_mint &&
      key(p, "wallet") === row!.wallet &&
      key(p, "vault") === row!.vault &&
      key(r, "vault") === row!.vault &&
      key(q, "vault") === row!.vault,
    "CONTEXT_BINDING",
  );
  assert(
    key(r, "governance") === key(c, "governance") &&
      key(q, "governance") === key(c, "governance"),
    "GOVERNANCE_BINDING",
  );
  for (const [field, mint] of [
    ["usdc_mint", C3_MAINNET.usdcMint],
    ["btc_mint", C3_MAINNET.cbBtcMint],
    ["eth_mint", C3_MAINNET.portalEthMint],
    ["wsol_mint", C3_MAINNET.wrappedSolMint],
  ])
    assert(key(c, field!) === mint, "ASSET_POLICY");
  const expectedPlan = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-plan-v1"), new PublicKey(key(p, "intent")).toBuffer()],
    VAULT_PROGRAM,
  )[0];
  assert(expectedPlan.toBase58() === planKey, "PLAN_PDA");
  assert(
    integer(c, "config_version") === integer(p, "config_version") &&
      integer(c, "config_version") === integer(r, "config_version") &&
      integer(c, "config_version") === integer(q, "config_version"),
    "CONFIG_VERSION",
  );
  assert(
    integer(p, "revision").toString() === row!.chain_revision &&
      integer(p, "executed_bitmap") === (1n << BigInt(ordinal % 3)) - 1n,
    "PLAN_REVISION",
  );
  assert(key(p, "router_program") === C3_MAINNET.jupiterProgram, "ROUTER");
  assert(
    integer(r, "activation_slot") <= BigInt(snapshot.context.slot) &&
      integer(r, "expiry_slot") > BigInt(snapshot.context.slot),
    "REGISTRY_EXPIRY",
  );
  assert(
    bytes(q, "genesis_hash", 32).equals(new PublicKey(genesis).toBuffer()) &&
      bytes(q, "domain", 16).toString() === "C3QUOTESEAL-V1!!" &&
      integer(q, "max_age_seconds") <= 30n,
    "QUOTE_POLICY",
  );
  const getLegKey = (n: string) => {
    const list = p[n];
    assert(Array.isArray(list) && list.length === 3, "PLAN_ARRAY");
    return key({ v: (list as unknown[])[ordinal % 3] }, "v");
  };
  const source = getLegKey("source_accounts"),
    destination = getLegKey("destination_accounts");
  const asset = [
    C3_MAINNET.cbBtcMint,
    C3_MAINNET.portalEthMint,
    C3_MAINNET.wrappedSolMint,
  ][ordinal % 3]!;
  assert(
    getLegKey("input_mints") === (ordinal < 3 ? C3_MAINNET.usdcMint : asset) &&
      getLegKey("output_mints") === (ordinal < 3 ? asset : C3_MAINNET.usdcMint),
    "LEG_MINT_POLICY",
  );
  assert(
    source ===
      key(
        c,
        ordinal < 3
          ? "vault_usdc"
          : ["vault_btc", "vault_eth", "vault_wsol"][ordinal % 3]!,
      ) &&
      destination ===
        key(
          c,
          ordinal < 3
            ? ["vault_btc", "vault_eth", "vault_wsol"][ordinal % 3]!
            : "vault_usdc",
        ),
    "LEG_DESTINATION_POLICY",
  );
  const tokens = await rpc.getMultipleAccountsInfo(
    [new PublicKey(source), new PublicKey(destination)],
    "confirmed",
  );
  for (const [i, a] of tokens.entries()) {
    assert(
      a?.owner.toBase58() === C3_MAINNET.tokenProgram &&
        a.data.length === 165 &&
        a.data[108] === 1 &&
        new PublicKey(a.data.subarray(32, 64)).equals(VAULT_AUTHORITY) &&
        a.data.readUInt32LE(72) === 0 &&
        a.data.readUInt32LE(129) === 0,
      "TOKEN_AUTHORITY",
    );
    assert(
      new PublicKey(a!.data.subarray(0, 32)).toBase58() ===
        getLegKey(i === 0 ? "input_mints" : "output_mints"),
      "TOKEN_MINT",
    );
  }
  const amount =
    ordinal < 3
      ? (1_000_000n * [4000n, 3000n, 3000n][ordinal]!) / 10000n
      : tokens[0]!.data.readBigUInt64LE(64);
  assert(
    integer(p, "direction") === BigInt(ordinal < 3 ? 1 : 2) &&
      integer(c, "btc_bps") === 4000n &&
      integer(c, "eth_bps") === 3000n &&
      integer(c, "sol_bps") === 3000n,
    "ALLOCATION_DIRECTION",
  );
  const programCount = Number(integer(r, "program_count"));
  assert(
    programCount > 0 && programCount <= 16 && Array.isArray(r.programs),
    "REGISTRY_PROGRAMS",
  );
  const reviewedPrograms = (r.programs as unknown[])
    .slice(0, programCount)
    .map((value) => key({ v: value }, "v"));
  const ctx: StoredQuoteContext = {
    keeper: key(c, "keeper"),
    governance: key(c, "governance"),
    policy: policy.toBase58(),
    reviewedPrograms,
    genesisHash: bytes(q, "genesis_hash", 32).toString("hex"),
    vault: row!.vault,
    configVersion: integer(c, "config_version").toString(),
    registry: registry.toBase58(),
    registryRevision: integer(r, "revision").toString(),
    registryHash: bytes(r, "config_hash", 32).toString("hex"),
    plan: planKey!,
    planRevision: row!.chain_revision,
    intent: key(p, "intent"),
    wallet: row!.wallet,
    leg: ordinal % 3,
    direction: ordinal < 3 ? 1 : 2,
    inputMint: getLegKey("input_mints"),
    outputMint: getLegKey("output_mints"),
    source,
    destination,
    routerProgram: C3_MAINNET.jupiterProgram,
    policyRevision: integer(q, "revision").toString(),
    inputAmount: amount.toString(),
    authority: new PublicKey(key(q, "authority")).toBuffer().toString("hex"),
    maxSlippageBps: Number(integer(q, "max_slippage_bps")),
    maxQuoteAgeSeconds: Number(integer(q, "max_age_seconds")),
    planExpiresAt: integer(p, "expires_at").toString(),
    configurationHash: row!.configuration_hash,
  };
  const proof = {
    ...ctx,
    accountHashes: snapshot.value.map((a) =>
      createHash("sha256").update(a!.data).digest("hex"),
    ),
    slot: snapshot.context.slot,
    program: VAULT_PROGRAM.toBase58(),
  };
  // INSERT SELECT rechecks durable CAS. No intents or historical seals copied.
  const inserted = await pool.query(
    `INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope)
    SELECT intent_id,$2,db_revision,$4,$5,'LOCAL_CLONE' FROM c3_open.intents WHERE intent_id=$1 AND db_revision=$3 AND chain_revision=$6`,
    [
      intentId,
      ordinal,
      expectedRevision.toString(),
      proof,
      quoteContextHash(openQuoteContext(ctx)),
      row!.chain_revision,
    ],
  );
  assert(inserted.rowCount === 1, "CAS");
}
