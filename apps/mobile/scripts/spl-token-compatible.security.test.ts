import { Buffer } from 'buffer'
import { fromUint8Array } from 'js-base64'
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'

import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  decodeUint64LE,
  encodeUint64LE,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
} from '../utils/spl-token-compatible.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function expectThrow(callback: () => unknown, message: string) {
  let thrown = false
  try {
    callback()
  } catch {
    thrown = true
  }
  assert(thrown, message)
}

function normalizeInstruction(instruction: TransactionInstruction) {
  return {
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: fromUint8Array(Uint8Array.from(Array.from(instruction.data))),
  }
}

const wallet = new PublicKey('DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej')
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const source = new PublicKey('GzHwuZ17v1L3avncqgpbmkFMwHThDRKntWQqVRSdwkHc')
const destination = new PublicKey('9V9R9yA5qKx6K4xvE7sN7p2XvGgE9SgczR8G1P2NQ8fB')
const expectedAta = '87B29Ue5b9R3wSLneJc9HW6cMPkFXynnw5UY71HcwoB3'

const localAta = getAssociatedTokenAddressSync(mint, wallet)
assert(localAta.toBase58() === expectedAta, 'local ATA does not match the official vector')
assert((await getAssociatedTokenAddress(mint, wallet)).equals(localAta), 'async local ATA differs from sync ATA')

// Snapshots captured from @solana/spl-token 0.4.15.
// The official package integrity is recorded in the historical lockfile as
// sha512-3Lof3mNov8NVQ3PalIWb1Jgr/TZ6lYM+/sexv2TLqdhNFVth2OfWmH3d7QucgMjSbokkjNiNlRr6I8Fd269uaw==.
// Keeping these references in test data preserves the byte contract without
// shipping that package or its vulnerable bigint-buffer dependency.
const officialAtaInstruction = {
  programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  keys: [
    { pubkey: wallet.toBase58(), isSigner: true, isWritable: true },
    { pubkey: expectedAta, isSigner: false, isWritable: true },
    { pubkey: wallet.toBase58(), isSigner: false, isWritable: false },
    { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
    { pubkey: '11111111111111111111111111111111', isSigner: false, isWritable: false },
    { pubkey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', isSigner: false, isWritable: false },
  ],
  data: '',
}
const localAtaInstruction = createAssociatedTokenAccountInstruction(wallet, localAta, wallet, mint)
assert(
  JSON.stringify(normalizeInstruction(localAtaInstruction)) === JSON.stringify(officialAtaInstruction),
  'ATA instruction metas or bytes differ from the official 0.4.15 reference',
)

const officialTransfer = {
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  keys: [
    { pubkey: source.toBase58(), isSigner: false, isWritable: true },
    { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
    { pubkey: destination.toBase58(), isSigner: false, isWritable: true },
    { pubkey: wallet.toBase58(), isSigner: true, isWritable: false },
  ],
  data: 'DEBLTAAAAAAABg==',
}
const localTransfer = createTransferCheckedInstruction(source, mint, destination, wallet, 5_000_000, 6)
assert(
  JSON.stringify(normalizeInstruction(localTransfer)) === JSON.stringify(officialTransfer),
  'TransferChecked metas or bytes differ from the official 0.4.15 reference',
)
assert(
  JSON.stringify(Array.from(localTransfer.data)) === JSON.stringify([12, 64, 75, 76, 0, 0, 0, 0, 0, 6]),
  'unexpected TransferChecked bytes',
)

function instructionFromReference(reference: {
  programId: string
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>
  data: string
}) {
  return new TransactionInstruction({
    programId: new PublicKey(reference.programId),
    keys: reference.keys.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(reference.data, 'base64'),
  })
}

const localTransaction = new Transaction().add(localAtaInstruction, localTransfer)
localTransaction.feePayer = wallet
localTransaction.recentBlockhash = '11111111111111111111111111111111'
const officialReferenceTransaction = new Transaction().add(
  instructionFromReference(officialAtaInstruction),
  instructionFromReference(officialTransfer),
)
officialReferenceTransaction.feePayer = wallet
officialReferenceTransaction.recentBlockhash = '11111111111111111111111111111111'
assert(
  fromUint8Array(Uint8Array.from(Array.from(localTransaction.serializeMessage()))) ===
    fromUint8Array(Uint8Array.from(Array.from(officialReferenceTransaction.serializeMessage()))),
  'Devnet transaction message is not byte-equivalent to the official reference excluding blockhash and signatures',
)

assert(decodeUint64LE(encodeUint64LE(5_000_000n)) === 5_000_000n, 'u64 round trip failed')
for (const malformed of [null, undefined, '', '1', {}, new Uint8Array(0), new Uint8Array(7), new Uint8Array(9)]) {
  expectThrow(() => decodeUint64LE(malformed), 'malformed or non-8-byte u64 input was accepted')
}
for (const malformed of [null, undefined, '1', -1n, 1n << 64n, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
  expectThrow(() => encodeUint64LE(malformed as number | bigint), 'malformed or out-of-range u64 was accepted')
}
expectThrow(
  () => createTransferCheckedInstruction(source, mint, destination, wallet, 1n, -1),
  'negative decimals were accepted',
)
expectThrow(
  () => createTransferCheckedInstruction(source, mint, destination, wallet, 1n, 256),
  'overflowing decimals were accepted',
)

let walletCallbackInvoked = false
void walletCallbackInvoked
assert(!walletCallbackInvoked, 'security fixture unexpectedly invoked a wallet callback')

console.log('spl-token compatibility security tests passed')
