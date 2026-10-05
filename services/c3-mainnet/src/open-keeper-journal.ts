/** Shared, immutable keeper packet/signature journal. No key loading, signing,
 * broadcast, fixture imports, automatic migration or retry lives here. */
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { VersionedTransaction } from "@solana/web3.js";
import { canonicalize } from "./manifest.ts";
import { C3_MAINNET as c } from "./constants.ts";
import { encodeBase58, findProgramAddress, publicKeyBytes } from "./solana.ts";
import {
  accountBytes,
  openAddresses,
  verifyOpenConfig,
  verifyOpenShareMint,
  verifyOpenIntent,
  verifyOpenPlan,
  verifyOpenToken,
  type OpenAccount,
} from "./open-state-semantics.ts";
import {
  approvedOwnerCompilerPolicy,
  assertProductionEnrollment,
} from "./open-owner-trust.ts";
import {
  requireOpenProductionPolicy,
  type OpenProductionPolicy,
} from "./open-production-policy.ts";
import {
  productionOwnerRpc,
  type OwnerReadonlyRpc,
} from "./open-owner-service.ts";
import {
  verifyLegGovernance,
  type SettlementServerPolicy,
} from "./open-leg-factory.ts";
import {
  compileKeeperFromDurableState,
  type KeeperAction,
} from "./open-keeper-compiler.ts";
import { JupiterLegCompiler } from "./open-jupiter-compiler.ts";
import { productionQuorumConnection } from "./open-quorum-connection.ts";
import { collectFinalizedOpenEconomicEvidence } from "./open-economic-quorum.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
import { verifyProductionVaultArtifact } from "./open-vault-artifact.ts";
import { proveKeeperNonExecution } from "./open-keeper-expiry.ts";

const digest = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest();
const demand = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_KEEPER_" + code);
};
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
type Compilation = Awaited<ReturnType<typeof compileKeeperFromDurableState>>;
export type KeeperManifest = Compilation["manifest"] & {
  genesis: string;
  planRent: number;
  snapshotAccounts: readonly string[];
};
type Pair<T = unknown> = Readonly<{ primary: T; secondary: T }>;
export type KeeperEvidence = Readonly<{
  genesis: Pair<string>;
  statuses: Pair;
  transaction: Pair;
  wire: Pair;
  snapshots: Pair;
}>;
/** A paired READ-ONLY port. Production collection below fixes reviewed providers;
 * isolated callers must be explicitly non-Mainnet and cannot enroll approval. */
export type KeeperEvidenceIntake = Readonly<{
  collect: (
    signature: string,
    accounts: readonly string[],
    minimumSlot: number,
  ) => Promise<KeeperEvidence>;
  readExpiryPair?: (method: string, params: unknown[]) => Promise<unknown>;
}>;
/** Recovery reporting is NOT a proof of non-execution. Wall-clock staleness
 * never permits packet replacement, signature deletion or barrier release. */
export function keeperRecoveryDisposition(
  manifest: KeeperManifest,
  signature: string | null,
  attempted: boolean,
  receipt: boolean,
  nowMs: number,
) {
  demand(Number.isSafeInteger(nowMs) && nowMs > 0, "RECOVERY_CLOCK");
  const create = manifest.action.startsWith("create"),
    now = BigInt(nowMs);
  const staleCreationWindow =
    create &&
    (BigInt(manifest.expiry) * 1000n <= now ||
      (BigInt(manifest.created) + 30n) * 1000n < now ||
      manifest.materialEvidence.some(
        (e) => BigInt(String(e.expires)) * 1000n <= now,
      ));
  return Object.freeze({
    state: receipt
      ? ("FINALIZED_EFFECTS_VERIFIED" as const)
      : staleCreationWindow
        ? ("STALE_PACKET_BLOCKED" as const)
        : attempted
          ? ("SEND_ATTEMPTED_RECONCILE_ONLY" as const)
          : signature
            ? ("SIGNED_REVIEW_REQUIRED" as const)
            : ("UNSIGNED_REVIEW_REQUIRED" as const),
    staleCreationWindow,
    automaticallyResend: false as const,
    replacementAllowed: false as const,
    barrierReleased: receipt,
    closedUnexecuted: false as const,
    failedOrExpiredClosure:
      "EXPLICIT_FINALIZED_NON_EXECUTION_PROOF_REQUIRED" as const,
  });
}
type RpcInner = { programIdIndex: number; accounts: number[]; data: string };
type RpcToken = {
  accountIndex: number;
  owner: string;
  mint: string;
  programId: string;
  uiTokenAmount: { amount: string; decimals: number };
};
type RpcMeta = {
  err: unknown;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances: RpcToken[];
  postTokenBalances: RpcToken[];
  innerInstructions: { index: number; instructions: RpcInner[] }[];
};
type RpcBody = {
  signatures: string[];
  message: {
    header: unknown;
    recentBlockhash: string;
    accountKeys: string[];
    instructions: unknown[];
    addressTableLookups?: unknown[];
  };
};
const object = <T extends object>(v: unknown): T => {
  demand(v && typeof v === "object" && !Array.isArray(v), "EVIDENCE_SHAPE");
  return v as T;
};
const scopeOf = (p: SettlementServerPolicy) =>
  approvedOwnerCompilerPolicy({
    ...p,
    version: "c3-open-production/v1",
  } as OpenProductionPolicy);
const stateFor = (action: KeeperAction) =>
  ({
    create_buy_plan: "funded",
    create_sell_plan: "redemption_requested",
    record_buy: "buying",
    record_sell: "selling",
  })[action];

/** Explicit additive DDL for the owned journal. Bootstrap must apply/review it
 * separately; constructing a journal never modifies the schema. */
