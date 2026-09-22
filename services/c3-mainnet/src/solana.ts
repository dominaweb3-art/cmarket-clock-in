import { createHash } from "node:crypto";

import { C3_MAINNET } from "./constants.ts";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const FIELD = (1n << 255n) - 19n;
const CURVE_D = mod(-121665n * inverse(121666n));
const SQRT_M1 = pow(2n, (FIELD - 1n) / 4n);

function mod(value: bigint): bigint {
  const result = value % FIELD;
  return result >= 0n ? result : result + FIELD;
}

function pow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let value = mod(base);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = mod(result * value);
    value = mod(value * value);
    power >>= 1n;
  }
  return result;
}

function inverse(value: bigint): bigint {
  return pow(value, FIELD - 2n);
}

export function decodeBase58(value: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("Base58 value is empty.");
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new TypeError("Base58 value is malformed.");
    number = number * 58n + BigInt(digit);
  }
  const body: number[] = [];
  while (number > 0n) {
    body.push(Number(number & 0xffn));
    number >>= 8n;
  }
  body.reverse();
  let leading = 0;
  while (leading < value.length && value[leading] === "1") leading += 1;
  return Uint8Array.from([...new Array<number>(leading).fill(0), ...body]);
}

export function encodeBase58(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Base58 input must be bytes.");
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);
  let encoded = "";
  while (number > 0n) {
    encoded = BASE58_ALPHABET[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return "1".repeat(leading) + (encoded || (leading === 0 ? "1" : ""));
}

export function publicKeyBytes(value: string): Uint8Array {
  const bytes = decodeBase58(value);
  if (bytes.length !== 32)
    throw new TypeError("Public key must decode to 32 bytes.");
  return bytes;
}

export function isEd25519Point(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  const copy = Uint8Array.from(bytes);
  copy[31] = copy[31]! & 0x7f;
  let y = 0n;
  for (let index = 31; index >= 0; index -= 1)
    y = (y << 8n) | BigInt(copy[index]!);
  if (y >= FIELD) return false;
  const y2 = mod(y * y);
  const x2 = mod((y2 - 1n) * inverse(CURVE_D * y2 + 1n));
  let x = pow(x2, (FIELD + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
  return mod(x * x - x2) === 0n;
}

export function createProgramAddress(
  seeds: readonly Uint8Array[],
  programId: string,
): string {
  if (seeds.length > 16 || seeds.some((seed) => seed.length > 32))
    throw new RangeError("Program address seeds exceed Solana limits.");
  const hash = createHash("sha256");
  for (const seed of seeds) hash.update(seed);
  hash.update(publicKeyBytes(programId));
  hash.update(PDA_MARKER);
  const bytes = hash.digest();
  if (isEd25519Point(bytes)) throw new Error("Program address falls on curve.");
  return encodeBase58(bytes);
}

export function findProgramAddress(
  seeds: readonly Uint8Array[],
  programId: string,
): Readonly<{ address: string; bump: number }> {
  for (let bump = 255; bump >= 0; bump -= 1) {
    try {
      return Object.freeze({
        address: createProgramAddress(
          [...seeds, Uint8Array.of(bump)],
          programId,
        ),
        bump,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "Program address falls on curve."
      )
        throw error;
    }
  }
  throw new Error("Unable to derive a program address.");
}

export function deriveAssociatedTokenAddress(
  owner: string,
  mint: string,
): string {
  return findProgramAddress(
    [
      publicKeyBytes(owner),
      publicKeyBytes(C3_MAINNET.tokenProgram),
      publicKeyBytes(mint),
    ],
    C3_MAINNET.associatedTokenProgram,
  ).address;
}

function encodeShortVector(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x1f_ffff)
    throw new RangeError("Short vector value is outside the supported range.");
  const encoded: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    encoded.push(byte);
  } while (remaining > 0);
  return Uint8Array.from(encoded);
}

function readShortVector(bytes: Uint8Array, cursor: { value: number }): number {
  const start = cursor.value;
  let result = 0;
  let shift = 0;
  for (let count = 0; count < 3; count += 1) {
    if (cursor.value >= bytes.length)
      throw new Error("Truncated short vector.");
    const byte = bytes[cursor.value++]!;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      const consumed = bytes.slice(start, cursor.value);
      const canonical = encodeShortVector(result);
      if (
        consumed.length !== canonical.length ||
        consumed.some((value, index) => value !== canonical[index])
      )
        throw new Error("Non-canonical short vector encoding.");
      return result;
    }
    shift += 7;
  }
  throw new Error("Short vector is truncated, excessive, or overflowing.");
}

export function decodeCanonicalShortVector(bytes: Uint8Array): number {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("Short vector input must be bytes.");
  const cursor = { value: 0 };
  const value = readShortVector(bytes, cursor);
  if (cursor.value !== bytes.length)
    throw new Error("Short vector has trailing bytes.");
  return value;
}

function slice(
  bytes: Uint8Array,
  cursor: { value: number },
  length: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    cursor.value + length > bytes.length
  )
    throw new Error("Truncated versioned message.");
  const result = bytes.slice(cursor.value, cursor.value + length);
  cursor.value += length;
  return result;
}

