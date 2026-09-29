/** Read-only v0 measurement. It is NOT a vault execution authorization. */
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { C3_MAINNET } from "../src/constants.ts";
import {
  quoteFingerprint,
  type RouterBuild,
  type RouterInstruction,
  type RouterRequest,
} from "../src/jupiter-v2.ts";

const MAX_BYTES = 1_232;
const allowedOuter = new Set<string>([
  C3_MAINNET.systemProgram,
  C3_MAINNET.tokenProgram,
  C3_MAINNET.associatedTokenProgram,
  C3_MAINNET.computeBudgetProgram,
  C3_MAINNET.jupiterProgram,
]);
export type LookupEvidence = Readonly<{
  table: AddressLookupTableAccount;
  owner: string;
  observedSlot: number;
}>;
export type MeasuredV0 = Readonly<{
  bytes: number;
  requiredSigners: readonly string[];
  feePayer: string;
  programs: readonly string[];
  writableAccounts: readonly string[];
  messageHash: string;
  routeFingerprint: string;
  executable: false;
}>;

function toInstruction(instruction: RouterInstruction): TransactionInstruction {
  const bytes = Buffer.from(instruction.data, "base64");
  if (bytes.toString("base64") !== instruction.data)
    throw new Error("C3_V0_INVALID_INSTRUCTION_DATA");
  if (!allowedOuter.has(instruction.programId))
    throw new Error("C3_V0_UNKNOWN_OUTER_PROGRAM");
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((meta) => ({
      pubkey: new PublicKey(meta.pubkey),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    data: bytes,
  });
}

export function measureUnsignedV0Candidate(
  input: Readonly<{
    build: RouterBuild;
    request: RouterRequest;
    feePayer: string;
    lookupEvidence: readonly LookupEvidence[];
    currentSlot: number;
    currentBlockHeight: number;
    allowedWritableAccounts: readonly string[];
    expectedSource: string;
    expectedDestination: string;
  }>,
): MeasuredV0 {
  const { build, request } = input;
  if (
    build.inputMint !== request.inputMint ||
    build.outputMint !== request.outputMint ||
    build.inAmount !== request.amount.toString() ||
    build.slippageBps !== request.slippageBps ||
    BigInt(build.otherAmountThreshold) < 1n ||
    BigInt(build.otherAmountThreshold) > BigInt(build.outAmount) ||
    BigInt(build.otherAmountThreshold) <
      (BigInt(build.outAmount) * BigInt(10_000 - request.slippageBps)) / 10_000n
  )
    throw new Error("C3_V0_QUOTE_MISMATCH");
  const age = Date.now() - build.blockhashWithMetadata.fetchedAtEpochMs;
  if (
    age < -5_000 ||
    age > 30_000 ||
    input.currentBlockHeight > build.blockhashWithMetadata.lastValidBlockHeight
  )
    throw new Error("C3_V0_STALE_BLOCKHASH");
  if (
    !Number.isSafeInteger(input.currentSlot) ||
    input.currentSlot < 1 ||
    !Number.isSafeInteger(input.currentBlockHeight) ||
    input.currentBlockHeight < 1
  )
    throw new Error("C3_V0_INVALID_SLOT");
  const advertised = build.addressesByLookupTableAddress;
  if (input.lookupEvidence.length !== Object.keys(advertised).length)
    throw new Error("C3_V0_LOOKUP_EVIDENCE_MISSING");
  const lookupTables: AddressLookupTableAccount[] = [];
  const seen = new Set<string>();
  for (const evidence of input.lookupEvidence) {
    const key = evidence.table.key.toBase58();
    const expected = advertised[key];
    if (
      !expected ||
      seen.has(key) ||
      evidence.owner !== AddressLookupTableProgram.programId.toBase58() ||
      !evidence.table.isActive() ||
      evidence.observedSlot < evidence.table.state.lastExtendedSlot ||
      evidence.observedSlot > input.currentSlot ||
      expected.length !== evidence.table.state.addresses.length ||
      expected.some(
        (address, index) =>
          address !== evidence.table.state.addresses[index]?.toBase58(),
      )
    )
      throw new Error("C3_V0_UNVERIFIED_LOOKUP_TABLE");
    seen.add(key);
    lookupTables.push(evidence.table);
  }
  const ordered = [
    ...build.computeBudgetInstructions,
    ...build.setupInstructions,
    build.swapInstruction,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
  ];
  const instructions = ordered.map(toInstruction);
  if (build.otherInstructions.length || build.tipInstruction)
    throw new Error("C3_V0_UNEXPECTED_INSTRUCTION");
  const swapAccounts = new Set(
    build.swapInstruction.accounts.map((account) => account.pubkey),
  );
  if (
    !swapAccounts.has(input.expectedSource) ||
    !swapAccounts.has(input.expectedDestination) ||
    !build.swapInstruction.accounts.some(
      (account) =>
        account.pubkey === input.expectedSource && account.isWritable,
    ) ||
    !build.swapInstruction.accounts.some(
      (account) =>
        account.pubkey === input.expectedDestination && account.isWritable,
    )
  )
    throw new Error("C3_V0_SOURCE_OR_DESTINATION_MISSING");
  const writable = new Set<string>();
  for (const instruction of instructions) {
    for (const meta of instruction.keys) {
      if (meta.isWritable) writable.add(meta.pubkey.toBase58());
      if (meta.isSigner && meta.pubkey.toBase58() !== input.feePayer)
        throw new Error("C3_V0_UNEXPECTED_REQUIRED_SIGNER");
    }
  }
  if (
    ![...writable].every((account) =>
      input.allowedWritableAccounts.includes(account),
    )
  )
    throw new Error("C3_V0_UNREVIEWED_WRITABLE_ACCOUNT");
  const feePayer = new PublicKey(input.feePayer);
  if (
    request.taker !== input.feePayer ||
    !PublicKey.isOnCurve(feePayer.toBytes())
  )
    throw new Error("C3_V0_VAULT_PDA_CANNOT_SIGN_EXTERNALLY");
  const blockhash = new PublicKey(
    Uint8Array.from(build.blockhashWithMetadata.blockhash),
  ).toBase58();
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  if (
    message.header.numRequiredSignatures !== 1 ||
    message.staticAccountKeys[0]?.toBase58() !== input.feePayer
  )
    throw new Error("C3_V0_SIGNER_OR_FEE_PAYER_MISMATCH");
  // A valid v0 message can still overflow the 1,232-byte packet limit.
  const transaction = new VersionedTransaction(message);
  let bytes: number;
  try {
    bytes = transaction.serialize().length;
  } catch {
    throw new Error("C3_V0_SERIALIZATION_OVERFLOW");
  }
  if (bytes > MAX_BYTES) throw new Error("C3_V0_TRANSACTION_TOO_LARGE");
  const hash = createHash("sha256").update(message.serialize()).digest("hex");
  return Object.freeze({
    bytes,
    requiredSigners: Object.freeze([input.feePayer]),
    feePayer: input.feePayer,
    programs: Object.freeze(instructions.map((ix) => ix.programId.toBase58())),
    writableAccounts: Object.freeze([...writable]),
    messageHash: hash,
    routeFingerprint: quoteFingerprint(build),
    executable: false,
  });
}

/** No PDA swap can proceed to wallet approval from this measurement module. */
export function assertVaultExecutionAuthorized(
  _measurement: MeasuredV0,
): never {
  throw new Error("C3_V0_PDA_SWAP_EXECUTION_NOT_IMPLEMENTED");
}

/** Bounded fresh-route search; never called after signature/submission. */
export async function measureFreshRoutes(
  obtain: (maxAccounts: 64 | 48 | 32) => Promise<MeasuredV0>,
): Promise<MeasuredV0> {
  let last: unknown;
  for (const maxAccounts of [64, 48, 32] as const) {
    try {
      return await obtain(maxAccounts);
    } catch (error) {
      last = error;
      if (
        !(error instanceof Error) ||
        !/C3_V0_(TRANSACTION_TOO_LARGE|SERIALIZATION_OVERFLOW)/.test(
          error.message,
        )
      )
        throw error;
    }
  }
  throw last ?? new Error("C3_V0_NO_FRESH_ROUTE");
}
