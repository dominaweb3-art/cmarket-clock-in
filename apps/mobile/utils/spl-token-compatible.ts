import { Buffer } from 'buffer'

import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js'

/** The legacy SPL Token program used by the verified Devnet payment flow. */
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

/** The canonical Associated Token Account program. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

export class TokenOwnerOffCurveError extends Error {
  constructor() {
    super('Owner cannot be a PDA')
    this.name = 'TokenOwnerOffCurveError'
  }
}

type MultiSigner = PublicKey | { publicKey: PublicKey }

const UINT64_MAX = (1n << 64n) - 1n

function assertOwner(owner: PublicKey, allowOwnerOffCurve: boolean) {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new TokenOwnerOffCurveError()
  }
}

/**
 * Encode the exact unsigned little-endian u64 used by SPL Token.
 * This intentionally rejects coercion, truncation, negative values, and overflow.
 */
export function encodeUint64LE(value: number | bigint): Buffer {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('u64 number must be a safe integer')
    value = BigInt(value)
  }
  if (typeof value !== 'bigint' || value < 0n || value > UINT64_MAX) {
    throw new RangeError('u64 value is outside the unsigned 64-bit range')
  }

  const result = Buffer.alloc(8)
  let remaining = value
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

/** Strict decoder used by security tests and future instruction decoders. */
export function decodeUint64LE(value: unknown): bigint {
  if (!(value instanceof Uint8Array) || value.byteLength !== 8) {
    throw new TypeError('u64 input must be exactly 8 bytes')
  }

  let result = 0n
  for (let index = value.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(value[index])
  }
  return result
}

/**
 * Derive an ATA using the same seeds and program defaults as @solana/spl-token.
 * Kept local so the mobile bundle does not include its vulnerable layout helpers.
 */
export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): PublicKey {
  assertOwner(owner, allowOwnerOffCurve)
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  )
  return address
}

/** Backwards-compatible async ATA helper used by the Devnet payment flow. */
export async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): Promise<PublicKey> {
  return getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve, programId, associatedTokenProgramId)
}

/** Construct the canonical non-idempotent ATA creation instruction. */
export function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ]

  return new TransactionInstruction({
    keys,
    programId: associatedTokenProgramId,
    data: Buffer.alloc(0),
  })
}

function addSigners(keys: AccountMeta[], owner: PublicKey, multiSigners: readonly MultiSigner[]) {
  if (multiSigners.length === 0) {
    keys.push({ pubkey: owner, isSigner: true, isWritable: false })
    return keys
  }

  keys.push({ pubkey: owner, isSigner: false, isWritable: false })
  for (const signer of multiSigners) {
    const publicKey = signer instanceof PublicKey ? signer : signer.publicKey
    keys.push({ pubkey: publicKey, isSigner: true, isWritable: false })
  }
  return keys
}

/** Construct the canonical SPL Token TransferChecked instruction. */
export function createTransferCheckedInstruction(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: number | bigint,
  decimals: number,
  multiSigners: readonly MultiSigner[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError('SPL Token decimals must fit in a u8')
  }

  const keys = addSigners(
    [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
    ],
    owner,
    multiSigners,
  )
  const data = Buffer.alloc(10)
  data[0] = 12
  data.set(encodeUint64LE(amount), 1)
  data[9] = decimals

  return new TransactionInstruction({ keys, programId, data })
}
