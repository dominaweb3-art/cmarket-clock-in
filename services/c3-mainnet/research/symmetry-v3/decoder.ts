// Research-only parser for already-finalized public evidence. Never export from src/.
import { createHash, createPublicKey, verify } from "node:crypto";
import { C3_MAINNET } from "../../src/constants.ts";
import {
  decodeBase58,
  decodeVersionedMessage,
  deriveAssociatedTokenAddress,
  encodeBase58,
  type DecodedV0Account,
} from "../../src/solana.ts";

type RecordValue = Record<string, unknown>;
export type PublicFixture = Readonly<{
  schemaVersion: 1;
  cluster: "mainnet-beta";
  signature: string;
  source: string;
  secondarySource: string;
  retrievedAtUtc: string;
  response: unknown;
  secondaryResponse: unknown;
  primaryStatus: unknown;
  secondaryStatus: unknown;
  secondaryResponseHash: string;
  responseHash: string;
  rawTransactionHash: string;
}>;

const hash = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as RecordValue)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
};
const object = (value: unknown, name: string): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Missing ${name}`);
  return value as RecordValue;
};
const array = (value: unknown, name: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`Missing ${name}`);
  return value;
};
const str = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name}`);
  return value;
};
const uint = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`Invalid ${name}`);
  return value as number;
};
const base64 = (value: unknown, name: string): Buffer => {
  const encoded = str(value, name);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new Error(`Invalid ${name}`);
  return bytes;
};
const bounded = (bytes: Uint8Array, position: number, length: number) => {
  if (position + length > bytes.length)
    throw new Error("Truncated wire transaction");
  return bytes.slice(position, position + length);
};
const shortvec = (bytes: Uint8Array, cursor: { value: number }): number => {
  let value = 0;
  let shift = 0;
  let count = 0;
  while (true) {
    const byte = bounded(bytes, cursor.value++, 1)[0]!;
    count += 1;
    if (count > 3 || (count === 3 && byte > 3))
      throw new Error("Invalid shortvec");
    value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) {
      if ((value < 128 && count !== 1) || (value < 16384 && count === 3))
        throw new Error("Noncanonical shortvec");
      return value;
    }
    shift += 7;
  }
};
const amount = (data: Buffer, offset = 1): string => {
  if (data.length < offset + 8) throw new Error("Truncated SPL amount");
  return data.readBigUInt64LE(offset).toString();
};

export type ObservedInstruction = Readonly<{
  location: "outer" | "inner";
  outerIndex: number;
  innerIndex: number | null;
  programId: string;
  programIdIndex: number;
  accountIndexes: readonly number[];
  accounts: readonly string[];
  dataBase64: string;
  dataSha256: string;
  discriminatorHex: string | null;
  tokenOperation: string | null;
  tokenAmount: string | null;
  tokenSource: string | null;
  tokenDestination: string | null;
  tokenAuthority: string | null;
  tokenDecimals: number | null;
  associatedTokenOperation: "create" | "createIdempotent" | null;
  systemOperation: "transfer" | "createAccount" | null;
  systemTransferLamports: string | null;
}>;

const tokenOperations: Record<number, string> = {
  3: "transfer",
  4: "approve",
  5: "revoke",
  7: "mintTo",
  8: "burn",
  9: "closeAccount",
  12: "transferChecked",
  13: "approveChecked",
  14: "mintToChecked",
  15: "burnChecked",
  17: "syncNative",
};

