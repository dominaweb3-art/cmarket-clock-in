/** Independent read-only verifier. Local-validator evidence only; never promotes
 * PostgreSQL state, retries, signs or submits. Missing evidence is NOT success.
 * A production two-operator quorum and lifecycle promotion remain disabled.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  Connection,
  AddressLookupTableAccount,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import type { Pool } from "pg";
import { C3_MAINNET as c } from "../src/constants.ts";
import { decodeBase58 } from "../src/solana.ts";
import { quoteContextHash } from "../src/quote-seal.ts";
import { quoteAltContentsHash } from "../src/quote-alt.ts";
import { openQuoteContext, type StoredQuoteContext } from "./open-quote.ts";
import {
  VAULT_AUTHORITY,
  VAULT_PROGRAM,
} from "./jupiter-vault-cpi-inspection.ts";
const h = (b: Uint8Array) => createHash("sha256").update(b).digest();
const check = (x: unknown, s: string): void => {
  if (!x) throw new Error(`C3_RECONCILE_${s}`);
};
const publicKey = (raw: Uint8Array) =>
  createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
    format: "der",
    type: "spki",
  });
const WHIRL = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const EVENT_AUTHORITY = "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf";
export function verifyJupiterSwapEvent(
  data: Buffer,
  accounts: readonly string[],
  e: Pick<ExecutionExpectation, "pool" | "context">,
  debit: bigint,
  credit: bigint,
): void {
  check(
    accounts.length === 1 &&
      accounts[0] === EVENT_AUTHORITY &&
      data.subarray(0, 8).equals(Buffer.from("e445a52e51cb9a1d", "hex")),
    "UNKNOWN_JUPITER_EVENT",
  );
  // Published Jupiter IDL: legacy SwapEvent, or current SwapsEvent with ONE
  // SwapEventV2. More events would imply an unapproved multi-hop route.
  if (
    data.length === 128 &&
    data
      .subarray(8, 16)
      .equals(Buffer.from([64, 198, 205, 232, 38, 8, 113, 226]))
  ) {
    check(
      new PublicKey(data.subarray(16, 48)).toBase58() === WHIRL &&
        new PublicKey(data.subarray(48, 80)).toBase58() ===
          e.context.inputMint &&
        data.readBigUInt64LE(80) === debit &&
        new PublicKey(data.subarray(88, 120)).toBase58() ===
          e.context.outputMint &&
        data.readBigUInt64LE(120) === credit,
      "JUPITER_EVENT_EFFECTS",
    );
  } else if (
    data.length === 132 &&
    data
      .subarray(8, 16)
      .equals(Buffer.from([152, 47, 78, 235, 192, 96, 110, 106])) &&
    data.readUInt32LE(16) === 1
  ) {
    check(
      new PublicKey(data.subarray(20, 52)).toBase58() === e.context.inputMint &&
        data.readBigUInt64LE(52) === debit &&
        new PublicKey(data.subarray(60, 92)).toBase58() ===
          e.context.outputMint &&
        data.readBigUInt64LE(92) === credit &&
        new PublicKey(data.subarray(100, 132)).toBase58() === WHIRL,
      "JUPITER_EVENT_EFFECTS",
    );
  } else throw new Error("C3_RECONCILE_UNKNOWN_JUPITER_EVENT");
}
export type ExecutionExpectation = Readonly<{
  signature: string;
  messageHash: string;
  context: StoredQuoteContext;
  seal: Buffer;
  pool: string;
  poolInput: string;
  poolOutput: string;
}>;
export function verifyFinalizedEffects(
  tx: VersionedTransactionResponse,
  e: ExecutionExpectation,
): Readonly<{
  debit: string;
  credit: string;
  evidenceHash: string;
  scope: "LOCAL_CHAIN_ONLY";
}> {
  const m = tx.transaction.message;
  check(e.seal.length === 300, "SEAL_LENGTH");
  check(
    m.version === 0 && tx.meta && tx.meta.err === null,
    "FINALIZED_EVIDENCE",
  );
  check(h(m.serialize()).toString("hex") === e.messageHash, "OUTER_MESSAGE");
  check(
    m.header.numRequiredSignatures === 1 &&
      m.staticAccountKeys[0]?.toBase58() === e.context.keeper,
    "SIGNER",
  );
  check(
    tx.transaction.signatures.length === 1 &&
      tx.transaction.signatures[0] === e.signature,
    "SIGNATURE",
  );
  check(
    verify(
      null,
      m.serialize(),
      publicKey(new PublicKey(e.context.keeper).toBuffer()),
      decodeBase58(e.signature),
    ),
    "SIGNATURE",
  );
  check(
    m.addressTableLookups.length === 0 || tx.meta!.loadedAddresses,
    "ALT_RESOLUTION_MISSING",
  );
  const keys = m.getAccountKeys({
    accountKeysFromLookups: tx.meta!.loadedAddresses ?? null,
  });
  const address = (i: number) => {
    const k = keys.get(i);
    check(k, "ACCOUNT_INDEX");
    return k!.toBase58();
  };
  check(
    m.compiledInstructions.length === 2 &&
      address(m.compiledInstructions[0]!.programIdIndex) ===
        c.computeBudgetProgram &&
      address(m.compiledInstructions[1]!.programIdIndex) ===
        VAULT_PROGRAM.toBase58(),
    "OUTER_PROGRAMS",
  );
  const outer = m.compiledInstructions[1]!,
    outerData = Buffer.from(outer.data);
  check(
    outerData.length >= 16 &&
      outerData
        .subarray(0, 8)
        .equals(h(Buffer.from("global:execute_swap_leg")).subarray(0, 8)),
    "OUTER_ABI",
  );
  const rawLength = outerData.readUInt32LE(8);
  check(rawLength <= 1024 && 16 + rawLength <= outerData.length, "OUTER_ABI");
  const flagsLength = outerData.readUInt32LE(12 + rawLength);
  check(
    outerData.length === 16 + rawLength + flagsLength &&
      outer.accountKeyIndexes.length === 12 + flagsLength + e.seal[235]!,
    "OUTER_ABI",
  );
  const expectedInner = Array.from(
      outer.accountKeyIndexes.slice(12, 12 + flagsLength),
      address,
    ),
    expectedData = outerData.subarray(12, 12 + rawLength);
  check(
    tx.blockTime !== null &&
      tx.blockTime !== undefined &&
      BigInt(tx.blockTime) >= e.seal.readBigInt64LE(268) &&
      BigInt(tx.blockTime) < e.seal.readBigInt64LE(284),
    "EXECUTION_TIME",
  );
  check(
    BigInt(tx.slot) >= e.seal.readBigUInt64LE(276) &&
      BigInt(tx.slot) < e.seal.readBigUInt64LE(292),
    "EXECUTION_SLOT",
  );
  const pre = tx.meta!.preTokenBalances,
    post = tx.meta!.postTokenBalances;
  check(pre && post, "TOKEN_BALANCES_MISSING");
  const amount = (s: string) => {
    check(/^(0|[1-9][0-9]{0,19})$/.test(s), "TOKEN_AMOUNT");
    const n = BigInt(s);
    check(n < 1n << 64n, "TOKEN_AMOUNT");
    return n;
  };
  const before = new Map(pre!.map((b) => [address(b.accountIndex), b]));
  const after = new Map(post!.map((b) => [address(b.accountIndex), b]));
  check(
    before.size === pre!.length &&
      after.size === post!.length &&
      before.size === after.size,
    "BALANCE_ACCOUNTS",
  );
  let debit = 0n,
    credit = 0n;
  for (const [a, b] of before) {
    const z = after.get(a);
    check(
      z &&
        b.owner &&
        z.owner &&
        b.owner === z.owner &&
        b.mint === z.mint &&
        b.programId === c.tokenProgram &&
        z.programId === c.tokenProgram,
      "OWNER_OR_MINT_EVIDENCE",
    );
    const delta =
      amount(z!.uiTokenAmount.amount) - amount(b.uiTokenAmount.amount);
    if (b.owner === VAULT_AUTHORITY.toBase58()) {
      if (a === e.context.source) {
        check(
          b.mint === e.context.inputMint &&
            delta === -BigInt(e.context.inputAmount),
          "INPUT_EFFECT",
        );
        debit = -delta;
      } else if (a === e.context.destination) {
        check(
          b.mint === e.context.outputMint &&
            delta >= e.seal.readBigUInt64LE(131),
          "OUTPUT_EFFECT",
        );
        credit = delta;
      } else check(delta === 0n, "UNEXPECTED_VAULT_TOKEN_EFFECT");
    } else if (a !== e.poolInput && a !== e.poolOutput)
      check(delta === 0n, "UNEXPECTED_TOKEN_EFFECT");
    else check(b.owner === e.pool, "POOL_OWNER");
  }
  check(
    debit === e.seal.readBigUInt64LE(113) && credit > 0n,
    "MISSING_VAULT_EFFECTS",
  );
  check(
    before.get(e.poolInput)?.mint === e.context.inputMint &&
      before.get(e.poolOutput)?.mint === e.context.outputMint &&
      after.has(e.poolInput) &&
      after.has(e.poolOutput),
    "POOL_BALANCE_EVIDENCE",
  );
  check(
    amount(after.get(e.poolInput)!.uiTokenAmount.amount) -
      amount(before.get(e.poolInput)!.uiTokenAmount.amount) ===
      debit &&
      amount(before.get(e.poolOutput)!.uiTokenAmount.amount) -
        amount(after.get(e.poolOutput)!.uiTokenAmount.amount) ===
        credit,
    "POOL_EFFECTS",
  );
  const preSol = tx.meta!.preBalances,
    postSol = tx.meta!.postBalances;
  check(
    preSol.length === keys.length &&
      postSol.length === keys.length &&
      Number.isSafeInteger(tx.meta!.fee) &&
      tx.meta!.fee >= 0,
    "LAMPORT_EVIDENCE",
  );
  for (let i = 0; i < keys.length; i++) {
    check(
      Number.isSafeInteger(preSol[i]) &&
        Number.isSafeInteger(postSol[i]) &&
        preSol[i]! >= 0 &&
        postSol[i]! >= 0,
      "LAMPORT_EVIDENCE",
    );
    let expected = i === 0 ? -BigInt(tx.meta!.fee) : 0n;
    const a = address(i);
    if (e.context.inputMint === c.wrappedSolMint) {
      if (a === e.context.source) expected -= debit;
      if (a === e.poolInput) expected += debit;
    }
    if (e.context.outputMint === c.wrappedSolMint) {
      if (a === e.context.destination) expected += credit;
      if (a === e.poolOutput) expected -= credit;
    }
    check(
      BigInt(postSol[i]!) - BigInt(preSol[i]!) === expected,
      "UNEXPECTED_SOL_EFFECT",
    );
  }
  check(
    Array.isArray(tx.meta!.innerInstructions) &&
      tx.meta!.innerInstructions!.length === 1 &&
      tx.meta!.innerInstructions![0]!.index === 1,
    "INNER_EVIDENCE",
  );
  let inputTransfers = 0n,
    outputTransfers = 0n,
    jupiterCalls = 0,
    whirlCalls = 0,
    swapEvents = 0;
  for (const ix of tx.meta!.innerInstructions![0]!.instructions) {
    check(typeof ix.data === "string" && ix.data.length <= 2048, "INNER_DATA");
    const data = Buffer.from(decodeBase58(ix.data)),
      program = address(ix.programIdIndex),
      accounts = ix.accounts.map(address);
    if (program === c.tokenProgram) {
      check(
        (data[0] === 3 && data.length === 9 && accounts.length === 3) ||
          (data[0] === 12 && data.length === 10 && accounts.length === 4),
        "HOSTILE_TOKEN_INSTRUCTION",
      );
      const dest = accounts[data[0] === 3 ? 1 : 2],
        authority = accounts[data[0] === 3 ? 2 : 3],
        n = data.readBigUInt64LE(1);
      if (
        accounts[0] === e.context.source &&
        dest === e.poolInput &&
        authority === VAULT_AUTHORITY.toBase58()
      )
        inputTransfers += n;
      else if (
        accounts[0] === e.poolOutput &&
        dest === e.context.destination &&
        authority === e.pool
      )
        outputTransfers += n;
      else throw new Error("C3_RECONCILE_HOSTILE_TOKEN_TRANSFER");
      if (data[0] === 12)
        check(
          accounts[1] === before.get(accounts[0]!)?.mint &&
            data[9] === before.get(accounts[0]!)?.uiTokenAmount.decimals,
          "TRANSFER_CHECKED_MINT",
        );
    } else if (program === c.jupiterProgram) {
      const routeHash = createHash("sha256")
        .update("c3-router-data-v1")
        .update(data)
        .digest();
      if (routeHash.equals(e.seal.subarray(171, 203))) {
        check(
          data.equals(expectedData) &&
            JSON.stringify(accounts) === JSON.stringify(expectedInner),
          "INNER_ORDERED_ACCOUNTS",
        );
        jupiterCalls++;
      } else {
        verifyJupiterSwapEvent(data, accounts, e, debit, credit);
        swapEvents++;
      }
    } else if (program === WHIRL) {
      check(
        expectedData.length === 40 &&
          expectedData[34] === 17 &&
          data.length === 42 &&
          data
            .subarray(0, 8)
            .equals(h(Buffer.from("global:swap")).subarray(0, 8)) &&
          data.readBigUInt64LE(8) === debit &&
          data[40] === 1 &&
          data[41] === expectedData[35] &&
          JSON.stringify(accounts) ===
            JSON.stringify(expectedInner.slice(11)) &&
          accounts.length === 11 &&
          accounts[0] === c.tokenProgram &&
          accounts[1] === VAULT_AUTHORITY.toBase58() &&
          accounts[2] === e.pool,
        "HOSTILE_WHIRLPOOL_INSTRUCTION",
      );
      whirlCalls++;
    } else throw new Error("C3_RECONCILE_UNKNOWN_INNER_PROGRAM");
  }
  check(
    inputTransfers === debit &&
      outputTransfers === credit &&
      jupiterCalls === 1 &&
      whirlCalls === 1 &&
      swapEvents === 1,
    "INNER_EFFECT_TOTALS",
  );
  const evidenceHash = h(
    Buffer.from(
      JSON.stringify({
        signature: e.signature,
        slot: tx.slot,
        messageHash: e.messageHash,
        debit: debit.toString(),
        credit: credit.toString(),
      }),
    ),
  ).toString("hex");
  return Object.freeze({
    debit: debit.toString(),
    credit: credit.toString(),
    evidenceHash,
    scope: "LOCAL_CHAIN_ONLY",
  });
}
export async function reconcilePersistedOpenLeg(
  pool: Pool,
  rpc: Connection,
  intentId: string,
  ordinal: number,
) {
  check(
    /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint),
    "LOCAL_RPC_REQUIRED",
  );
  const row = (
    await pool.query(
      `SELECT q.canonical_payload,q.payload_hash,q.signature,q.authority,q.evidence,ctx.context,ctx.context_hash,l.submitted_signature,l.authorization_hash,i.wallet,i.vault
    FROM c3_open.quote_authorizations q JOIN c3_open.quote_contexts ctx USING(intent_id,ordinal,intent_revision)
    JOIN c3_open.legs l USING(intent_id,ordinal) JOIN c3_open.intents i USING(intent_id)
    WHERE q.intent_id=$1 AND q.ordinal=$2 AND q.state IN ('signed','consumed') AND l.state IN ('submitted','uncertain','reconciliation_required')`,
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
    genesis !== c.genesisHash &&
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
  const altHash = quoteAltContentsHash(
    accounts.map((a, i) => {
      check(a && !a.executable, "ALT_MISSING");
      return {
        address: tables[i]!.accountKey.toBase58(),
        owner: a!.owner.toBase58(),
        data: a!.data,
      };
    }),
    BigInt(tx!.slot),
  );
  check(altHash.equals(seal.subarray(228, 260)), "ALT_CHANGED");
  return verifyFinalizedEffects(tx!, {
    signature: row.submitted_signature,
    messageHash: row.evidence.executionMessageHash,
    context,
    seal,
    ...row.evidence.effectManifest,
  });
}