export type LookupTableContents = Readonly<{
  address: string;
  ownerProgram: string;
  active: boolean;
  addresses: readonly string[];
  observedSlot: number;
}>;

export type DecodedV0Account = Readonly<{
  address: string;
  signer: boolean;
  writable: boolean;
  source: "static" | "lookup";
}>;

export type DecodedV0Instruction = Readonly<{
  programId: string;
  programIdIndex: number;
  accountIndexes: readonly number[];
  accounts: readonly DecodedV0Account[];
  dataBase64: string;
}>;

export type DecodedV0Message = Readonly<{
  version: 0;
  messageBase64: string;
  messageHash: string;
  recentBlockhash: string;
  requiredSignatures: number;
  staticAccounts: readonly DecodedV0Account[];
  loadedAccounts: readonly DecodedV0Account[];
  instructions: readonly DecodedV0Instruction[];
  lookupTables: readonly Readonly<{
    address: string;
    writableIndexes: readonly number[];
    readonlyIndexes: readonly number[];
    contentsHash: string;
  }>[];
  wireBytes: number;
}>;

export function decodeVersionedMessage(
  messageBase64: string,
  lookupEvidence: readonly LookupTableContents[],
): DecodedV0Message {
  if (typeof messageBase64 !== "string" || messageBase64.length === 0)
    throw new TypeError("Canonical v0 message is missing.");
  const bytes = Uint8Array.from(Buffer.from(messageBase64, "base64"));
  if (Buffer.from(bytes).toString("base64") !== messageBase64)
    throw new Error("Canonical v0 message uses alternate base64 encoding.");
  const cursor = { value: 0 };
  const version = slice(bytes, cursor, 1)[0];
  if (version !== 0x80)
    throw new Error("Only canonical v0 messages are accepted.");
  const requiredSignatures = slice(bytes, cursor, 1)[0]!;
  const readonlySigned = slice(bytes, cursor, 1)[0]!;
  const readonlyUnsigned = slice(bytes, cursor, 1)[0]!;
  const staticCount = readShortVector(bytes, cursor);
  if (requiredSignatures === 0 || requiredSignatures > staticCount)
    throw new Error("Versioned message signer header is invalid.");
  if (
    readonlySigned > requiredSignatures ||
    readonlyUnsigned > staticCount - requiredSignatures
  )
    throw new Error("Versioned message readonly header is invalid.");
  const staticKeys = Array.from({ length: staticCount }, () =>
    encodeBase58(slice(bytes, cursor, 32)),
  );
  const recentBlockhash = encodeBase58(slice(bytes, cursor, 32));
  const rawInstructions = Array.from(
    { length: readShortVector(bytes, cursor) },
    () => {
      const programIdIndex = slice(bytes, cursor, 1)[0]!;
      const accountIndexes = [
        ...slice(bytes, cursor, readShortVector(bytes, cursor)),
      ];
      const data = slice(bytes, cursor, readShortVector(bytes, cursor));
      return { programIdIndex, accountIndexes, data };
    },
  );
  const evidence = new Map(lookupEvidence.map((item) => [item.address, item]));
  if (evidence.size !== lookupEvidence.length)
    throw new Error("Duplicate lookup-table evidence.");
  const loadedAccounts: DecodedV0Account[] = [];
  const lookupTables = Array.from(
    { length: readShortVector(bytes, cursor) },
    () => {
      const address = encodeBase58(slice(bytes, cursor, 32));
      const writableIndexes = [
        ...slice(bytes, cursor, readShortVector(bytes, cursor)),
      ];
      const readonlyIndexes = [
        ...slice(bytes, cursor, readShortVector(bytes, cursor)),
      ];
      const table = evidence.get(address);
      if (
        !table ||
        table.ownerProgram !== C3_MAINNET.addressLookupTableProgram ||
        !table.active ||
        !Number.isSafeInteger(table.observedSlot) ||
        table.observedSlot <= 0
      )
        throw new Error("Lookup table is missing, inactive, or untrusted.");
      const seen = new Set<number>();
      for (const [indexes, writable] of [
        [writableIndexes, true],
        [readonlyIndexes, false],
      ] as const)
        for (const index of indexes) {
          if (seen.has(index) || !table.addresses[index])
            throw new Error("Lookup-table index is duplicate or out of range.");
          seen.add(index);
          publicKeyBytes(table.addresses[index]!);
          loadedAccounts.push(
            Object.freeze({
              address: table.addresses[index]!,
              signer: false,
              writable,
              source: "lookup" as const,
            }),
          );
        }
      const contentsHash = createHash("sha256")
        .update(table.addresses.join("\n"))
        .digest("hex");
      evidence.delete(address);
      return Object.freeze({
        address,
        writableIndexes: Object.freeze(writableIndexes),
        readonlyIndexes: Object.freeze(readonlyIndexes),
        contentsHash,
      });
    },
  );
  if (cursor.value !== bytes.length)
    throw new Error("Versioned message has trailing bytes.");
  if (evidence.size !== 0)
    throw new Error("Unused lookup-table evidence supplied.");
  const staticAccounts = staticKeys.map((address, index) =>
    Object.freeze({
      address,
      signer: index < requiredSignatures,
      writable:
        index < requiredSignatures
          ? index < requiredSignatures - readonlySigned
          : index < staticCount - readonlyUnsigned,
      source: "static" as const,
    }),
  );
  const accounts = [...staticAccounts, ...loadedAccounts];
  const instructions = rawInstructions.map((instruction) => {
    const program = accounts[instruction.programIdIndex];
    if (!program || program.signer || program.writable)
      throw new Error("Instruction program index is invalid or writable.");
    const instructionAccounts = instruction.accountIndexes.map((index) => {
      const account = accounts[index];
      if (!account)
        throw new Error("Instruction account index is out of range.");
      return account;
    });
    return Object.freeze({
      programId: program.address,
      programIdIndex: instruction.programIdIndex,
      accountIndexes: Object.freeze(instruction.accountIndexes),
      accounts: Object.freeze(instructionAccounts),
      dataBase64: Buffer.from(instruction.data).toString("base64"),
    });
  });
  const signaturePrefixBytes = requiredSignatures < 128 ? 1 : 2;
  return Object.freeze({
    version: 0,
    messageBase64,
    messageHash: createHash("sha256").update(bytes).digest("hex"),
    recentBlockhash,
    requiredSignatures,
    staticAccounts: Object.freeze(staticAccounts),
    loadedAccounts: Object.freeze(loadedAccounts),
    instructions: Object.freeze(instructions),
    lookupTables: Object.freeze(lookupTables),
    wireBytes: signaturePrefixBytes + requiredSignatures * 64 + bytes.length,
  });
}