function observedInstruction(
  location: "outer" | "inner",
  outerIndex: number,
  innerIndex: number | null,
  programIdIndex: number,
  accountIndexes: readonly number[],
  data: Buffer,
  accounts: readonly DecodedV0Account[],
  symmetryProgram: string,
): ObservedInstruction {
  const program = accounts[programIdIndex];
  if (!program || program.signer || program.writable)
    throw new Error("Unknown or writable instruction program");
  const keys = accountIndexes.map((index) => {
    const key = accounts[index];
    if (!key) throw new Error("Instruction account index out of bounds");
    return key.address;
  });
  const isToken = program.address === C3_MAINNET.tokenProgram;
  const isAta = program.address === C3_MAINNET.associatedTokenProgram;
  if (isAta && !(data.length === 0 || (data.length === 1 && data[0] === 1)))
    throw new Error("Unknown associated-token instruction");
  if (
    isAta &&
    (keys.length < 6 ||
      keys[4] !== C3_MAINNET.systemProgram ||
      keys[5] !== C3_MAINNET.tokenProgram ||
      keys[1] !== deriveAssociatedTokenAddress(keys[2]!, keys[3]!))
  )
    throw new Error("Associated-token account derivation mismatch");
  const isSystem = program.address === C3_MAINNET.systemProgram;
  const systemOpcode =
    isSystem && data.length >= 4 ? data.readUInt32LE(0) : null;
  const systemOperation =
    systemOpcode === 2
      ? "transfer"
      : systemOpcode === 0
        ? "createAccount"
        : null;
  if (
    systemOperation === "transfer" &&
    (data.length !== 12 || keys.length !== 2)
  )
    throw new Error("Malformed system transfer");
  if (
    systemOperation === "createAccount" &&
    (data.length !== 52 || keys.length !== 2)
  )
    throw new Error("Malformed system account creation");
  const opcode = data[0];
  const tokenOperation =
    isToken && opcode !== undefined ? tokenOperations[opcode] : undefined;
  if (isToken && !tokenOperation)
    throw new Error("Unknown SPL Token instruction");
  const expectedTokenDataLengths: Record<string, number> = {
    transfer: 9,
    approve: 9,
    revoke: 1,
    mintTo: 9,
    burn: 9,
    closeAccount: 1,
    transferChecked: 10,
    approveChecked: 10,
    mintToChecked: 10,
    burnChecked: 10,
    syncNative: 1,
  };
  if (
    tokenOperation &&
    data.length !== expectedTokenDataLengths[tokenOperation]
  )
    throw new Error("Malformed SPL Token instruction length");
  if (
    isToken &&
    tokenOperation === "transferChecked" &&
    (data.length !== 10 || keys.length < 4)
  )
    throw new Error("Malformed transferChecked");
  if (
    isToken &&
    tokenOperation === "burnChecked" &&
    (data.length !== 10 || keys.length < 3)
  )
    throw new Error("Malformed burnChecked");
  if (
    isToken &&
    tokenOperation === "mintToChecked" &&
    (data.length !== 10 || keys.length < 3)
  )
    throw new Error("Malformed mintToChecked");
  if (
    isToken &&
    tokenOperation === "transfer" &&
    (data.length !== 9 || keys.length < 3)
  )
    throw new Error("Malformed transfer");
  const hasAmount =
    tokenOperation &&
    [
      "transfer",
      "transferChecked",
      "mintTo",
      "mintToChecked",
      "burn",
      "burnChecked",
    ].includes(tokenOperation);
  const sourceIndex = tokenOperation?.startsWith("transfer")
    ? 0
    : tokenOperation?.startsWith("burn")
      ? 0
      : null;
  const destIndex = tokenOperation?.startsWith("transfer")
    ? tokenOperation === "transferChecked"
      ? 2
      : 1
    : tokenOperation?.startsWith("mintTo")
      ? 1
      : null;
  const authIndex =
    tokenOperation === "transferChecked"
      ? 3
      : tokenOperation === "transfer"
        ? 2
        : tokenOperation?.startsWith("mintTo") ||
            tokenOperation?.startsWith("burn")
          ? 2
          : null;
  return Object.freeze({
    location,
    outerIndex,
    innerIndex,
    programId: program.address,
    programIdIndex,
    accountIndexes: Object.freeze([...accountIndexes]),
    accounts: Object.freeze(keys),
    dataBase64: data.toString("base64"),
    dataSha256: hash(data),
    discriminatorHex:
      program.address === symmetryProgram && data.length >= 8
        ? data.subarray(0, 8).toString("hex")
        : null,
    tokenOperation: tokenOperation ?? null,
    tokenAmount: hasAmount ? amount(data) : null,
    tokenSource: sourceIndex === null ? null : (keys[sourceIndex] ?? null),
    tokenDestination: destIndex === null ? null : (keys[destIndex] ?? null),
    tokenAuthority: authIndex === null ? null : (keys[authIndex] ?? null),
    tokenDecimals: tokenOperation?.endsWith("Checked") ? data[9]! : null,
    associatedTokenOperation: isAta
      ? data.length === 0
        ? "create"
        : "createIdempotent"
      : null,
    systemOperation,
    systemTransferLamports:
      systemOperation === "transfer"
        ? data.readBigUInt64LE(4).toString()
        : null,
  });
}

function balances(
  meta: RecordValue,
  side: "pre" | "post",
  accounts: readonly DecodedV0Account[],
) {
  return array(meta[`${side}TokenBalances`], `${side}TokenBalances`).map(
    (row) => {
      const item = object(row, "token balance");
      const index = uint(item.accountIndex, "token account index");
      const account = accounts[index];
      if (!account) throw new Error("Token balance account index out of range");
      const mint = str(item.mint, "token mint");
      const owner = str(item.owner, "token owner");
      const programId = str(item.programId, "token program");
      if (programId !== C3_MAINNET.tokenProgram)
        throw new Error("Unknown token program");
      if (decodeBase58(mint).length !== 32 || decodeBase58(owner).length !== 32)
        throw new Error("Malformed token mint or owner");
      const ui = object(item.uiTokenAmount, "uiTokenAmount");
      const value = str(ui.amount, "token amount");
      if (!/^(0|[1-9][0-9]*)$/.test(value))
        throw new Error("Noncanonical token amount");
      const decimals = uint(ui.decimals, "token decimals");
      if (decimals > 255) throw new Error("Invalid token decimals");
      return {
        index,
        account: account.address,
        mint,
        owner,
        programId,
        amount: value,
        decimals,
      };
    },
  );
}

