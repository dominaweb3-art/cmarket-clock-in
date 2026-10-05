/** Unsigned compatibility inspection only. Never a quote authority or execution gate. */
import { createHash } from "node:crypto";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type MessageV0,
} from "@solana/web3.js";
import { C3_MAINNET } from "../src/constants.ts";
import type { RouterBuild, RouterRequest } from "../src/jupiter-v2.ts";
import type { LookupEvidence } from "./jupiter-v0-measure.ts";

const digest = (...parts: readonly Uint8Array[]): Buffer =>
  createHash("sha256").update(Buffer.concat(parts)).digest();
const discriminator = (name: string): Buffer =>
  digest(Buffer.from(`global:${name}`)).subarray(0, 8);
export const VAULT_PROGRAM = new PublicKey(
  "HTc3na8WFnsExbV1oxutKhTxyWE9PEsVRhjjkXAhajwV",
);
export const VAULT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from("c3-authority-v1")],
  VAULT_PROGRAM,
)[0];
// Public address only: this tool has no keypair or signing operation.
export const MEASUREMENT_PAYER = new PublicKey(
  "11111111111111111111111111111111",
);
const pda = (...seeds: readonly Uint8Array[]): PublicKey =>
  PublicKey.findProgramAddressSync(
    seeds.map((seed) => Buffer.from(seed)),
    VAULT_PROGRAM,
  )[0];
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