export const KEEPER_JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS c3_open.keeper_packets (
 request_id uuid PRIMARY KEY, intent_id uuid NOT NULL REFERENCES c3_open.intents,
 action text NOT NULL CHECK(action IN ('create_buy_plan','create_sell_plan','record_buy','record_sell')),
 scope text NOT NULL CHECK(scope IN ('ISOLATED_VERIFIED','MAINNET_REVIEWED')),
 genesis text NOT NULL CHECK((scope='MAINNET_REVIEWED')=(genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')), expected_db_revision bigint NOT NULL CHECK(expected_db_revision>=0),
 expected_chain_revision bigint NOT NULL CHECK(expected_chain_revision>=0),
 packet bytea NOT NULL CHECK(octet_length(packet)<=1232), message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
 manifest jsonb NOT NULL, manifest_hash bytea NOT NULL CHECK(octet_length(manifest_hash)=32),
 policy_hash bytea NOT NULL CHECK(octet_length(policy_hash)=32), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS c3_open.keeper_signatures (
 request_id uuid PRIMARY KEY REFERENCES c3_open.keeper_packets,
 signature text NOT NULL UNIQUE CHECK(signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'), packet bytea NOT NULL CHECK(octet_length(packet)<=1232),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS c3_open.keeper_send_attempts (
 request_id uuid PRIMARY KEY REFERENCES c3_open.keeper_signatures,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS c3_open.keeper_effect_receipts (
 request_id uuid PRIMARY KEY REFERENCES c3_open.keeper_signatures,
 signature text NOT NULL UNIQUE, finalized_slot bigint NOT NULL CHECK(finalized_slot>0),
 evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS keeper_intent_packets ON c3_open.keeper_packets(intent_id);
CREATE OR REPLACE FUNCTION c3_open.keeper_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN RAISE EXCEPTION 'C3_KEEPER_APPEND_ONLY'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['keeper_packets','keeper_signatures','keeper_send_attempts','keeper_effect_receipts'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_immutable' AND tgrelid=('c3_open.'||t)::regclass) THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON c3_open.%I FOR EACH ROW EXECUTE FUNCTION c3_open.keeper_immutable()',t||'_immutable',t);
 END IF; END LOOP;
END $$;
-- Every opposing preparation locks the same intent BEFORE checking the pending
-- keeper packet. This includes an unsigned packet and never assumes no signature
-- means no possible send. An unresolved/failed packet blocks, not silently retries.
CREATE OR REPLACE FUNCTION c3_open.keeper_pending_barrier() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
 PERFORM 1 FROM c3_open.intents WHERE intent_id=NEW.intent_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM c3_open.keeper_packets p LEFT JOIN c3_open.keeper_effect_receipts r USING(request_id)
 WHERE p.intent_id=NEW.intent_id AND r.request_id IS NULL) THEN RAISE EXCEPTION 'C3_KEEPER_RECONCILE_PENDING'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['keeper_packets','owner_requests','renewal_requests','leg_context_verifications'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_keeper_barrier' AND tgrelid=('c3_open.'||t)::regclass) THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON c3_open.%I FOR EACH ROW EXECUTE FUNCTION c3_open.keeper_pending_barrier()',t||'_keeper_barrier',t);
 END IF; END LOOP;
END $$;
REVOKE ALL ON c3_open.keeper_packets,c3_open.keeper_signatures,c3_open.keeper_send_attempts,c3_open.keeper_effect_receipts FROM PUBLIC;
`;

export function verifyKeeperSignedPacket(
  packet: Uint8Array,
  unsignedPacket: Uint8Array,
  keeper: string,
) {
  demand(packet.length <= 1232, "SIZE");
  const tx = VersionedTransaction.deserialize(packet),
    prepared = VersionedTransaction.deserialize(unsignedPacket);
  demand(
    tx.message.version === 0 &&
      tx.signatures.length === 1 &&
      tx.message.header.numRequiredSignatures === 1 &&
      tx.message.staticAccountKeys[0]?.toBase58() === keeper &&
      Buffer.from(tx.message.serialize()).equals(
        Buffer.from(prepared.message.serialize()),
      ) &&
      verify(
        null,
        tx.message.serialize(),
        createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            Buffer.from(publicKeyBytes(keeper)),
          ]),
          format: "der",
          type: "spki",
        }),
        tx.signatures[0]!,
      ),
    "SIGNED_MESSAGE",
  );
  return encodeBase58(tx.signatures[0]!);
}

function expectedPlan(policy: SettlementServerPolicy, m: KeeperManifest) {
  const scope = scopeOf(policy),
    a = openAddresses(scope),
    sell = m.action === "create_sell_plan",
    b = Buffer.alloc(901);
  digest("account:SettlementPlan").copy(b, 0, 0, 8);
  b[8] = 2;
  b.writeBigUInt64LE(1n, 9);
  [policy.vault, m.onchainIntent, policy.wallet, policy.shareMint].forEach(
    (v, i) => Buffer.from(publicKeyBytes(v)).copy(b, 17 + i * 32),
  );
  b[145] = sell ? 2 : 1;
  b.writeBigUInt64LE(1000000n, 146);
  const intent = verifyOpenIntent(
    scope,
    m.preAccounts[m.onchainIntent]!,
    sell,
    [2],
  );
  for (let i = 0; i < 3; i++) {
    b.writeUInt16LE([4000, 3000, 3000][i]!, 154 + i * 2);
    const asset = [c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i]!,
      input = sell ? asset : c.usdcMint,
      output = sell ? c.usdcMint : asset;
    [
      input,
      output,
      sell ? a.vaultTokens[i + 1]! : a.vaultTokens[0]!,
      sell ? a.vaultTokens[0]! : a.vaultTokens[i + 1]!,
    ].forEach((v, j) =>
      Buffer.from(publicKeyBytes(v)).copy(b, [160, 256, 352, 448][j]! + i * 32),
    );
    Buffer.from(m.routes[i]!, "hex").copy(b, 576 + i * 32);
    b.writeBigUInt64LE(BigInt(m.minima[i]!), 672 + i * 8);
    b.writeBigUInt64LE(
      sell
        ? intent.readBigUInt64LE(122 + i * 8)
        : [400000n, 300000n, 300000n][i]!,
      780 + i * 8,
    );
  }
  Buffer.from(publicKeyBytes(c.jupiterProgram)).copy(b, 544);
  b.writeUInt16LE(policy.maxSlippageBps, 696);
  b.writeBigInt64LE(BigInt(m.created), 698);
  b.writeBigInt64LE(BigInt(m.expiry), 706);
  b[715] = sell ? 4 : 1;
  Buffer.from(m.settlementId, "hex").copy(b, 724);
  b[900] = findProgramAddress(
    [Buffer.from("c3-plan-v1"), publicKeyBytes(m.onchainIntent)],
    policy.programId,
  ).bump;
  return b;
}

/** Independent semantic proof, not RPC agreement or a fixture attestation. */
export function verifyKeeperEffects(
  policy: SettlementServerPolicy,
  manifest: KeeperManifest,
  unsigned: Uint8Array,
  signed: Uint8Array,
  evidence: KeeperEvidence,
) {
  const signature = verifyKeeperSignedPacket(signed, unsigned, policy.keeper),
    tx = VersionedTransaction.deserialize(signed),
    m = manifest,
    scope = scopeOf(policy),
    a = openAddresses(scope);
  demand(
    m.version === "c3-keeper-packet/v1" &&
      m.policyHash === digest(canonicalize(policy)).toString("hex") &&
      m.messageHash === digest(tx.message.serialize()).toString("hex") &&
      m.wallet === policy.wallet &&
      m.vault === policy.vault &&
      evidence.genesis.primary === m.genesis &&
      evidence.genesis.secondary === m.genesis,
    "MANIFEST_OR_GENESIS",
  );
  const create = m.action.startsWith("create"),
    sell = m.action.includes("sell");
  demand(
    m.plan === (sell ? a.redemptionPlan : a.depositPlan) &&
      m.onchainIntent === (sell ? a.redemption : a.deposit) &&
      tx.message.addressTableLookups.length === 0 &&
      tx.message.compiledInstructions.length === 1,
    "SCOPE",
  );
  const expectedKeys = create
    ? [policy.keeper, policy.vault, m.onchainIntent, m.plan, c.systemProgram]
    : [
        policy.keeper,
        policy.vault,
        m.onchainIntent,
        m.plan,
        ...a.vaultTokens,
        c.tokenProgram,
      ];
  const ix = tx.message.compiledInstructions[0]!,
    instructionName = {
      create_buy_plan: "create_deposit_settlement_plan",
      create_sell_plan: "create_redemption_settlement_plan",
      record_buy: "record_deposit_settlement",
      record_sell: "record_redemption_settlement",
    }[m.action];
  const data = Buffer.from(ix.data),
    discriminator = digest("global:" + instructionName).subarray(0, 8);
  demand(
    tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58() ===
      policy.programId &&
      ix.accountKeyIndexes.length === expectedKeys.length &&
      expectedKeys.every(
        (k, i) =>
          tx.message.staticAccountKeys[ix.accountKeyIndexes[i]!]!.toBase58() ===
          k,
      ) &&
      data.subarray(0, 8).equals(discriminator) &&
      data.length === (create ? 178 : 40),
    "INSTRUCTION",
  );
  demand(
    expectedKeys.every(
      (k, i) =>
        tx.message.isAccountWritable(ix.accountKeyIndexes[i]!) ===
        (i === 0 || i === 2 || (create && i === 3)),
    ) &&
      tx.message.staticAccountKeys.length === expectedKeys.length + 1 &&
      tx.message.header.numReadonlySignedAccounts === 0,
    "ACCOUNT_PRIVILEGES",
  );
  if (create) {
    demand(
      data
        .subarray(8, 104)
        .equals(Buffer.concat(m.routes.map((r) => Buffer.from(r, "hex")))) &&
        m.minima.every(
          (v, i) => data.readBigUInt64LE(104 + i * 8) === BigInt(v),
        ) &&
        data.readBigInt64LE(128).toString() === m.created &&
        data.readBigInt64LE(136).toString() === m.expiry &&
        data.readUInt16LE(144) === policy.maxSlippageBps &&
        data.subarray(146).toString("hex") === m.settlementId,
      "PLAN_MESSAGE",
    );
  } else
    demand(
      data.subarray(8).toString("hex") === m.settlementId,
      "RECORD_MESSAGE",
    );
  demand(
    canonicalize(evidence.transaction.primary) ===
      canonicalize(evidence.transaction.secondary) &&
      canonicalize(evidence.wire.primary) ===
        canonicalize(evidence.wire.secondary),
    "TRANSACTION_DISAGREEMENT",
  );
  const raw = object<{ slot: number; meta: unknown; transaction: unknown }>(
      evidence.transaction.primary,
    ),
    meta = object<RpcMeta>(raw.meta),
    body = object<RpcBody>(raw.transaction),
    wire = object<{
      slot: number;
      meta: RpcMeta;
      transaction: [string, string];
    }>(evidence.wire.primary);
  demand(
    Number.isSafeInteger(raw.slot) &&
      raw.slot >= m.slot &&
      meta.err === null &&
      body.signatures?.length === 1 &&
      body.signatures[0] === signature &&
      wire.slot === raw.slot &&
      wire.meta?.err === null &&
      canonicalize(wire.meta) === canonicalize(meta),
    "FINALIZED_TRANSACTION",
  );
  demand(
    Array.isArray(wire.transaction) &&
      wire.transaction[1] === "base64" &&
      Buffer.from(wire.transaction[0], "base64").equals(Buffer.from(signed)),
    "WIRE_MESSAGE",
  );
  const jsonMessage = object<RpcBody["message"]>(body.message);
  demand(Array.isArray(jsonMessage.instructions), "JSON_INSTRUCTIONS");
  const outer = jsonMessage.instructions.map((value) => {
    const i = object<Record<string, unknown>>(value);
    demand(
      Object.keys(i).every((k) =>
        ["programIdIndex", "accounts", "data", "stackHeight"].includes(k),
      ) &&
        (!Object.hasOwn(i, "stackHeight") ||
          i.stackHeight === null ||
          i.stackHeight === 1),
      "JSON_STACK_HEIGHT",
    );
    // stackHeight is RPC execution metadata, not serialized instruction data.
    // All actual message fields still match the durable signed wire exactly.
    return {
      programIdIndex: i.programIdIndex,
      accounts: i.accounts,
      data: i.data,
    };
  });
  demand(
    canonicalize(jsonMessage.header) === canonicalize(tx.message.header) &&
      jsonMessage.recentBlockhash === tx.message.recentBlockhash &&
      canonicalize(jsonMessage.accountKeys) ===
        canonicalize(tx.message.staticAccountKeys.map((k) => k.toBase58())) &&
      canonicalize(outer) ===
        canonicalize(
          tx.message.compiledInstructions.map((i) => ({
            programIdIndex: i.programIdIndex,
            accounts: Array.from(i.accountKeyIndexes),
            data: encodeBase58(i.data),
          })),
        ) &&
      canonicalize(jsonMessage.addressTableLookups ?? []) === "[]",
    "JSON_MESSAGE",
  );
  for (const response of [
    evidence.statuses.primary,
    evidence.statuses.secondary,
  ]) {
    const values = object<{ value: unknown[] }>(response).value;
    demand(Array.isArray(values) && values.length === 1, "FINALITY");
    const status = object<{
      confirmationStatus: string;
      err: unknown;
      slot: number;
    }>(values[0]);
    demand(
      status.confirmationStatus === "finalized" &&
        status.err === null &&
        status.slot === raw.slot,
      "FINALITY",
    );
  }
  // JSONB reorders object keys; preserve the RPC positional order explicitly.
  const names = m.snapshotAccounts;
  demand(
    Array.isArray(names) &&
      new Set(names).size === names.length &&
      canonicalize([...names].sort()) ===
        canonicalize(Object.keys(m.preAccounts).sort()),
    "SNAPSHOT_ACCOUNTS",
  );
  const snapshots = [
    evidence.snapshots.primary,
    evidence.snapshots.secondary,
  ].map((v) => {
    const s = object<{
      context: { slot: number };
      value: (OpenAccount | null)[];
    }>(v);
    demand(
      Number.isSafeInteger(s.context?.slot) &&
        s.context.slot >= raw.slot &&
        Array.isArray(s.value) &&
        s.value.length === names.length,
      "SNAPSHOT_BARRIER",
    );
    return Object.fromEntries(names.map((n, i) => [n, s.value[i]])) as Record<
      string,
      OpenAccount
    >;
  });
  const post = snapshots[0]!;
  for (const n of names.filter((n) => n !== CLOCK))
    demand(
      canonicalize(post[n]) === canonicalize(snapshots[1]![n]),
      "SNAPSHOT_DISAGREEMENT",
    );
  const cfg = verifyOpenConfig(scope, post[policy.vault]!);
  verifyOpenShareMint(scope, post[policy.shareMint]!);
  demand(!cfg.paused, "PAUSED");
  verifyLegGovernance(policy, {
    slot: raw.slot,
    genesis: m.genesis,
    accounts: post,
  });
  a.vaultTokens.forEach((n, i) =>
    verifyOpenToken(
      post[n]!,
      a.authority,
      [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i]!,
    ),
  );
  const beforeIntent = verifyOpenIntent(
      scope,
      m.preAccounts[m.onchainIntent]!,
      sell,
      [2],
    ),
    afterIntent = verifyOpenIntent(scope, post[m.onchainIntent]!, sell, [
      create ? 2 : sell ? 4 : 3,
    ]);
  const expectedIntent = Buffer.from(beforeIntent);
  if (create) {
    demand(
      m.preAccounts[m.plan] === null &&
        accountBytes(
          post[m.plan],
          policy.programId,
          901,
          "SettlementPlan",
        ).equals(expectedPlan(policy, m)),
      "EXACT_CREATED_PLAN",
    );
    verifyOpenPlan(scope, m.plan, post[m.plan]!, "0");
  } else {
    const p = verifyOpenPlan(
      scope,
      m.plan,
      m.preAccounts[m.plan]!,
      m.chainRevision,
    );
    demand(
      p.bitmap === 7 &&
        p.activeAuthorization.every((v) => v === 0) &&
        p.bytes.subarray(828, 860).every((v) => v === 0) &&
        p.bytes.subarray(724, 756).toString("hex") === m.settlementId,
      "COMPLETED_PLAN",
    );
    expectedIntent[113] = sell ? 4 : 3;
    Buffer.from(m.settlementId, "hex").copy(expectedIntent, sell ? 170 : 224);
    if (sell)
      expectedIntent.writeBigUInt64LE(
        p.outputs.reduce((v, n) => v + n, 0n),
        154,
      );
    else {
      p.outputs.forEach((v, i) =>
        expectedIntent.writeBigUInt64LE(v, 162 + i * 8),
      );
      p.budgets.forEach((v, i) =>
        expectedIntent.writeBigUInt64LE(v, 200 + i * 8),
      );
    }
  }
  demand(afterIntent.equals(expectedIntent), "EXACT_INTENT_TRANSITION");
  for (const n of names.filter(
    (n) =>
      ![
        CLOCK,
        m.onchainIntent,
        ...a.vaultTokens,
        ...(create ? [m.plan] : []),
      ].includes(n),
  ))
    demand(
      canonicalize(m.preAccounts[n]) === canonicalize(post[n]),
      "UNRELATED_STATE_CHANGE",
    );
  a.vaultTokens.forEach((n, i) => {
    const mint = [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][
      i
    ]!;
    const prepared = verifyOpenToken(m.preAccounts[n]!, a.authority, mint);
    const current = verifyOpenToken(post[n]!, a.authority, mint);
    const beforeBytes = accountBytes(m.preAccounts[n], c.tokenProgram, 165);
    const afterBytes = accountBytes(post[n], c.tokenProgram, 165);
    // External donations may advance balances, never custody metadata. Do not
    // treat donated units as plan outputs or inputs: those remain plan/receipt-bound.
    const normalized = (raw: OpenAccount, bytes: Buffer) => {
      const b = Buffer.from(bytes);
      b.fill(0, 64, 72);
      return { ...raw, lamports: 0, data: [b.toString("base64"), "base64"] };
    };
    demand(
      current >= prepared &&
        canonicalize(normalized(m.preAccounts[n]!, beforeBytes)) ===
          canonicalize(normalized(post[n]!, afterBytes)),
      "CUSTODY_MUTATION",
    );
    const beforeLamports = m.preAccounts[n]!.lamports,
      afterLamports = post[n]!.lamports;
    demand(
      (beforeLamports === undefined && afterLamports === undefined) ||
        (Number.isSafeInteger(beforeLamports) &&
          beforeLamports! >= 0 &&
          Number.isSafeInteger(afterLamports) &&
          afterLamports! >= beforeLamports!),
      "CUSTODY_LAMPORTS",
    );
  });
  demand(
    post[m.onchainIntent]!.lamports ===
      m.preAccounts[m.onchainIntent]!.lamports,
    "INTENT_LAMPORTS",
  );
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58()),
    pre = meta.preBalances,
    balances = meta.postBalances;
  demand(
    Array.isArray(pre) &&
      Array.isArray(balances) &&
      pre.length === keys.length &&
      balances.length === keys.length &&
      [...pre, ...balances, meta.fee].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ),
    "BALANCE_EVIDENCE",
  );
  demand(
    Array.isArray(meta.innerInstructions) &&
      Array.isArray(meta.preTokenBalances) &&
      Array.isArray(meta.postTokenBalances),
    "META_COMPLETE",
  );
  const planIndex = keys.indexOf(m.plan),
    keeperIndex = keys.indexOf(policy.keeper),
    rentDelta = create ? Math.max(0, m.planRent - pre[planIndex]!) : 0;
  keys.forEach((k, i) =>
    demand(
      balances[i]! - pre[i]! ===
        (i === keeperIndex
          ? -meta.fee - rentDelta
          : create && i === planIndex
            ? rentDelta
            : 0),
      "LAMPORT_EFFECTS",
    ),
  );
  if (create) {
    demand(
      Number.isSafeInteger(m.planRent) &&
        m.planRent > 0 &&
        post[m.plan]!.lamports === balances[planIndex] &&
        meta.preTokenBalances.length === 0 &&
        meta.postTokenBalances.length === 0,
      "PLAN_RENT_OR_TOKEN_EFFECTS",
    );
    const system = (op: number, value?: bigint, program?: string) => {
      const b = Buffer.alloc(
        4 + (value === undefined ? 0 : 8) + (program ? 32 : 0),
      );
      b.writeUInt32LE(op);
      if (value !== undefined) b.writeBigUInt64LE(value, 4);
      if (program) Buffer.from(publicKeyBytes(program)).copy(b, b.length - 32);
      return b;
    };
    const inner = (bytes: Buffer, accounts: number[]) => ({
      programIdIndex: keys.indexOf(c.systemProgram),
      accounts,
      data: encodeBase58(bytes),
    });
    const cpi =
      pre[planIndex] === 0
        ? [
            inner(
              Buffer.concat([
                system(0, BigInt(m.planRent)),
                (() => {
                  const b = Buffer.alloc(8);
                  b.writeBigUInt64LE(901n);
                  return b;
                })(),
                Buffer.from(publicKeyBytes(policy.programId)),
              ]),
              [keeperIndex, planIndex],
            ),
          ]
        : [
            ...(rentDelta > 0
              ? [inner(system(2, BigInt(rentDelta)), [keeperIndex, planIndex])]
              : []),
            inner(system(8, 901n), [planIndex]),
            inner(system(1, undefined, policy.programId), [planIndex]),
          ];
    const actual = meta.innerInstructions.map((g) => ({
      index: g.index,
      instructions: g.instructions.map((i) => ({
        programIdIndex: i.programIdIndex,
        accounts: i.accounts,
        data: i.data,
      })),
    }));
    demand(
      canonicalize(actual) === canonicalize([{ index: 0, instructions: cpi }]),
      "EXACT_SYSTEM_CPI",
    );
  } else {
    demand(
      meta.innerInstructions.length === 0 &&
        meta.preTokenBalances.length === 4 &&
        canonicalize(meta.preTokenBalances) ===
          canonicalize(meta.postTokenBalances),
      "RECORD_TOKEN_OR_CPI_EFFECTS",
    );
    for (let i = 0; i < 4; i++) {
      const entry = meta.preTokenBalances.find(
        (v) => v.accountIndex === keys.indexOf(a.vaultTokens[i]!),
      );
      demand(
        entry &&
          entry.owner === a.authority &&
          entry.mint ===
            [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i] &&
          entry.programId === c.tokenProgram &&
          entry.uiTokenAmount?.decimals === [6, 8, 8, 9][i] &&
          typeof entry.uiTokenAmount.amount === "string" &&
          /^(0|[1-9][0-9]{0,19})$/.test(entry.uiTokenAmount.amount) &&
          BigInt(entry.uiTokenAmount.amount) < 1n << 64n &&
          BigInt(entry.uiTokenAmount.amount) >=
            verifyOpenToken(
              m.preAccounts[a.vaultTokens[i]!]!,
              a.authority,
              entry.mint,
            ) &&
          verifyOpenToken(post[a.vaultTokens[i]!]!, a.authority, entry.mint) >=
            BigInt(entry.uiTokenAmount.amount),
        "TOKEN_EVIDENCE",
      );
    }
  }
  return {
    signature,
    slot: raw.slot as number,
    evidenceHash: digest(canonicalize({ manifest: m, evidence })).toString(
      "hex",
    ),
  };
}

async function atomic<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Private construction prevents a caller-selected production trust scope. */
class KeeperJournal {
  private readonly pool: Pool;
  private readonly policy: SettlementServerPolicy;
  private readonly rpc: OwnerReadonlyRpc;
  private readonly compiler: JupiterLegCompiler;
  private readonly genesis: string;
  private readonly intake: KeeperEvidenceIntake;
  private readonly production: boolean;
  constructor(
    pool: Pool,
    policy: SettlementServerPolicy,
    rpc: OwnerReadonlyRpc,
    compiler: JupiterLegCompiler,
    genesis: string,
    intake: KeeperEvidenceIntake,
    production: boolean,
  ) {
    demand(production === (genesis === c.genesisHash), "CLUSTER_SCOPE");
    if (production) {
      const approved = requireOpenProductionPolicy();
      for (const field of Object.keys(
        policy,
      ) as (keyof SettlementServerPolicy)[])
        demand(
          canonicalize(policy[field]) === canonicalize(approved[field]),
          "SOURCE_POLICY",
        );
    }
    this.pool = pool;
    this.policy = Object.freeze({ ...policy });
    this.rpc = rpc;
    this.compiler = compiler;
    this.genesis = genesis;
    this.intake = intake;
    this.production = production;
  }
  private async guard(intentId: string) {
    if (this.production)
      await assertProductionEnrollment(
        this.pool,
        requireOpenProductionPolicy(),
        intentId,
        "intent",
      );
  }
  async prepare(intentId: string, action: KeeperAction, planSeconds = 120) {
    await this.guard(intentId);
    if (this.production) await verifyProductionVaultArtifact(this.rpc);
    demand(
      (await this.rpc.read("getGenesisHash", [])) === this.genesis,
      "CLUSTER",
    );
    const compiled = await compileKeeperFromDurableState(
        this.pool,
        this.policy,
        intentId,
        action,
        this.rpc,
        this.compiler,
        planSeconds,
      ),
      rent = Number(
        await this.rpc.read("getMinimumBalanceForRentExemption", [
          901,
          { commitment: "finalized" },
        ]),
      );
    demand(Number.isSafeInteger(rent) && rent > 0, "RENT");
    const manifest: KeeperManifest = {
        ...compiled.manifest,
        genesis: this.genesis,
        planRent: rent,
        snapshotAccounts: Object.keys(compiled.manifest.preAccounts),
      },
      requestId = randomUUID();
    await atomic(this.pool, async (client) => {
      const row = (
        await client.query(
          "SELECT *,clock_timestamp() AS db_now FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
          [intentId],
        )
      ).rows[0];
      demand(
        row &&
          row.wallet === this.policy.wallet &&
          row.vault === this.policy.vault &&
          row.share_mint === this.policy.shareMint &&
          row.configuration_hash === this.policy.configurationHash &&
          row.db_revision === manifest.dbRevision &&
          row.chain_revision === manifest.chainRevision &&
          row.state === stateFor(action),
        "CAS",
      );
      demand(
        !action.startsWith("create") ||
          (BigInt(manifest.expiry) * 1000n > BigInt(row.db_now.getTime()) &&
            BigInt(manifest.created) * 1000n <= BigInt(row.db_now.getTime())),
        "PLAN_EXPIRED",
      );
      const pending = await client.query(
        `SELECT 1 FROM c3_open.legs WHERE intent_id=$1 AND state NOT IN ('pending','confirmed')
        UNION ALL SELECT 1 FROM c3_open.signing_requests s JOIN c3_open.quote_authorizations q USING(quote_id) WHERE q.intent_id=$1 AND s.state<>'result'
        UNION ALL SELECT 1 FROM c3_open.owner_requests r LEFT JOIN c3_open.owner_effect_receipts e USING(request_id) LEFT JOIN c3_open.owner_request_outcomes o USING(request_id) WHERE r.intent_id=$1 AND e.request_id IS NULL AND o.request_id IS NULL
        UNION ALL SELECT 1 FROM c3_open.renewal_requests r LEFT JOIN c3_open.plan_generations g USING(request_id) LEFT JOIN c3_open.renewal_outcomes o USING(request_id) WHERE r.intent_id=$1 AND g.request_id IS NULL AND o.request_id IS NULL LIMIT 1`,
        [intentId],
      );
      demand(!pending.rowCount, "RECONCILE_PENDING");
      await client.query(
        "INSERT INTO c3_open.keeper_packets(request_id,intent_id,action,scope,genesis,expected_db_revision,expected_chain_revision,packet,message_hash,manifest,manifest_hash,policy_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          requestId,
          intentId,
          action,
          this.production ? "MAINNET_REVIEWED" : "ISOLATED_VERIFIED",
          this.genesis,
          manifest.dbRevision,
          manifest.chainRevision,
          Buffer.from(compiled.packet),
          Buffer.from(manifest.messageHash, "hex"),
          manifest,
          digest(canonicalize(manifest)),
          digest(canonicalize(this.policy)),
        ],
      );
    });
    return { requestId, packet: compiled.packet, manifest };
  }
  private async read(requestId: string) {
    if (this.production) requireOpenProductionPolicy();
    const r = (
      await this.pool.query(
        "SELECT p.*,s.signature,s.packet AS signed_packet,e.evidence_hash,o.outcome,o.evidence_hash AS closed_hash FROM c3_open.keeper_packets p LEFT JOIN c3_open.keeper_signatures s USING(request_id) LEFT JOIN c3_open.keeper_effect_receipts e USING(request_id) LEFT JOIN c3_open.keeper_request_outcomes o USING(request_id) WHERE p.request_id=$1",
        [requestId],
      )
    ).rows[0];
    demand(
      r &&
        r.scope ===
          (this.production ? "MAINNET_REVIEWED" : "ISOLATED_VERIFIED") &&
        r.genesis === this.genesis &&
        r.policy_hash.equals(digest(canonicalize(this.policy))) &&
        r.manifest_hash.equals(digest(canonicalize(r.manifest))) &&
        r.message_hash.toString("hex") === r.manifest.messageHash &&
        r.manifest.intentId === r.intent_id &&
        r.manifest.action === r.action,
      "IMMUTABLE_PACKET",
    );
    await this.guard(r.intent_id);
    return r;
  }
  async recover(requestId: string) {
    const r = await this.read(requestId);
    const attempted = (
      await this.pool.query(
        "SELECT 1 FROM c3_open.keeper_send_attempts WHERE request_id=$1",
        [requestId],
      )
    ).rowCount;
    const now = (await this.pool.query("SELECT clock_timestamp() AS now"))
      .rows[0].now as Date;
    return {
      requestId,
      action: r.action as KeeperAction,
      packet: new Uint8Array(r.packet),
      signedPacket: r.signed_packet ? new Uint8Array(r.signed_packet) : null,
      signature: r.signature ?? null,
      sendAttempted: !!attempted,
      evidenceHash: r.evidence_hash?.toString("hex") ?? null,
      closedOutcome: r.outcome ?? null,
      closedEvidenceHash: r.closed_hash?.toString("hex") ?? null,
      disposition: r.closed_hash
        ? {
            state: "CLOSED_UNEXECUTED" as const,
            barrierReleased: true,
            automaticallyResend: false,
            replacementAllowed: false,
            closedUnexecuted: true,
          }
        : keeperRecoveryDisposition(
            r.manifest,
            r.signature ?? null,
            !!attempted,
            !!r.evidence_hash,
            now.getTime(),
          ),
    };
  }
  async recordSignedPacket(requestId: string, packet: Uint8Array) {
    const r = await this.read(requestId),
      signature = verifyKeeperSignedPacket(
        packet,
        r.packet,
        this.policy.keeper,
      );
    demand(!r.closed_hash, "CLOSED_UNEXECUTED");
    await atomic(this.pool, async (client) => {
      const row = (
        await client.query(
          "SELECT *,clock_timestamp() AS db_now FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
          [r.intent_id],
        )
      ).rows[0];
      if (r.signature) {
        demand(
          r.signature === signature &&
            r.signed_packet.equals(Buffer.from(packet)),
          "SIGNATURE_REPLACEMENT",
        );
        return;
      }
      demand(
        !(
          await client.query(
            "SELECT 1 FROM c3_open.keeper_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount,
        "CLOSED_UNEXECUTED",
      );
      demand(
        row.db_revision === r.expected_db_revision &&
          row.chain_revision === r.expected_chain_revision &&
          row.state === stateFor(r.action),
        "CAS",
      );
      demand(
        !r.action.startsWith("create") ||
          BigInt(r.manifest.expiry) * 1000n > BigInt(row.db_now.getTime()),
        "PLAN_EXPIRED",
      );
      await client.query(
        "INSERT INTO c3_open.keeper_signatures(request_id,signature,packet) VALUES($1,$2,$3)",
        [requestId, signature, Buffer.from(packet)],
      );
    });
    return signature;
  }
  /** Commit BEFORE a local/production sender is invoked. Lost acknowledgement
   * makes this false on restart: observation only, never automatic resend. */
  async claimSendAttempt(requestId: string) {
    const r = await this.read(requestId);
    if (r.closed_hash) return false;
    if (
      r.evidence_hash ||
      (
        await this.pool.query(
          "SELECT 1 FROM c3_open.keeper_send_attempts WHERE request_id=$1",
          [requestId],
        )
      ).rowCount
    )
      return false;
    demand(r.signature && !r.evidence_hash, "SIGNATURE_REQUIRED");
    if (this.production) await verifyProductionVaultArtifact(this.rpc);
    return atomic(this.pool, async (client) => {
      const row = (
        await client.query(
          "SELECT *,clock_timestamp() AS db_now FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
          [r.intent_id],
        )
      ).rows[0];
      demand(
        row.db_revision === r.expected_db_revision &&
          row.chain_revision === r.expected_chain_revision &&
          row.state === stateFor(r.action),
        "CAS",
      );
      demand(
        !(
          await client.query(
            "SELECT 1 FROM c3_open.keeper_request_outcomes WHERE request_id=$1",
            [requestId],
          )
        ).rowCount,
        "CLOSED_UNEXECUTED",
      );
      demand(
        !r.action.startsWith("create") ||
          BigInt(r.manifest.expiry) * 1000n > BigInt(row.db_now.getTime()),
        "PLAN_EXPIRED",
      );
      return !!(
        await client.query(
          "INSERT INTO c3_open.keeper_send_attempts(request_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING request_id",
          [requestId],
        )
      ).rowCount;
    });
  }
  async reconcile(requestId: string) {
    const r = await this.read(requestId);
    demand(!r.closed_hash, "CLOSED_UNEXECUTED");
    if (r.evidence_hash)
      return {
        status: "already_reconciled" as const,
        evidenceHash: r.evidence_hash.toString("hex"),
      };
    demand(r.signature && r.signed_packet, "SIGNATURE_REQUIRED");
    if (this.production) await verifyProductionVaultArtifact(this.rpc);
    const evidence = await this.intake.collect(
        r.signature,
        r.manifest.snapshotAccounts,
        r.manifest.slot,
      ),
      proof = verifyKeeperEffects(
        this.policy,
        r.manifest,
        r.packet,
        r.signed_packet,
        evidence,
      );
    await atomic(this.pool, async (client) => {
      const row = (
        await client.query(
          "SELECT * FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
          [r.intent_id],
        )
      ).rows[0];
      const prior = (
        await client.query(
          "SELECT evidence_hash FROM c3_open.keeper_effect_receipts WHERE request_id=$1",
          [requestId],
        )
      ).rows[0];
      if (prior) return;
      demand(
        row.db_revision === r.expected_db_revision &&
          row.chain_revision === r.expected_chain_revision &&
          row.state === stateFor(r.action),
        "CAS",
      );
      if (!r.action.startsWith("create")) {
        const start = r.action === "record_sell" ? 3 : 0,
          p = verifyOpenPlan(
            scopeOf(this.policy),
            r.manifest.plan,
            r.manifest.preAccounts[r.manifest.plan],
            r.manifest.chainRevision,
          );
        const legs = (
          await client.query(
            "SELECT ordinal,state,observed_effects FROM c3_open.legs WHERE intent_id=$1 AND ordinal BETWEEN $2 AND $3 ORDER BY ordinal FOR UPDATE",
            [r.intent_id, start, start + 2],
          )
        ).rows;
        demand(
          legs.length === 3 &&
            legs.every(
              (l, i) =>
                l.state === "confirmed" &&
                BigInt(l.observed_effects.inputAmount) === p.budgets[i] &&
                BigInt(l.observed_effects.outputAmount) === p.outputs[i],
            ),
          "DURABLE_EFFECTS",
        );
      }
      await client.query(
        "INSERT INTO c3_open.keeper_effect_receipts(request_id,signature,finalized_slot,evidence_hash) VALUES($1,$2,$3,$4)",
        [
          requestId,
          proof.signature,
          proof.slot,
          Buffer.from(proof.evidenceHash, "hex"),
        ],
      );
      const next = r.action === "record_sell" ? "claimable" : row.state;
      await client.query(
        "UPDATE c3_open.intents SET state=$2,db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
        [r.intent_id, next],
      );
      const event = randomUUID();
      await client.query(
        "INSERT INTO c3_open.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          event,
          r.intent_id,
          digest("keeper-effect:" + requestId).toString("hex"),
          (BigInt(row.db_revision) + 1n).toString(),
          next,
          proof.evidenceHash,
        ],
      );
      await client.query("INSERT INTO c3_open.outbox(event_id) VALUES($1)", [
        event,
      ]);
    });
    return { status: "reconciled" as const, ...proof };
  }
  /** Explicit read-only expiry reconciliation. No quote, signing or send is
   * invoked; inventory/progress remain unchanged and signatures stay durable. */
  async closeExpired(requestId: string) {
    const r = await this.read(requestId);
    demand(!r.evidence_hash, "ALREADY_EXECUTED");
    if (r.closed_hash)
      return {
        status: "already_closed" as const,
        evidenceHash: r.closed_hash.toString("hex"),
      };
    if (r.signature)
      demand(
        verifyKeeperSignedPacket(
          r.signed_packet,
          r.packet,
          this.policy.keeper,
        ) === r.signature,
        "SIGNATURE_REQUIRED",
      );
    if (this.production) await verifyProductionVaultArtifact(this.rpc);
    const expiryRpc = {
      read: async (method: string, params: unknown[]) => {
        if (this.production) {
          demand(this.intake.readExpiryPair, "EXPIRY_QUORUM_REQUIRED");
          return this.intake.readExpiryPair!(method, params);
        }
        return {
          primary: await this.rpc.read(method, params),
          secondary: await this.rpc.read(method, params),
        };
      },
    };
    const proof = await proveKeeperNonExecution(
      expiryRpc,
      r.manifest,
      r.signature ?? null,
      r.signed_packet ?? null,
    );
    await atomic(this.pool, async (client) => {
      const row = (
        await client.query(
          "SELECT * FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
          [r.intent_id],
        )
      ).rows[0];
      const terminal = await client.query(
        "SELECT request_id FROM c3_open.keeper_request_outcomes WHERE request_id=$1 UNION ALL SELECT request_id FROM c3_open.keeper_effect_receipts WHERE request_id=$1",
        [requestId],
      );
      if (terminal.rowCount) throw Error("C3_KEEPER_TERMINAL_CONFLICT");
      const signed = (
        await client.query(
          "SELECT signature,packet FROM c3_open.keeper_signatures WHERE request_id=$1",
          [requestId],
        )
      ).rows[0];
      demand(
        (signed?.signature ?? null) === (r.signature ?? null) &&
          (!signed || signed.packet.equals(r.signed_packet)),
        "SIGNATURE_RACE",
      );
      demand(
        row.db_revision === r.expected_db_revision &&
          row.chain_revision === r.expected_chain_revision &&
          row.state === stateFor(r.action),
        "CAS",
      );
      await client.query(
        "INSERT INTO c3_open.keeper_request_outcomes(request_id,outcome,signature,finalized_slot,evidence_hash) VALUES($1,$2,$3,$4,$5)",
        [
          requestId,
          proof.outcome,
          r.signature ?? null,
          proof.finalizedSlot,
          Buffer.from(proof.evidenceHash, "hex"),
        ],
      );
      await client.query(
        "UPDATE c3_open.intents SET db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
        [r.intent_id],
      );
      const event = randomUUID();
      await client.query(
        "INSERT INTO c3_open.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [
          event,
          r.intent_id,
          digest("keeper-closed:" + requestId).toString("hex"),
          (BigInt(row.db_revision) + 1n).toString(),
          row.state,
          proof.evidenceHash,
        ],
      );
      await client.query("INSERT INTO c3_open.outbox(event_id) VALUES($1)", [
        event,
      ]);
    });
    return { status: "closed_unexecuted" as const, ...proof };
  }
}

export function isolatedKeeperJournal(
  pool: Pool,
  policy: SettlementServerPolicy,
  rpc: OwnerReadonlyRpc,
  compiler: JupiterLegCompiler,
  genesis: string,
  intake: KeeperEvidenceIntake,
) {
  demand(genesis !== c.genesisHash, "ISOLATED_MAINNET_FORBIDDEN");
  publicKeyBytes(genesis);
  return new KeeperJournal(pool, policy, rpc, compiler, genesis, intake, false);
}
export function productionKeeperJournal(
  pool: Pool,
  fetcher: typeof fetch = fetch,
) {
  // Source gate BEFORE enrollment, connections, reads or any caller transport.
  const approved = requireOpenProductionPolicy();
  const {
    programId,
    idlHash,
    configurationHash,
    vault,
    shareMint,
    wallet,
    governance,
    keeper,
    quoteAuthority,
    registry,
    registryRevision,
    registryHash,
    quotePolicy,
    quotePolicyRevision,
    maxSlippageBps,
  } = approved;
  const policy: SettlementServerPolicy = {
    programId,
    idlHash,
    configurationHash,
    vault,
    shareMint,
    wallet,
    governance,
    keeper,
    quoteAuthority,
    registry,
    registryRevision,
    registryHash,
    quotePolicy,
    quotePolicyRevision,
    maxSlippageBps,
  };
  const intake: KeeperEvidenceIntake = {
    readExpiryPair: (method, params) =>
      readIndependentOpenEvidence(approved.providers, method, params, fetcher),
    collect: async (signature, accounts, minimumSlot) => {
      const collected = await collectFinalizedOpenEconomicEvidence(
        approved.providers,
        signature,
        accounts,
        minimumSlot,
        fetcher,
      );
      const genesis = (await readIndependentOpenEvidence(
        approved.providers,
        "getGenesisHash",
        [],
        fetcher,
      )) as Pair<string>;
      const wire = (await readIndependentOpenEvidence(
        approved.providers,
        "getTransaction",
        [
          signature,
          {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
            encoding: "base64",
          },
        ],
        fetcher,
      )) as Pair;
      return {
        genesis,
        wire,
        statuses: collected.statuses,
        transaction: collected.transaction,
        snapshots: collected.snapshots,
      };
    },
  };
  return new KeeperJournal(
    pool,
    policy,
    productionOwnerRpc(fetcher),
    new JupiterLegCompiler(productionQuorumConnection(fetcher)),
    c.genesisHash,
    intake,
    true,
  );
}
