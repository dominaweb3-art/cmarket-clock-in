import type { AddressLookupTableAccount, VersionedTransaction } from '@solana/web3.js'

import type { C3CoreMainnetLegId } from './c3-core-mainnet-core.ts'

export type C3AuthorizationAccount = Readonly<{
  address: string
  isSigner: boolean
  isWritable: boolean
}>

export type C3AuthorizationInstruction = Readonly<{
  index: number
  programId: string
  accounts: readonly C3AuthorizationAccount[]
  dataBase64: string
}>

export type C3AuthorizationLookupTable = Readonly<{
  address: string
  writableIndexes: readonly number[]
  readonlyIndexes: readonly number[]
  addresses: readonly string[]
  loadedWritableAddresses: readonly string[]
  loadedReadonlyAddresses: readonly string[]
}>

export type C3MainnetAuthorizationManifest = Readonly<{
  version: 1
  leg: C3CoreMainnetLegId
  walletAddress: string
  feePayer: string
  requiredSignerAddresses: readonly string[]
  staticAccountKeys: readonly C3AuthorizationAccount[]
  messageHeader: Readonly<{
    numRequiredSignatures: number
    numReadonlySignedAccounts: number
    numReadonlyUnsignedAccounts: number
  }>
  addressLookupTables: readonly C3AuthorizationLookupTable[]
  outerInstructions: readonly C3AuthorizationInstruction[]
  approvedRouteProgramIds: readonly string[]
  jupiterProgramId: string
  inputMint: string
  inputAccount: string
  inputAmountBaseUnits: string
  outputMint: string
  outputDestination: string
  minimumOutputBaseUnits: string
  temporaryWsolAccount?: string
  recentBlockhash: string
  lastValidBlockHeight: number
  minContextSlot: number
  messageFingerprint: string
}>

export async function createC3AuthorizationManifest(input: {
  transaction: VersionedTransaction
  lookupTables: readonly AddressLookupTableAccount[]
  leg: C3CoreMainnetLegId
  walletAddress: string
  inputMint: string
  inputAccount: string
  inputAmountBaseUnits: string
  outputMint: string
  outputDestination: string
  minimumOutputBaseUnits: string
  jupiterProgramId: string
  approvedRouteProgramIds: readonly string[]
  temporaryWsolAccount?: string
  lastValidBlockHeight: number
  minContextSlot: number
}): Promise<C3MainnetAuthorizationManifest> {
  const message = input.transaction.message
  if (message.version !== 0) throw new Error('C3 authorization requires a v0 transaction message.')
  const accountKeys = message.getAccountKeys({ addressLookupTableAccounts: [...input.lookupTables] })
  const staticAccountKeys = message.staticAccountKeys.map((key, index) => ({
    address: key.toBase58(),
    isSigner: index < message.header.numRequiredSignatures,
    isWritable: message.isAccountWritable(index),
  }))
  const outerInstructions = message.compiledInstructions.map((instruction, index) => ({
    index,
    programId: accountKeys.get(instruction.programIdIndex)?.toBase58() ?? '',
    accounts: instruction.accountKeyIndexes.map((accountIndex) => ({
      address: accountKeys.get(accountIndex)?.toBase58() ?? '',
      isSigner: message.isAccountSigner(accountIndex),
      isWritable: message.isAccountWritable(accountIndex),
    })),
    dataBase64: Buffer.from(instruction.data).toString('base64'),
  }))
  const addressLookupTables = input.lookupTables.map((table) => {
    const lookup = message.addressTableLookups.find((candidate) => candidate.accountKey.equals(table.key))
    if (!lookup) throw new Error(`C3 authorization is missing lookup table ${table.key.toBase58()}.`)
    return {
      address: table.key.toBase58(),
      writableIndexes: [...lookup.writableIndexes],
      readonlyIndexes: [...lookup.readonlyIndexes],
      addresses: table.state.addresses.map((address) => address.toBase58()),
      loadedWritableAddresses: lookup.writableIndexes.map((index) => table.state.addresses[index]?.toBase58() ?? ''),
      loadedReadonlyAddresses: lookup.readonlyIndexes.map((index) => table.state.addresses[index]?.toBase58() ?? ''),
    }
  })
  const feePayer = staticAccountKeys[0]?.address ?? ''
  const requiredSignerAddresses = staticAccountKeys
    .filter((account) => account.isSigner)
    .map((account) => account.address)
  const messagePayload = canonicalize({
    version: message.version,
    header: message.header,
    recentBlockhash: message.recentBlockhash,
    staticAccountKeys,
    messageHeader: {
      numRequiredSignatures: message.header.numRequiredSignatures,
      numReadonlySignedAccounts: message.header.numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts: message.header.numReadonlyUnsignedAccounts,
    },
    addressLookupTables,
    outerInstructions,
  })
  return {
    version: 1,
    leg: input.leg,
    walletAddress: input.walletAddress,
    feePayer,
    requiredSignerAddresses,
    staticAccountKeys,
    messageHeader: {
      numRequiredSignatures: message.header.numRequiredSignatures,
      numReadonlySignedAccounts: message.header.numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts: message.header.numReadonlyUnsignedAccounts,
    },
    addressLookupTables,
    outerInstructions,
    approvedRouteProgramIds: [...new Set(input.approvedRouteProgramIds)].sort(),
    jupiterProgramId: input.jupiterProgramId,
    inputMint: input.inputMint,
    inputAccount: input.inputAccount,
    inputAmountBaseUnits: input.inputAmountBaseUnits,
    outputMint: input.outputMint,
    outputDestination: input.outputDestination,
    minimumOutputBaseUnits: input.minimumOutputBaseUnits,
    temporaryWsolAccount: input.temporaryWsolAccount,
    recentBlockhash: message.recentBlockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
    minContextSlot: input.minContextSlot,
    messageFingerprint: await sha256Hex(messagePayload),
  }
}

export function fingerprintC3AuthorizationMessage(input: {
  version: number
  header: unknown
  recentBlockhash: string
  staticAccountKeys: readonly C3AuthorizationAccount[]
  messageHeader: unknown
  addressLookupTables: readonly C3AuthorizationLookupTable[]
  outerInstructions: readonly C3AuthorizationInstruction[]
}): string {
  return sha256Hex(
    canonicalize({
      version: input.version,
      header: input.header,
      recentBlockhash: input.recentBlockhash,
      staticAccountKeys: input.staticAccountKeys,
      messageHeader: input.messageHeader,
      addressLookupTables: input.addressLookupTables,
      outerInstructions: input.outerInstructions,
    }),
  )
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`
}

function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const words = new Uint32Array(64)
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ]
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const bitLength = bytes.length * 8
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 4, bitLength >>> 0, false)
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false)
  const rotr = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^ (words[index - 15] >>> 3)
      const s1 = rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^ (words[index - 2] >>> 10)
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + choose + constants[index] + words[index]) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('')
}
