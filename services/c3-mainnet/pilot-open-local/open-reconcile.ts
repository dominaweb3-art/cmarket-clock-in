/** Independent read-only verifier. Local-validator evidence only; never promotes
 * PostgreSQL state, retries, signs or submits. Missing evidence is NOT success.
 * The local journal may consume this independently checked result through its
 * own CAS transaction. A production two-operator quorum remains disabled.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  Connection,
  AddressLookupTableAccount,
  PublicKey,
  type AccountInfo,
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
/** Official Orca swap / swap_v2 ABI. V2 remains limited to legacy SPL Token
 * pairs and remaining_accounts_info=None. An invoked Memo/Token2022 program
 * remains an UNKNOWN_INNER_PROGRAM: readonly presence does not allow execution.
 */
export function verifyWhirlpoolCpi(
  data: Buffer,
  accounts: readonly string[],
  route: Buffer,
  ordered: readonly string[],
  debit: bigint,
): void {
  const legacy = route.length === 40 && route[34] === 17;
  const v2 = route.length === 41 && route[34] === 47 && route[36] === 0;
  check(
    (legacy || v2) &&
      data.length === (legacy ? 42 : 43) &&
      data
        .subarray(0, 8)
        .equals(
          h(Buffer.from(legacy ? "global:swap" : "global:swap_v2")).subarray(
            0,
            8,
          ),
        ) &&
      data.readBigUInt64LE(8) === debit &&
      data[40] === 1 &&
      data[41] === route[35] &&
      (legacy || data[42] === 0) &&
      JSON.stringify(accounts) === JSON.stringify(ordered.slice(11)) &&
      accounts.length === (legacy ? 11 : 15) &&
      accounts[0] === c.tokenProgram &&
      (legacy
        ? accounts[1] === VAULT_AUTHORITY.toBase58()
        : accounts[1] === c.tokenProgram &&
          accounts[2] === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" &&
          accounts[3] === VAULT_AUTHORITY.toBase58()),
    "HOSTILE_WHIRLPOOL_INSTRUCTION",
  );
}
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

/** Exact fixed Anchor SettlementPlan v2 layout from state.rs (901 bytes).
 * Require the next state, not merely a plausible token delta. A later plan
 * revision must be reviewed separately, never silently attributed to this leg.
 */
