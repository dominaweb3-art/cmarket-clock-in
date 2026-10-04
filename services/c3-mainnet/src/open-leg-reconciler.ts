/** Finalized read-only leg intake. Shared by quorum production and isolated adapters. Never signs or submits. */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  Connection,
  AddressLookupTableAccount,
  PublicKey,
} from "@solana/web3.js";
import type { Pool } from "pg";
import { C3_MAINNET } from "./constants.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { assertProductionEnrollment } from "./open-owner-trust.ts";
import { productionQuorumConnection } from "./open-quorum-connection.ts";
import { quoteContextHash } from "./quote-seal.ts";
import {
  openQuoteContext,
  type StoredQuoteContext,
} from "./open-quote-context.ts";
import {
  verifyFinalizedEffects,
  verifyFinalizedPlan,
  verifyFinalizedAltBinding,
} from "./open-leg-effects.ts";
const h = (b: Uint8Array) => createHash("sha256").update(b).digest();
const check = (x: unknown, s: string): void => {
  if (!x) throw Error("C3_RECONCILE_" + s);
};
const publicKey = (raw: Uint8Array) =>
  createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
    format: "der",
    type: "spki",
  });
export async function reconcileVerifiedOpenLeg(
  pool: Pool,
  rpc: Connection,
  intentId: string,
  ordinal: number,
  expectedScope: "MAINNET_REVIEWED" | "ISOLATED_VERIFIED" | "LOCAL_CLONE",
  expectedGenesis: string,
) {
  if (
    expectedGenesis === C3_MAINNET.genesisHash ||
    expectedScope === "MAINNET_REVIEWED"
  ) {
    check(
      expectedGenesis === C3_MAINNET.genesisHash &&
        expectedScope === "MAINNET_REVIEWED",
      "PRODUCTION_SCOPE",
    );
    const policy = requireOpenProductionPolicy();
    await assertProductionEnrollment(pool, policy, intentId, "intent");
    rpc = productionQuorumConnection();
  }
  const row = (
    await pool.query(
      `SELECT q.quote_id,q.canonical_payload,q.payload_hash,q.signature,q.authority,q.evidence,ctx.context,ctx.context_hash,ctx.scope,l.submitted_signature,l.authorization_hash,i.wallet,i.vault,i.db_revision,i.chain_revision
    FROM c3_open.quote_authorizations q JOIN c3_open.all_quote_contexts ctx USING(intent_id,ordinal,intent_revision)
    JOIN c3_open.legs l USING(intent_id,ordinal) JOIN c3_open.intents i USING(intent_id)
    WHERE q.intent_id=$1 AND q.ordinal=$2 AND encode(q.payload_hash,'hex')=l.authorization_hash
      AND q.state IN ('signed','consumed') AND l.state IN ('submitted','uncertain','reconciliation_required')`,
      [intentId, ordinal],
    )
  ).rows[0];
  check(
    row &&
      row.signature &&
      row.submitted_signature &&
      row.evidence.executionMessageHash &&
      row.evidence.effectManifest,
    "DURABLE_EVIDENCE_MISSING",
  );
  const context = row.context as StoredQuoteContext,
    seal = row.canonical_payload as Buffer;
  check(
    row.scope === expectedScope &&
      seal.length === 300 &&
      h(seal).equals(row.payload_hash) &&
      row.authorization_hash === row.payload_hash.toString("hex") &&
      quoteContextHash(openQuoteContext(context)).equals(row.context_hash) &&
      seal.subarray(17, 49).equals(row.context_hash) &&
      context.wallet === row.wallet &&
      context.vault === row.vault &&
      Buffer.from(context.authority, "hex").equals(row.authority) &&
      verify(null, seal, publicKey(row.authority), row.signature),
    "PERSISTED_AUTHORIZATION",
  );
  const genesis = await rpc.getGenesisHash();
  check(
    genesis === expectedGenesis &&
      new PublicKey(genesis).toBuffer().toString("hex") === context.genesisHash,
    "GENESIS",
  );
  const status = (
    await rpc.getSignatureStatuses([row.submitted_signature], {
      searchTransactionHistory: true,
    })
  ).value[0];
  check(
    status?.confirmationStatus === "finalized" && status.err === null,
    "NOT_FINALIZED",
  );
  const tx = await rpc.getTransaction(row.submitted_signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  check(
    tx && tx.slot === status!.slot && tx.transaction.message.version === 0,
    "TRANSACTION_MISSING",
  );
  const tables = tx!.transaction.message.addressTableLookups;
  const accounts = await rpc.getMultipleAccountsInfo(
    tables.map((t) => t.accountKey),
    "finalized",
  );
  const resolved = tables.map((t, i) => {
    check(accounts[i], "ALT_MISSING");
    return new AddressLookupTableAccount({
      key: t.accountKey,
      state: AddressLookupTableAccount.deserialize(accounts[i]!.data),
    });
  });
  const actualKeys = tx!.transaction.message.getAccountKeys({
    addressLookupTableAccounts: resolved,
  });
  const claimedKeys = tx!.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx!.meta?.loadedAddresses ?? null,
  });
  check(
    actualKeys.length === claimedKeys.length &&
      Array.from({ length: actualKeys.length }, (_, i) =>
        actualKeys.get(i)!.equals(claimedKeys.get(i)!),
      ).every(Boolean),
    "ALT_RPC_RESOLUTION_MISMATCH",
  );
  // The authorization binds ALL ordered ALT accounts supplied to the CPI,
  // including a table the compiler did not need for a lookup. Hashing only
  // message.addressTableLookups would incorrectly omit that approved context.
  const outer = tx!.transaction.message.compiledInstructions[1];
  check(outer && outer.data.length >= 16, "OUTER_ABI");
  const rawSize = Buffer.from(outer!.data).readUInt32LE(8);
  check(rawSize <= 1024 && 16 + rawSize <= outer!.data.length, "OUTER_ABI");
  const flagsSize = Buffer.from(outer!.data).readUInt32LE(12 + rawSize);
  check(
    outer!.data.length === 16 + rawSize + flagsSize &&
      outer!.accountKeyIndexes.length === 12 + flagsSize + seal[235]!,
    "OUTER_ABI",
  );
  const names = Array.from(
    outer!.accountKeyIndexes.slice(12 + flagsSize),
    (index) => {
      const k = actualKeys.get(index);
      check(k, "ACCOUNT_INDEX");
      return k!;
    },
  );
  check(
    new Set(names.map((k) => k.toBase58())).size === names.length &&
      tables.every((t) => names.some((k) => k.equals(t.accountKey))),
    "ALT_TABLE_SUBSTITUTION",
  );
  const allAccounts = await rpc.getMultipleAccountsInfo(names, {
    commitment: "finalized",
    minContextSlot: tx!.slot,
  });
  check(allAccounts.length === names.length, "ALT_MISSING");
  verifyFinalizedAltBinding(
    allAccounts.map((a, i) => {
      check(a && !a.executable, "ALT_MISSING");
      return {
        address: names[i]!.toBase58(),
        owner: a!.owner.toBase58(),
        data: a!.data,
      };
    }),
    BigInt(tx!.slot),
    seal,
  );
  const effects = verifyFinalizedEffects(tx!, {
    signature: row.submitted_signature,
    messageHash: row.evidence.executionMessageHash,
    context,
    seal,
    ...row.evidence.effectManifest,
  });
  const plan = await rpc.getAccountInfoAndContext(new PublicKey(context.plan), {
    commitment: "finalized",
    minContextSlot: tx!.slot,
  });
  check(plan.context.slot >= tx!.slot, "PLAN_STALE");
  const chainRevision = verifyFinalizedPlan(
    plan.value,
    context,
    effects.debit,
    effects.credit,
    seal,
  );
  check(
    BigInt(row.chain_revision) + 1n === chainRevision,
    "DURABLE_PLAN_REVISION",
  );
  const planStateHash = h(plan.value!.data).toString("hex"),
    authorizationHash = row.payload_hash.toString("hex") as string,
    quoteId = row.quote_id.toString("hex") as string;
  const evidenceHash = h(
    Buffer.from(
      JSON.stringify({
        effectsHash: effects.evidenceHash,
        planStateHash,
        authorizationHash,
        quoteId,
        contextHash: row.context_hash.toString("hex"),
        chainRevision: chainRevision.toString(),
        altContentsHash: seal.subarray(236, 268).toString("hex"),
      }),
    ),
  ).toString("hex");
  return Object.freeze({
    ...effects,
    evidenceHash,
    planStateHash,
    // Public program account image, NOT an unsigned transaction or key. Keep
    // immutable verified history readable after later owner renewals.
    planStateBase64: plan.value!.data.toString("base64"),
    signature: row.submitted_signature as string,
    plan: context.plan,
    chainRevision,
    dbRevision: BigInt(row.db_revision),
    authorizationHash,
    quoteId,
  });
}