/** Measure the actual ExecuteSwapLeg outer shape, not a standalone wallet swap. */
export function inspectVaultCpiEnvelope(
  input: Readonly<{
    build: RouterBuild;
    request: RouterRequest;
    lookupEvidence: readonly LookupEvidence[];
    currentSlot: number;
    currentBlockHeight: number;
    nowMs: number;
  }>,
): Readonly<{
  bytes: number;
  fits: boolean;
  serialized: boolean;
  messageHash: string | null;
  lookupCount: number;
  lookupAuthorities: readonly (string | null)[];
  lookupContentsHash: string;
  requiredSigners: readonly string[];
  staticAccounts: number;
  resolvedLookupAccounts: number;
  orderedMetas: number;
  duplicateOccurrences: number;
  routerAliasIndexes: readonly number[];
  instructionHash: string;
  discriminatorHex: string;
  executable: false;
}> {
  const { build, request } = input;
  if (
    request.taker !== VAULT_AUTHORITY.toBase58() ||
    request.destinationTokenAccount !== vaultAta(request.outputMint) ||
    build.inputMint !== request.inputMint ||
    build.outputMint !== request.outputMint ||
    build.inAmount !== request.amount.toString() ||
    build.slippageBps !== request.slippageBps ||
    build.swapInstruction.programId !== C3_MAINNET.jupiterProgram ||
    build.otherInstructions.length ||
    build.tipInstruction ||
    build.cleanupInstruction
  )
    throw new Error("C3_CPI_QUOTE_CONTEXT_MISMATCH");
  if (
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < build.blockhashWithMetadata.fetchedAtEpochMs - 5_000 ||
    input.nowMs - build.blockhashWithMetadata.fetchedAtEpochMs > 30_000 ||
    !Number.isSafeInteger(input.currentBlockHeight) ||
    input.currentBlockHeight > build.blockhashWithMetadata.lastValidBlockHeight
  )
    throw new Error("C3_CPI_QUOTE_OR_BLOCKHASH_EXPIRED");
  const source = vaultAta(request.inputMint);
  const destination = vaultAta(request.outputMint);
  const accounts = build.swapInstruction.accounts;
  if (
    !accounts.some((meta) => meta.pubkey === source && meta.isWritable) ||
    !accounts.some((meta) => meta.pubkey === destination && meta.isWritable) ||
    !accounts.some((meta) => meta.pubkey === request.taker && meta.isSigner) ||
    accounts.some((meta) => meta.isSigner && meta.pubkey !== request.taker)
  )
    throw new Error("C3_CPI_SOURCE_DESTINATION_OR_SIGNER_MISMATCH");
  const lookups = inspectVaultLookups(
    build.addressesByLookupTableAddress,
    input.lookupEvidence,
    input.currentSlot,
  );
  const data = Buffer.from(build.swapInstruction.data, "base64");
  if (
    data.length < 8 ||
    data.length > 1_024 ||
    data.toString("base64") !== build.swapInstruction.data
  )
    throw new Error("C3_CPI_INSTRUCTION_INVALID");
  const config = pda(Buffer.from("c3-vault-v1"));
  // Synthetic identifiers for measurement only. No existing intent is claimed here.
  const intent = pda(Buffer.from("diagnostic-intent"));
  const plan = pda(Buffer.from("c3-plan-v1"), intent.toBuffer());
  const nonce = digest(Buffer.from("c3-cpi-diagnostic-nonce"));
  const fixed = [
    [MEASUREMENT_PAYER, false],
    [config, false],
    [pda(Buffer.from("c3-route-reg-v1"), config.toBuffer()), false],
    [pda(Buffer.from("c3-quote-policy-v1"), config.toBuffer()), false],
    [plan, true],
    [pda(Buffer.from("c3-swap-auth-v1"), plan.toBuffer(), nonce), true],
    [pda(Buffer.from("c3-quote-receipt-v1"), nonce), true],
    [VAULT_AUTHORITY, false],
    [new PublicKey(source), true],
    [new PublicKey(destination), true],
    [new PublicKey(C3_MAINNET.jupiterProgram), false],
    [new PublicKey(C3_MAINNET.tokenProgram), false],
  ] as const;
  const vectorLength = Buffer.alloc(4);
  vectorLength.writeUInt32LE(data.length);
  const wrapper = new TransactionInstruction({
    programId: VAULT_PROGRAM,
    keys: [
      ...fixed.map(([pubkey, isWritable], index) => ({
        pubkey,
        isWritable,
        isSigner: index === 0,
      })),
      ...accounts.map((meta) => ({
        pubkey: new PublicKey(meta.pubkey),
        isSigner: false,
        isWritable: meta.isWritable,
      })),
      ...input.lookupEvidence.map(({ table }) => ({
        pubkey: table.key,
        isSigner: false,
        isWritable: false,
      })),
    ],
    data: Buffer.concat([
      discriminator("execute_swap_leg"),
      vectorLength,
      data,
      (() => {
        const flags = Buffer.from(
          accounts.map(
            (meta) => Number(meta.isSigner) | (Number(meta.isWritable) << 1),
          ),
        );
        const length = Buffer.alloc(4);
        length.writeUInt32LE(flags.length);
        return Buffer.concat([length, flags]);
      })(),
    ]),
  });
  const message = new TransactionMessage({
    payerKey: MEASUREMENT_PAYER,
    recentBlockhash: new PublicKey(
      Uint8Array.from(build.blockhashWithMetadata.blockhash),
    ).toBase58(),
    instructions: [wrapper],
  }).compileToV0Message([...lookups.tables]);
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.staticAccountKeys[0]!.equals(MEASUREMENT_PAYER)
  )
    throw new Error("C3_CPI_UNEXPECTED_OUTER_SIGNER");
  // Resolve actual compiled indexes and prove duplicates retained their ordering.
  const keys = message.getAccountKeys({
    addressLookupTableAccounts: [...lookups.tables],
  });
  const compiled = message.compiledInstructions[0]!;
  if (
    compiled.accountKeyIndexes.length !== wrapper.keys.length ||
    compiled.accountKeyIndexes.some(
      (index, occurrence) =>
        !keys.get(index)?.equals(wrapper.keys[occurrence]!.pubkey),
    )
  )
    throw new Error("C3_CPI_RESOLVED_ACCOUNT_MISMATCH");
  const envelope = inspectUnsignedEnvelope(message);
  return Object.freeze({
    ...envelope,
    lookupCount: lookups.tables.length,
    lookupAuthorities: lookups.authorities,
    lookupContentsHash: lookups.contentsHash,
    requiredSigners: Object.freeze([MEASUREMENT_PAYER.toBase58()]),
    staticAccounts: message.staticAccountKeys.length,
    resolvedLookupAccounts: message.addressTableLookups.reduce(
      (n, table) =>
        n + table.writableIndexes.length + table.readonlyIndexes.length,
      0,
    ),
    orderedMetas: accounts.length,
    duplicateOccurrences:
      accounts.length - new Set(accounts.map((meta) => meta.pubkey)).size,
    routerAliasIndexes: Object.freeze(
      accounts.flatMap((meta, index) =>
        meta.pubkey === C3_MAINNET.jupiterProgram ? [index] : [],
      ),
    ),
    instructionHash: digest(Buffer.from("c3-router-data-v1"), data).toString(
      "hex",
    ),
    discriminatorHex: data.subarray(0, 8).toString("hex"),
    executable: false as const,
  });
}
