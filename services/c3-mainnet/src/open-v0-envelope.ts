/** Unsigned compatibility inspection only. Never a quote authority or execution gate. */
import { createHash } from "node:crypto";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  VersionedTransaction,
  type MessageV0,
} from "@solana/web3.js";
import { C3_MAINNET } from "./constants.ts";
import type { RouterBuild } from "./jupiter-v2.ts";
type LookupEvidence = Readonly<{
  table: AddressLookupTableAccount;
  owner: string;
  observedSlot: number;
}>;

const digest = (...parts: readonly Uint8Array[]): Buffer =>
  createHash("sha256").update(Buffer.concat(parts)).digest();
export const VAULT_PROGRAM = new PublicKey(
  "AFVCPVUExRgftDsE88NUewCnFyG3gRpEmkUiAdzs5qhb",
);
export const VAULT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("c3-authority-v1")],
  VAULT_PROGRAM,
)[0];
// Public address only: this tool has no keypair or signing operation.
export const MEASUREMENT_PAYER = new PublicKey(
  "11111111111111111111111111111111",
);
export function vaultAta(mint: string): string {
  return PublicKey.findProgramAddressSync(
    [
      VAULT_AUTHORITY.toBuffer(),
      new PublicKey(C3_MAINNET.tokenProgram).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(C3_MAINNET.associatedTokenProgram),
  )[0].toBase58();
}

/** Validate actual RPC table contents, not the API's advertised address list alone. */
export function inspectVaultLookups(
  advertised: RouterBuild["addressesByLookupTableAddress"],
  evidence: readonly LookupEvidence[],
  currentSlot: number,
): Readonly<{
  tables: readonly AddressLookupTableAccount[];
  contentsHash: string;
  authorities: readonly (string | null)[];
}> {
  if (
    !Number.isSafeInteger(currentSlot) ||
    currentSlot <= 0 ||
    evidence.length !== Object.keys(advertised).length
  )
    throw new Error("C3_CPI_ALT_EVIDENCE_MISSING");
  const seen = new Set<string>();
  const tables: AddressLookupTableAccount[] = [];
  const records: string[] = [];
  const authorities: (string | null)[] = [];
  for (const item of evidence) {
    const table = item.table;
    const name = table.key.toBase58();
    const addresses = table.state.addresses.map((address) =>
      address.toBase58(),
    );
    const expected = advertised[name];
    if (
      !expected ||
      seen.has(name) ||
      item.owner !== AddressLookupTableProgram.programId.toBase58() ||
      !table.isActive() ||
      addresses.length > 256 ||
      !Number.isSafeInteger(item.observedSlot) ||
      item.observedSlot <= table.state.lastExtendedSlot ||
      currentSlot < item.observedSlot ||
      expected.length !== addresses.length ||
      expected.some((address, index) => address !== addresses[index])
    )
      throw new Error("C3_CPI_ALT_UNVERIFIED");
    seen.add(name);
    tables.push(table);
    const authority = table.state.authority?.toBase58() ?? null;
    authorities.push(authority);
    records.push(
      JSON.stringify({
        name,
        owner: item.owner,
        authority,
        deactivationSlot: table.state.deactivationSlot.toString(),
        lastExtendedSlot: table.state.lastExtendedSlot,
        lastExtendedSlotStartIndex: table.state.lastExtendedSlotStartIndex,
        addresses,
      }),
    );
  }
  return Object.freeze({
    tables: Object.freeze(tables),
    contentsHash: digest(
      Buffer.from("c3-cpi-diagnostic-alt-v1"),
      Buffer.from(records.join("\n")),
    ).toString("hex"),
    authorities: Object.freeze(authorities),
  });
}

function shortLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535)
    throw new Error("C3_CPI_SIZE_INVALID");
  return value < 128 ? 1 : value < 16_384 ? 2 : 3;
}
/** Exact wire envelope, including zero signature placeholders; checked before serialization. */
export function unsignedV0Size(message: MessageV0): number {
  return (
    shortLength(message.header.numRequiredSignatures) +
    message.header.numRequiredSignatures * 64 +
    1 +
    3 +
    shortLength(message.staticAccountKeys.length) +
    message.staticAccountKeys.length * 32 +
    32 +
    shortLength(message.compiledInstructions.length) +
    message.compiledInstructions.reduce(
      (size, ix) =>
        size +
        1 +
        shortLength(ix.accountKeyIndexes.length) +
        ix.accountKeyIndexes.length +
        shortLength(ix.data.length) +
        ix.data.length,
      0,
    ) +
    shortLength(message.addressTableLookups.length) +
    message.addressTableLookups.reduce(
      (size, lookup) =>
        size +
        32 +
        shortLength(lookup.writableIndexes.length) +
        lookup.writableIndexes.length +
        shortLength(lookup.readonlyIndexes.length) +
        lookup.readonlyIndexes.length,
      0,
    )
  );
}

export function inspectUnsignedEnvelope(message: MessageV0): Readonly<{
  bytes: number;
  fits: boolean;
  serialized: boolean;
  messageHash: string | null;
}> {
  const bytes = unsignedV0Size(message);
  if (bytes > 1_232)
    return Object.freeze({
      bytes,
      fits: false,
      serialized: false,
      messageHash: null,
    });
  const transaction = new VersionedTransaction(message);
  const serialized = transaction.serialize();
  if (
    serialized.length !== bytes ||
    transaction.signatures.some((signature) =>
      signature.some((byte) => byte !== 0),
    )
  )
    throw new Error("C3_CPI_UNSIGNED_ENVELOPE_MISMATCH");
  return Object.freeze({
    bytes,
    fits: true,
    serialized: true,
    messageHash: digest(message.serialize()).toString("hex"),
  });
}