export function verifyFinalizedPlan(
  account: AccountInfo<Buffer> | null,
  context: StoredQuoteContext,
  debit: string,
  credit: string,
  seal: Buffer,
): bigint {
  check(
    account && !account.executable && account.owner.equals(VAULT_PROGRAM),
    "PLAN_OWNER",
  );
  const d = account!.data;
  check(
    d.length === 901 &&
      d
        .subarray(0, 8)
        .equals(h(Buffer.from("account:SettlementPlan")).subarray(0, 8)) &&
      d[8] === 2,
    "PLAN_LAYOUT",
  );
  const key = (offset: number, expected: string) =>
    check(
      new PublicKey(d.subarray(offset, offset + 32)).toBase58() === expected,
      "PLAN_BINDING",
    );
  check(d.readBigUInt64LE(9) === BigInt(context.configVersion), "PLAN_CONFIG");
  key(17, context.vault);
  key(49, context.intent);
  key(81, context.wallet);
  const [expectedPlan, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("c3-plan-v1"), new PublicKey(context.intent).toBuffer()],
    VAULT_PROGRAM,
  );
  check(
    expectedPlan.toBase58() === context.plan && d[900] === bump,
    "PLAN_PDA",
  );
  const leg = context.leg;
  check(
    Number.isInteger(leg) &&
      leg >= 0 &&
      leg < 3 &&
      (context.direction === 1 || context.direction === 2),
    "PLAN_LEG",
  );
  check(
    d[145] === context.direction &&
      d.readUInt16LE(154) === 4000 &&
      d.readUInt16LE(156) === 3000 &&
      d.readUInt16LE(158) === 3000,
    "PLAN_POLICY",
  );
  key(160 + leg * 32, context.inputMint);
  key(256 + leg * 32, context.outputMint);
  key(352 + leg * 32, context.source);
  key(448 + leg * 32, context.destination);
  key(544, context.routerProgram);
  check(
    seal.length === 300 &&
      d
        .subarray(576 + leg * 32, 608 + leg * 32)
        .equals(seal.subarray(139, 171)) &&
      d.readBigUInt64LE(672 + leg * 8) === seal.readBigUInt64LE(131) &&
      d.readUInt16LE(696) <= context.maxSlippageBps &&
      d.readBigInt64LE(706) === BigInt(context.planExpiresAt),
    "PLAN_QUOTE_BINDING",
  );
  const revision = d.readBigUInt64LE(716);
  check(
    BigInt(context.planRevision) >= BigInt(leg) &&
      revision === BigInt(context.planRevision) + 1n &&
      d[714] === (1 << (leg + 1)) - 1,
    "PLAN_REVISION",
  );
  check(
    d[715] ===
      (leg === 2
        ? context.direction === 1
          ? 3
          : 6
        : context.direction === 1
          ? 2
          : 5),
    "PLAN_LIFECYCLE",
  );
  check(
    d.readBigUInt64LE(756 + leg * 8) === BigInt(debit) &&
      d.readBigUInt64LE(780 + leg * 8) === BigInt(debit) &&
      d.readBigUInt64LE(780 + leg * 8) === BigInt(context.inputAmount) &&
      d.readBigUInt64LE(780 + leg * 8) === seal.readBigUInt64LE(113) &&
      d.readBigUInt64LE(804 + leg * 8) === BigInt(credit),
    "PLAN_EFFECTS",
  );
  check(
    d.subarray(828, 892).equals(Buffer.alloc(64)) &&
      d.readBigInt64LE(892) === 0n,
    "PLAN_AUTHORIZATION_NOT_CONSUMED",
  );
  return revision;
}

export function verifyFinalizedAltBinding(
  accounts: readonly { address: string; owner: string; data: Uint8Array }[],
  slot: bigint,
  seal: Buffer,
): void {
  check(seal.length === 300 && accounts.length === seal[235], "ALT_COUNT");
  // count at 235, hash at 236..267; 228 would overlap the metas hash/count.
  check(
    quoteAltContentsHash(accounts, slot).equals(seal.subarray(236, 268)),
    "ALT_CHANGED",
  );
}
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
  const pda = (...seeds: Buffer[]) =>
    PublicKey.findProgramAddressSync(seeds, VAULT_PROGRAM)[0].toBase58();
  const fixed = [
    e.context.keeper,
    e.context.vault,
    e.context.registry,
    e.context.policy,
    e.context.plan,
    pda(
      Buffer.from("c3-swap-auth-v1"),
      new PublicKey(e.context.plan).toBuffer(),
      e.seal.subarray(81, 113),
    ),
    pda(Buffer.from("c3-quote-receipt-v1"), e.seal.subarray(49, 81)),
    VAULT_AUTHORITY.toBase58(),
    e.context.source,
    e.context.destination,
    e.context.routerProgram,
    c.tokenProgram,
  ];
  check(
    JSON.stringify(
      Array.from(outer.accountKeyIndexes.slice(0, 12), address),
    ) === JSON.stringify(fixed),
    "OUTER_FIXED_ACCOUNTS",
  );
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
      verifyWhirlpoolCpi(data, accounts, expectedData, expectedInner, debit);
      check(
        accounts[expectedData[34] === 17 ? 2 : 4] === e.pool,
        "WHIRLPOOL_POOL_BINDING",
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
      `SELECT q.quote_id,q.canonical_payload,q.payload_hash,q.signature,q.authority,q.evidence,ctx.context,ctx.context_hash,ctx.scope,l.submitted_signature,l.authorization_hash,i.wallet,i.vault,i.db_revision,i.chain_revision
    FROM c3_open.quote_authorizations q JOIN c3_open.quote_contexts ctx USING(intent_id,ordinal,intent_revision)
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
    row.scope === "LOCAL_CLONE" &&
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