export function decodePublicFixture(
  fixture: PublicFixture,
  expected: Readonly<{
    cluster: "mainnet-beta";
    signature: string;
    symmetryProgram: string;
  }>,
) {
  if (
    fixture.schemaVersion !== 1 ||
    fixture.cluster !== expected.cluster ||
    fixture.cluster !== "mainnet-beta"
  )
    throw new Error("Cluster or fixture schema mismatch");
  if (
    fixture.signature !== expected.signature ||
    expected.symmetryProgram !== C3_MAINNET.symmetryProgram
  )
    throw new Error("Signature or program mismatch");
  if (!Number.isFinite(Date.parse(fixture.retrievedAtUtc)))
    throw new Error("Missing retrieval time");
  const result = object(fixture.response, "RPC transaction");
  if (
    hash(canonicalJson(result)) !== fixture.responseHash ||
    hash(canonicalJson(fixture.secondaryResponse)) !==
      fixture.secondaryResponseHash ||
    fixture.secondaryResponseHash !== fixture.responseHash
  )
    throw new Error("Public RPC evidence hash mismatch");
  const status = object(fixture.primaryStatus, "primary finality");
  const secondaryStatus = object(fixture.secondaryStatus, "secondary finality");
  for (const item of [status, secondaryStatus]) {
    if (item.confirmationStatus !== "finalized" || item.err !== null)
      throw new Error("Transaction is not finalized and successful");
  }
  const slot = uint(result.slot, "slot");
  if (
    uint(status.slot, "primary status slot") !== slot ||
    uint(secondaryStatus.slot, "secondary status slot") !== slot
  )
    throw new Error("Finality slot disagreement");
  if (
    slot === 0 ||
    !Number.isSafeInteger(result.blockTime) ||
    result.version !== 0
  )
    throw new Error("Transaction slot, block time or version missing");
  const wireArray = array(result.transaction, "base64 wire transaction");
  if (wireArray.length !== 2 || wireArray[1] !== "base64")
    throw new Error("Expected raw base64 transaction");
  const wire = base64(wireArray[0], "wire transaction");
  if (
    wire.length > 1232 ||
    wire.length < 66 ||
    hash(wire) !== fixture.rawTransactionHash
  )
    throw new Error("Transaction size or hash mismatch");
  const cursor = { value: 0 };
  const signatureCount = shortvec(wire, cursor);
  const signatures: string[] = [];
  const signatureBytes: Uint8Array[] = [];
  for (let index = 0; index < signatureCount; index += 1) {
    const bytes = bounded(wire, cursor.value, 64);
    cursor.value += 64;
    signatureBytes.push(bytes);
    signatures.push(encodeBase58(bytes));
  }
  if (signatures[0] !== fixture.signature)
    throw new Error("Wire signature mismatch");
  const message = wire.subarray(cursor.value);
  const meta = object(result.meta, "transaction metadata");
  if (meta.err !== null || object(meta.status, "status").Ok === undefined)
    throw new Error("Transaction failed");
  const loaded = object(meta.loadedAddresses, "loaded addresses");
  const loadedWritable = array(loaded.writable, "loaded writable addresses");
  const loadedReadonly = array(loaded.readonly, "loaded readonly addresses");
  // Historical ALT contents are not established by the observed evidence. Fail closed.
  const decoded = decodeVersionedMessage(
    Buffer.from(message).toString("base64"),
    [],
  );
  if (
    decoded.lookupTables.length ||
    loadedWritable.length ||
    loadedReadonly.length
  )
    throw new Error("Historical ALT resolution unavailable");
  if (
    decoded.wireBytes !== wire.length ||
    decoded.requiredSignatures !== signatureCount
  )
    throw new Error("Message/signature length disagreement");
  for (let index = 0; index < signatureCount; index += 1) {
    const signer = decoded.staticAccounts[index];
    if (!signer) throw new Error("Missing signer");
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(decodeBase58(signer.address)),
      ]),
      format: "der",
      type: "spki",
    });
    if (!verify(null, message, key, signatureBytes[index]!))
      throw new Error("Ed25519 signature verification failed");
  }
  const accounts = [...decoded.staticAccounts, ...decoded.loadedAccounts];
  const outerInstructions = decoded.instructions.map((ix, outerIndex) =>
    observedInstruction(
      "outer",
      outerIndex,
      null,
      ix.programIdIndex,
      ix.accountIndexes,
      base64(ix.dataBase64, "outer instruction data"),
      accounts,
      expected.symmetryProgram,
    ),
  );
  const innerGroups = array(meta.innerInstructions, "inner instructions");
  const innerInstructions: ObservedInstruction[] = [];
  const seenGroups = new Set<number>();
  for (const group of innerGroups) {
    const item = object(group, "inner group");
    const outerIndex = uint(item.index, "inner outer index");
    if (outerIndex >= outerInstructions.length || seenGroups.has(outerIndex))
      throw new Error("Duplicate or invalid inner group");
    seenGroups.add(outerIndex);
    array(item.instructions, "inner instruction list").forEach(
      (entry, innerIndex) => {
        const inner = object(entry, "inner instruction");
        const indexes = array(inner.accounts, "inner accounts").map((index) =>
          uint(index, "inner account index"),
        );
        const data = Buffer.from(
          decodeBase58(str(inner.data, "inner instruction data")),
        );
        innerInstructions.push(
          observedInstruction(
            "inner",
            outerIndex,
            innerIndex,
            uint(inner.programIdIndex, "inner program index"),
            indexes,
            data,
            accounts,
            expected.symmetryProgram,
          ),
        );
      },
    );
  }
  const pre = balances(meta, "pre", accounts);
  const post = balances(meta, "post", accounts);
  const balanceMap = new Map<
    string,
    { pre?: (typeof pre)[number]; post?: (typeof post)[number] }
  >();
  for (const row of pre) {
    if (balanceMap.has(row.account))
      throw new Error("Duplicate pre-token balance");
    balanceMap.set(row.account, { pre: row });
  }
  const seenPost = new Set<string>();
  for (const row of post) {
    if (seenPost.has(row.account))
      throw new Error("Duplicate post-token balance");
    seenPost.add(row.account);
    balanceMap.set(row.account, { ...balanceMap.get(row.account), post: row });
  }
  const tokenEffects = [...balanceMap.values()].map(
    ({ pre: before, post: after }) => {
      const identity = before ?? after!;
      if (
        before &&
        after &&
        (before.mint !== after.mint ||
          before.owner !== after.owner ||
          before.decimals !== after.decimals ||
          before.index !== after.index)
      )
        throw new Error("Token balance identity changed");
      return {
        account: identity.account,
        owner: identity.owner,
        mint: identity.mint,
        decimals: identity.decimals,
        pre: before?.amount ?? null,
        post: after?.amount ?? null,
        delta: (
          BigInt(after?.amount ?? "0") - BigInt(before?.amount ?? "0")
        ).toString(),
        incompleteSide: !before || !after,
      };
    },
  );
  const logs = array(meta.logMessages, "logs").map((value) =>
    str(value, "log line"),
  );
  const preLamports = array(meta.preBalances, "pre lamport balances");
  const postLamports = array(meta.postBalances, "post lamport balances");
  if (
    preLamports.length !== accounts.length ||
    postLamports.length !== accounts.length
  )
    throw new Error("Lamport evidence length mismatch");
  const lamportEffects = accounts
    .map((account, index) => ({
      account: account.address,
      delta: (
        BigInt(uint(postLamports[index], "post lamports")) -
        BigInt(uint(preLamports[index], "pre lamports"))
      ).toString(),
    }))
    .filter((item) => item.delta !== "0");
  if (
    lamportEffects.reduce((sum, item) => sum + BigInt(item.delta), 0n) !==
    -BigInt(uint(meta.fee, "network fee"))
  )
    throw new Error("Lamport conservation or fee evidence mismatch");
  return Object.freeze({
    signature: fixture.signature,
    slot,
    blockTime: result.blockTime,
    version: 0,
    messageHash: decoded.messageHash,
    recentBlockhash: decoded.recentBlockhash,
    wireBytes: wire.length,
    signers: decoded.staticAccounts
      .filter((item) => item.signer)
      .map((item) => item.address),
    feePayer: decoded.staticAccounts[0]!.address,
    staticAccounts: decoded.staticAccounts,
    loadedAccounts: decoded.loadedAccounts,
    lookupTables: decoded.lookupTables,
    outerInstructions,
    innerInstructions,
    tokenEffects,
    lamportEffects,
    feeLamports: uint(meta.fee, "network fee"),
    logs,
    rewards: array(meta.rewards, "rewards"),
    fingerprint: hash(
      canonicalJson({
        signature: fixture.signature,
        responseHash: fixture.responseHash,
        rawTransactionHash: fixture.rawTransactionHash,
      }),
    ),
  });
}
