import { AddressLookupTableAccount, PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js'
import { toUint8Array } from 'js-base64'

import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import type { C3CoreMainnetLegId } from './c3-core-mainnet-core.ts'
import { getAssociatedTokenAddressSync } from '../utils/spl-token-compatible.ts'

export type JupiterInstructionPayload = Readonly<{
  programId: string
  accounts: ReadonlyArray<{
    pubkey: string
    isSigner: boolean
    isWritable: boolean
  }>
  data: string
}>

export type JupiterRoutePlanItem = Readonly<{
  percent?: number
  bps?: number
  swapInfo?: {
    label?: string
    ammKey?: string
    programId?: string
    inputMint?: string
    outputMint?: string
    inAmount?: string
    outAmount?: string
  }
}>

export type JupiterBuildResponse = Readonly<{
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: 'ExactIn' | string
  slippageBps: number
  taker: string
  priceImpactPct?: string | null
  blockhashWithMetadata: {
    blockhash: string | number[]
    lastValidBlockHeight: number
  }
  computeBudgetInstructions?: JupiterInstructionPayload[]
  setupInstructions?: JupiterInstructionPayload[]
  otherInstructions?: JupiterInstructionPayload[]
  swapInstruction: JupiterInstructionPayload
  cleanupInstruction?: JupiterInstructionPayload
  tipInstruction?: JupiterInstructionPayload
  addressesByLookupTableAddress?: Record<string, string[]>
  prioritizationFeeLamports?: unknown
  platformFee?: unknown
  routePlan: ReadonlyArray<JupiterRoutePlanItem>
  approvedRouteProgramIds?: readonly string[]
}>

export type C3CoreMainnetValidationContext = Readonly<{
  walletAddress: string
  leg: C3CoreMainnetLegId
  inputAmountBaseUnits: bigint
  build: JupiterBuildResponse
  transaction: VersionedTransaction
  treasuryAddress?: string
  lookupTables?: ReadonlyArray<AddressLookupTableAccount>
}>

export type C3CoreMainnetValidationResult = Readonly<{
  passed: boolean
  expectedOutputDestination: string
  outputDestinationMentions: string[]
  signerAccounts: string[]
  programIds: string[]
  approvedRouteProgramIds: string[]
  issues: string[]
}>

export class C3TransactionSizeError extends Error {
  readonly code = 'c3_route_too_large' as const
  readonly estimatedBytes: number
  readonly serializationOverflow: boolean

  constructor(estimatedBytes: number, serializationOverflow = false) {
    super(`C3 Mainnet route exceeds the ${C3_CORE_MAINNET_CONFIG.policy.maxTransactionBytes}-byte packet limit.`)
    this.name = 'C3TransactionSizeError'
    this.estimatedBytes = estimatedBytes
    this.serializationOverflow = serializationOverflow
  }
}

export const C3_MAINNET_ROUTE_ACCOUNT_LIMITS = [64, 48, 32] as const

export function estimateC3VersionedTransactionBytes(transaction: VersionedTransaction): number {
  const message = transaction.message
  if (message.version !== 0) throw new Error('C3 Mainnet transactions must use versioned message v0.')
  const shortVectorBytes = (value: number) => {
    let remaining = value
    let bytes = 0
    do {
      remaining >>= 7
      bytes += 1
    } while (remaining > 0)
    return bytes
  }
  const instructionBytes = message.compiledInstructions.reduce(
    (total, instruction) =>
      total +
      1 +
      shortVectorBytes(instruction.accountKeyIndexes.length) +
      instruction.accountKeyIndexes.length +
      shortVectorBytes(instruction.data.length) +
      instruction.data.length,
    0,
  )
  const lookupBytes = message.addressTableLookups.reduce(
    (total, lookup) =>
      total +
      32 +
      shortVectorBytes(lookup.writableIndexes.length) +
      lookup.writableIndexes.length +
      shortVectorBytes(lookup.readonlyIndexes.length) +
      lookup.readonlyIndexes.length,
    0,
  )
  const messageBytes =
    1 +
    3 +
    shortVectorBytes(message.staticAccountKeys.length) +
    message.staticAccountKeys.length * 32 +
    32 +
    shortVectorBytes(message.compiledInstructions.length) +
    instructionBytes +
    shortVectorBytes(message.addressTableLookups.length) +
    lookupBytes
  const signatureCount = transaction.signatures.length
  return shortVectorBytes(signatureCount) + signatureCount * 64 + messageBytes
}

export function assertC3VersionedTransactionFits(transaction: VersionedTransaction): number {
  const estimatedBytes = estimateC3VersionedTransactionBytes(transaction)
  if (estimatedBytes > C3_CORE_MAINNET_CONFIG.policy.maxTransactionBytes) {
    throw new C3TransactionSizeError(estimatedBytes)
  }
  try {
    const serializedBytes = transaction.serialize().length
    if (serializedBytes > C3_CORE_MAINNET_CONFIG.policy.maxTransactionBytes) {
      throw new C3TransactionSizeError(serializedBytes)
    }
    return serializedBytes
  } catch (error) {
    if (error instanceof C3TransactionSizeError) throw error
    if (error instanceof Error && /encoding overruns Uint8Array|encoding overruns/i.test(error.message)) {
      throw new C3TransactionSizeError(estimatedBytes, true)
    }
    throw error
  }
}

const JUPITER_ROUTE_V2_DISCRIMINATOR = [187, 100, 250, 204, 49, 196, 175, 20]
const JUPITER_SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR = [209, 152, 83, 147, 124, 254, 216, 233]
const JUPITER_EVENT_AUTHORITY = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'
// Reviewed fixed-layout Swap discriminants observed in the current Jupiter V2
// build responses. Any variant with additional payload bytes is rejected until
// its authoritative layout is reviewed and added explicitly.
const APPROVED_FIXED_LAYOUT_SWAP_VARIANTS = new Set([161, 407, 421])
const MAX_COMPUTE_UNITS = 1_400_000
const MAX_PRIORITY_FEE_MICROLAMPORTS = 1_000_000

const PROGRAM_LABELS: Record<string, string> = Object.freeze({
  [C3_CORE_MAINNET_CONFIG.programs.system]: 'System Program',
  [C3_CORE_MAINNET_CONFIG.programs.token]: 'SPL Token Program',
  [C3_CORE_MAINNET_CONFIG.programs.token2022]: 'SPL Token-2022 Program',
  [C3_CORE_MAINNET_CONFIG.programs.associatedToken]: 'Associated Token Program',
  [C3_CORE_MAINNET_CONFIG.programs.computeBudget]: 'Compute Budget Program',
  [C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6]: 'Jupiter Swap Program v6',
  [C3_CORE_MAINNET_CONFIG.programs.addressLookupTable]: 'Address Lookup Table Program',
})

const EXECUTABLE_PROGRAMS = new Set<string>([
  C3_CORE_MAINNET_CONFIG.programs.system,
  C3_CORE_MAINNET_CONFIG.programs.token,
  C3_CORE_MAINNET_CONFIG.programs.associatedToken,
  C3_CORE_MAINNET_CONFIG.programs.computeBudget,
  C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6,
])

export function flattenC3BuildInstructions(build: JupiterBuildResponse): JupiterInstructionPayload[] {
  return [
    ...(build.computeBudgetInstructions ?? []),
    ...(build.setupInstructions ?? []),
    ...(build.otherInstructions ?? []),
    build.swapInstruction,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ...(build.tipInstruction ? [build.tipInstruction] : []),
  ]
}

export function toC3TransactionInstruction(payload: JupiterInstructionPayload): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(payload.programId),
    keys: payload.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(toUint8Array(payload.data)),
  })
}

export function getC3ProgramLabels(): Readonly<Record<string, string>> {
  return PROGRAM_LABELS
}

export function decodeC3Blockhash(value: string | number[]): string {
  try {
    const bytes = Array.isArray(value) ? value : undefined
    if (bytes && (bytes.length !== 32 || bytes.some((item) => !Number.isInteger(item) || item < 0 || item > 255))) {
      throw new Error('blockhash byte array must contain exactly 32 bytes')
    }
    return new PublicKey(bytes ? Uint8Array.from(bytes) : value).toBase58()
  } catch {
    throw new Error('Jupiter returned an invalid blockhash.')
  }
}

export function getC3JupiterSourceTokenAccount(build: JupiterBuildResponse): string {
  const data = toUint8Array(build.swapInstruction.data)
  if (sameBytes(data.slice(0, 8), JUPITER_ROUTE_V2_DISCRIMINATOR)) {
    return requireAccount(build.swapInstruction, 1, 'Jupiter source token account').pubkey
  }
  if (sameBytes(data.slice(0, 8), JUPITER_SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR)) {
    return requireAccount(build.swapInstruction, 2, 'Jupiter source token account').pubkey
  }
  throw new Error('Unsupported Jupiter V2 instruction discriminator.')
}

export function validateC3AddressLookupTables(
  transaction: VersionedTransaction,
  lookupTables: ReadonlyArray<AddressLookupTableAccount> = [],
): string[] {
  const issues: string[] = []
  if (transaction.message.version !== 0) {
    issues.push('Mainnet C3 transactions must use versioned message v0.')
    return issues
  }

  const tableByAddress = new Map(lookupTables.map((table) => [table.key.toBase58(), table]))
  for (const lookup of transaction.message.addressTableLookups) {
    const table = tableByAddress.get(lookup.accountKey.toBase58())
    if (!table) {
      issues.push(`address lookup table was not resolved: ${lookup.accountKey.toBase58()}`)
      continue
    }
    const indexes = [...lookup.writableIndexes, ...lookup.readonlyIndexes]
    if (new Set(indexes).size !== indexes.length)
      issues.push(`address lookup indexes repeat: ${lookup.accountKey.toBase58()}`)
    for (const index of indexes) {
      if (index >= table.state.addresses.length) {
        issues.push(`address lookup index is outside the fetched table: ${lookup.accountKey.toBase58()}:${index}`)
      }
    }
  }
  return issues
}

export function validateC3AddressLookupTableRecord(
  table: AddressLookupTableAccount,
  expectedAddress: string,
  currentSlot: number,
): string[] {
  const issues: string[] = []
  if (table.key.toBase58() !== expectedAddress) issues.push('address lookup table key does not match the build')
  if (!table.isActive()) issues.push('address lookup table is deactivated')
  if (table.state.lastExtendedSlot > currentSlot)
    issues.push('address lookup table was extended beyond the current slot')
  return issues
}

export function validateC3CoreMainnetTransaction(
  context: C3CoreMainnetValidationContext,
): C3CoreMainnetValidationResult {
  const { build, leg, transaction, walletAddress, inputAmountBaseUnits, treasuryAddress } = context
  const issues: string[] = []
  const instructions = flattenC3BuildInstructions(build)
  let user: PublicKey
  try {
    user = new PublicKey(walletAddress)
  } catch {
    user = PublicKey.default
    issues.push('connected wallet address is invalid')
  }

  const outputMintString =
    leg === 'cbBTC'
      ? C3_CORE_MAINNET_CONFIG.assets.cbBTC
      : leg === 'portalETH'
        ? C3_CORE_MAINNET_CONFIG.assets.portalETH
        : C3_CORE_MAINNET_CONFIG.assets.wSOL
  const outputMint = new PublicKey(outputMintString)
  const outputDestination =
    leg === 'SOL'
      ? walletAddress
      : getAssociatedTokenAddressSync(
          outputMint,
          user,
          false,
          new PublicKey(C3_CORE_MAINNET_CONFIG.programs.token),
          new PublicKey(C3_CORE_MAINNET_CONFIG.programs.associatedToken),
        ).toBase58()
  const expectedWsolAccount = getAssociatedTokenAddressSync(
    new PublicKey(C3_CORE_MAINNET_CONFIG.assets.wSOL),
    user,
    false,
    new PublicKey(C3_CORE_MAINNET_CONFIG.programs.token),
    new PublicKey(C3_CORE_MAINNET_CONFIG.programs.associatedToken),
  ).toBase58()

  validateBuildMetadata(build, leg, walletAddress, inputAmountBaseUnits, outputMintString, issues)

  const decodedInstructions: Array<Uint8Array | null> = []
  for (const instruction of instructions) {
    try {
      decodedInstructions.push(toUint8Array(instruction.data))
    } catch {
      decodedInstructions.push(null)
      issues.push(`invalid base64 instruction data for ${instruction.programId}`)
    }
  }

  const signerAccounts = unique(
    instructions.flatMap((instruction) =>
      instruction.accounts.filter((account) => account.isSigner).map((account) => account.pubkey),
    ),
  )
  const programIds = unique(instructions.map((instruction) => instruction.programId))
  const approvedRouteProgramIds = unique([
    ...(build.approvedRouteProgramIds ?? []),
    ...(build.routePlan ?? []).map((route) => route.swapInfo?.programId ?? '').filter(Boolean),
  ])
  for (const programId of approvedRouteProgramIds) {
    if (!isCanonicalPublicKey(programId)) issues.push(`approved route program ID is invalid: ${programId}`)
  }
  if (approvedRouteProgramIds.length === 0) issues.push('approved route program registry is missing')
  const outputDestinationMentions = unique(
    instructions
      .flatMap((instruction) => instruction.accounts.map((account) => account.pubkey))
      .filter((account) => account === outputDestination),
  )

  if (!outputDestinationMentions.length) issues.push(`expected output destination not present: ${outputDestination}`)
  if (
    treasuryAddress &&
    instructions.some((instruction) => instruction.accounts.some((account) => account.pubkey === treasuryAddress))
  ) {
    issues.push('configured treasury appears in a Mainnet build')
  }
  if (signerAccounts.some((account) => account !== walletAddress)) {
    issues.push(`unexpected signer account: ${signerAccounts.join(',')}`)
  }

  if (transaction.message.version !== 0) issues.push('compiled transaction is not a v0 message')
  const messageAccounts = transaction.message.staticAccountKeys
  const requiredSigners = messageAccounts
    .slice(0, transaction.message.header.numRequiredSignatures)
    .map((key) => key.toBase58())
  if (requiredSigners.length !== 1 || requiredSigners[0] !== walletAddress) {
    issues.push(`compiled required signers are not user-only: ${requiredSigners.join(',')}`)
  }
  if (messageAccounts[0]?.toBase58() !== walletAddress) issues.push('fee payer is not the connected wallet')
  issues.push(...validateC3AddressLookupTables(transaction, context.lookupTables))

  let accountKeys: ReturnType<VersionedTransaction['message']['getAccountKeys']> | undefined
  try {
    accountKeys = transaction.message.getAccountKeys({ addressLookupTableAccounts: [...(context.lookupTables ?? [])] })
  } catch {
    issues.push('compiled address lookup tables could not be resolved')
  }
  compareCompiledInstructions(transaction, instructions, accountKeys, issues)

  let sawCleanup = false
  let sawWsolSetup = false
  let computeLimitSeen = false
  let computePriceSeen = false
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index]
    const data = decodedInstructions[index]
    if (!data) continue
    if (!EXECUTABLE_PROGRAMS.has(instruction.programId)) {
      issues.push(`unknown or unsupported executable program ID: ${instruction.programId}`)
      continue
    }

    if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6) {
      if (instruction !== build.swapInstruction) {
        issues.push('only the designated Jupiter swap instruction is permitted')
      } else {
        validateJupiterInstruction(
          instruction,
          data,
          build,
          leg,
          walletAddress,
          outputDestination,
          expectedWsolAccount,
          issues,
        )
      }
      continue
    }

    if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.computeBudget) {
      if (data[0] === 2 && data.length === 5) {
        if (computeLimitSeen || readU32(data, 1) > MAX_COMPUTE_UNITS)
          issues.push('invalid or repeated compute-unit limit')
        computeLimitSeen = true
      } else if (data[0] === 3 && data.length === 9) {
        if (computePriceSeen || readU64(data, 1) > BigInt(MAX_PRIORITY_FEE_MICROLAMPORTS))
          issues.push('invalid or repeated compute-unit price')
        computePriceSeen = true
      } else {
        issues.push('unsupported compute-budget instruction')
      }
      continue
    }

    if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.associatedToken) {
      const expectedMint = leg === 'SOL' ? C3_CORE_MAINNET_CONFIG.assets.wSOL : outputMintString
      const expectedAta = leg === 'SOL' ? expectedWsolAccount : outputDestination
      if (!validateAssociatedTokenInstruction(instruction, data, walletAddress, expectedAta, expectedMint, issues))
        continue
      if (leg === 'SOL') sawWsolSetup = true
      continue
    }

    if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.system) {
      validateSystemInstruction(instruction, data, walletAddress, expectedWsolAccount, build.outAmount, leg, issues)
      continue
    }

    if (
      instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token ||
      instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token2022
    ) {
      if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token2022) {
        issues.push('Token-2022 instructions are not enabled for the approved C3 assets')
      }
      if (data[0] === 9 && instruction === build.cleanupInstruction) {
        if (leg !== 'SOL') issues.push('unexpected token close-account instruction')
        else if (validateWsolCleanup(instruction, data, walletAddress, expectedWsolAccount, issues)) sawCleanup = true
      } else if (data[0] === 17) {
        if (leg !== 'SOL' || data.length !== 1 || instruction.accounts.length !== 1) {
          issues.push('unexpected WSOL sync instruction')
        } else {
          requireMeta(instruction, 0, expectedWsolAccount, false, true, 'WSOL sync account', issues)
        }
      } else {
        issues.push(`unsupported top-level token instruction: ${data[0] ?? 'missing'}`)
      }
    }
  }

  if (leg === 'SOL' && build.cleanupInstruction && !sawCleanup) issues.push('WSOL cleanup was not validated')
  if (leg === 'SOL' && build.setupInstructions?.length && !sawWsolSetup) {
    issues.push('SOL setup did not create the expected user WSOL account')
  }
  if (build.tipInstruction) issues.push('Jupiter tip instructions are not enabled for C3')

  return {
    passed: issues.length === 0,
    expectedOutputDestination: outputDestination,
    outputDestinationMentions,
    signerAccounts,
    programIds,
    approvedRouteProgramIds,
    issues,
  }
}

function validateBuildMetadata(
  build: JupiterBuildResponse,
  leg: C3CoreMainnetLegId,
  walletAddress: string,
  inputAmountBaseUnits: bigint,
  outputMint: string,
  issues: string[],
) {
  if (build.inputMint !== C3_CORE_MAINNET_CONFIG.assets.input) issues.push(`input mint mismatch: ${build.inputMint}`)
  if (build.outputMint !== outputMint) issues.push(`output mint mismatch: ${build.outputMint}`)
  if (parseUint(build.inAmount, 'build input amount', issues) !== inputAmountBaseUnits)
    issues.push(`input amount mismatch: ${build.inAmount}`)
  const quotedOutput = parseUint(build.outAmount, 'quoted output amount', issues)
  const minimumOutput = parseUint(build.otherAmountThreshold, 'minimum output amount', issues)
  if (quotedOutput === null || quotedOutput === 0n) issues.push('quoted output must be positive')
  if (minimumOutput === null || minimumOutput === 0n || (quotedOutput !== null && minimumOutput > quotedOutput))
    issues.push('minimum output is inconsistent with the quote')
  if (build.taker !== walletAddress) issues.push(`taker mismatch: ${build.taker ?? 'missing'}`)
  if (build.swapMode !== 'ExactIn') issues.push(`unsupported swap mode: ${build.swapMode ?? 'missing'}`)
  if (!Number.isSafeInteger(build.slippageBps) || build.slippageBps < 0 || build.slippageBps > 100) {
    issues.push('slippage is missing or exceeds the 100 bps policy')
  }
  try {
    decodeC3Blockhash(build.blockhashWithMetadata.blockhash)
  } catch {
    issues.push('build blockhash is invalid')
  }
  if (
    !Number.isSafeInteger(build.blockhashWithMetadata.lastValidBlockHeight) ||
    build.blockhashWithMetadata.lastValidBlockHeight <= 0
  ) {
    issues.push('build lastValidBlockHeight is invalid')
  }
  if (!Array.isArray(build.routePlan) || build.routePlan.length === 0) {
    issues.push('Jupiter routePlan is missing or empty')
    return
  }

  const balances = new Map<string, bigint>([[C3_CORE_MAINNET_CONFIG.assets.input, inputAmountBaseUnits]])
  const swapAccountKeys = new Set(build.swapInstruction.accounts.map((account) => account.pubkey))
  for (const [index, item] of build.routePlan.entries()) {
    const swap = item?.swapInfo
    if (!swap) {
      issues.push(`routePlan item ${index} is missing swapInfo`)
      continue
    }
    const inputMint = requireRouteString(swap.inputMint, `route ${index} input mint`, issues)
    const routeOutputMint = requireRouteString(swap.outputMint, `route ${index} output mint`, issues)
    const ammKey = requireRouteString(swap.ammKey, `route ${index} AMM account`, issues)
    const routeInput = parseUint(swap.inAmount, `route ${index} input amount`, issues)
    const routeOutput = parseUint(swap.outAmount, `route ${index} output amount`, issues)
    if (ammKey && !swapAccountKeys.has(ammKey))
      issues.push(`route ${index} AMM account is absent from the Jupiter instruction`)
    if (
      !inputMint ||
      !routeOutputMint ||
      routeInput === null ||
      routeOutput === null ||
      routeInput === 0n ||
      routeOutput === 0n
    )
      continue
    const available = balances.get(inputMint) ?? 0n
    if (available < routeInput) issues.push(`route ${index} consumes more than the approved input`)
    else balances.set(inputMint, available - routeInput)
    balances.set(routeOutputMint, (balances.get(routeOutputMint) ?? 0n) + routeOutput)
    if (typeof item.bps === 'number' && (!Number.isSafeInteger(item.bps) || item.bps < 0 || item.bps > 10_000))
      issues.push(`route ${index} has invalid bps`)
    if (typeof item.percent === 'number' && (!Number.isFinite(item.percent) || item.percent < 0 || item.percent > 100))
      issues.push(`route ${index} has invalid percentage`)
  }
  if ((balances.get(C3_CORE_MAINNET_CONFIG.assets.input) ?? 0n) !== 0n)
    issues.push('routePlan does not consume the complete approved USDC leg')
  if ((balances.get(outputMint) ?? 0n) !== quotedOutput) issues.push('routePlan output does not match quoted output')
  for (const [mint, amount] of balances) {
    if (mint !== outputMint && amount !== 0n) issues.push(`routePlan leaves an unexpected asset balance: ${mint}`)
  }
  if (leg === 'SOL' && outputMint !== C3_CORE_MAINNET_CONFIG.assets.wSOL)
    issues.push('SOL leg must quote WSOL internally')
}

function validateJupiterInstruction(
  instruction: JupiterInstructionPayload,
  data: Uint8Array,
  build: JupiterBuildResponse,
  leg: C3CoreMainnetLegId,
  walletAddress: string,
  outputDestination: string,
  expectedWsolAccount: string,
  issues: string[],
) {
  const routePlan = build.routePlan
  const header = data.slice(0, 8)
  const isRouteV2 = sameBytes(header, JUPITER_ROUTE_V2_DISCRIMINATOR)
  const isSharedRouteV2 = sameBytes(header, JUPITER_SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR)
  if (!isRouteV2 && !isSharedRouteV2) {
    issues.push('unsupported Jupiter instruction discriminator')
    return
  }

  if (isRouteV2) {
    if (instruction.accounts.length < 10) {
      issues.push('Jupiter routeV2 has incomplete accounts')
      return
    }
    requireMeta(instruction, 0, walletAddress, true, false, 'route user', issues)
    requireMeta(instruction, 1, undefined, false, true, 'route source', issues)
    requireMeta(instruction, 2, outputDestination, false, true, 'route destination', issues)
    requireMeta(instruction, 3, C3_CORE_MAINNET_CONFIG.assets.input, false, false, 'route input mint', issues)
    requireMeta(instruction, 4, build.outputMint, false, false, 'route output mint', issues)
    requireTokenProgramMeta(instruction, 5, 'route source token program', issues)
    requireTokenProgramMeta(instruction, 6, 'route destination token program', issues)
    const optionalDestination = instruction.accounts[7]
    if (optionalDestination.pubkey === C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6) {
      requireMeta(instruction, 7, optionalDestination.pubkey, false, false, 'route optional sentinel', issues)
    } else {
      requireMeta(instruction, 7, outputDestination, false, true, 'route optional destination', issues)
    }
    requireMeta(instruction, 8, JUPITER_EVENT_AUTHORITY, false, false, 'route event authority', issues)
    requireMeta(instruction, 9, C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6, false, false, 'route program', issues)
    if (leg === 'SOL' && !instruction.accounts.some((account) => account.pubkey === expectedWsolAccount))
      issues.push('SOL Jupiter route does not reference the expected temporary WSOL account')
    validateJupiterV2Data(data, routePlan, build, issues)
    return
  }

  if (instruction.accounts.length < 12) {
    issues.push('Jupiter sharedAccountsRouteV2 has incomplete accounts')
    return
  }
  requireMeta(instruction, 0, undefined, false, false, 'shared program authority', issues)
  requireMeta(instruction, 1, walletAddress, true, false, 'shared route user', issues)
  requireMeta(instruction, 2, undefined, false, true, 'shared source', issues)
  requireMeta(instruction, 3, undefined, false, true, 'shared program source', issues)
  requireMeta(instruction, 4, undefined, false, true, 'shared program destination', issues)
  requireMeta(instruction, 5, outputDestination, false, true, 'shared destination', issues)
  requireMeta(instruction, 6, C3_CORE_MAINNET_CONFIG.assets.input, false, false, 'shared input mint', issues)
  requireMeta(instruction, 7, build.outputMint, false, false, 'shared output mint', issues)
  requireTokenProgramMeta(instruction, 8, 'shared source token program', issues)
  requireTokenProgramMeta(instruction, 9, 'shared destination token program', issues)
  requireMeta(instruction, 10, JUPITER_EVENT_AUTHORITY, false, false, 'shared event authority', issues)
  requireMeta(
    instruction,
    11,
    C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6,
    false,
    false,
    'shared route program',
    issues,
  )
  if (
    leg === 'SOL' &&
    outputDestination === walletAddress &&
    !instruction.accounts.some((account) => account.pubkey === walletAddress)
  )
    issues.push('SOL Jupiter route does not reference the native user destination')
  validateJupiterV2Data(data, routePlan, build, issues)
}

function validateJupiterV2Data(
  data: Uint8Array,
  routePlan: ReadonlyArray<JupiterRoutePlanItem>,
  build: JupiterBuildResponse,
  issues: string[],
) {
  const isShared = sameBytes(data.slice(0, 8), JUPITER_SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR)
  const routeCountOffset = isShared ? 31 : 30
  const minimumLength = routeCountOffset + 4
  if (data.length < minimumLength) {
    issues.push('Jupiter V2 data is truncated')
    return
  }
  const inOffset = isShared ? 9 : 8
  const quotedOffset = inOffset + 8
  const slippageOffset = quotedOffset + 8
  const platformOffset = slippageOffset + 2
  const positiveSlippageOffset = platformOffset + 2
  const routeCount = readU32(data, routeCountOffset)
  if (routeCount !== routePlan.length) issues.push(`Jupiter instruction route count mismatch: ${routeCount}`)
  if (readU64(data, inOffset) !== parseUint(build.inAmount, 'build input amount', issues))
    issues.push('Jupiter instruction input amount mismatch')
  if (readU64(data, quotedOffset) !== parseUint(build.outAmount, 'build output amount', issues))
    issues.push('Jupiter instruction quoted output mismatch')
  if (readU16(data, slippageOffset) !== build.slippageBps) issues.push('Jupiter instruction slippage mismatch')
  if (readU16(data, platformOffset) !== 0 || readU16(data, positiveSlippageOffset) !== 0)
    issues.push('Jupiter instruction contains an unsupported platform or positive-slippage fee')

  const stepsOffset = routeCountOffset + 4
  const fixedStepLength = 6
  if (data.length !== stepsOffset + routeCount * fixedStepLength) {
    issues.push('unsupported Jupiter RoutePlanStepV2 variant payload; route is rejected conservatively')
    return
  }
  for (let index = 0; index < routeCount; index += 1) {
    const offset = stepsOffset + index * fixedStepLength
    const swapVariant = readU16(data, offset)
    const bps = readU16(data, offset + 2)
    if (!APPROVED_FIXED_LAYOUT_SWAP_VARIANTS.has(swapVariant))
      issues.push(`unsupported Jupiter route step variant: ${swapVariant}`)
    if (bps > 10_000) issues.push(`Jupiter route step ${index} has invalid bps`)
    if (data[offset + 4] > 3 || data[offset + 5] > 3)
      issues.push(`Jupiter route step ${index} has invalid token indexes`)
    const expectedBps = routePlan[index]?.bps
    if (typeof expectedBps === 'number' && bps !== expectedBps) issues.push(`Jupiter route step ${index} bps mismatch`)
  }
}

function validateAssociatedTokenInstruction(
  instruction: JupiterInstructionPayload,
  data: Uint8Array,
  walletAddress: string,
  expectedAta: string,
  expectedMint: string,
  issues: string[],
): boolean {
  if ((data[0] !== 0 && data[0] !== 1) || data.length !== 1 || instruction.accounts.length !== 6) {
    issues.push('unsupported associated-token-account instruction')
    return false
  }
  requireMeta(instruction, 0, walletAddress, true, true, 'ATA payer', issues)
  requireMeta(instruction, 1, expectedAta, false, true, 'ATA address', issues)
  requireMeta(instruction, 2, walletAddress, false, false, 'ATA owner', issues)
  requireMeta(instruction, 3, expectedMint, false, false, 'ATA mint', issues)
  requireMeta(instruction, 4, C3_CORE_MAINNET_CONFIG.programs.system, false, false, 'ATA system program', issues)
  requireMeta(instruction, 5, C3_CORE_MAINNET_CONFIG.programs.token, false, false, 'ATA token program', issues)
  return true
}

function validateSystemInstruction(
  instruction: JupiterInstructionPayload,
  data: Uint8Array,
  walletAddress: string,
  expectedWsolAccount: string,
  quotedOutput: string,
  leg: C3CoreMainnetLegId,
  issues: string[],
) {
  if (data.length !== 12 || readU32(data, 0) !== 2 || instruction.accounts.length !== 2) {
    issues.push('unsupported top-level System instruction')
    return
  }
  if (leg !== 'SOL') {
    issues.push('unexpected System transfer outside the SOL leg')
    return
  }
  requireMeta(instruction, 0, walletAddress, true, true, 'WSOL funding source', issues)
  requireMeta(instruction, 1, expectedWsolAccount, false, true, 'WSOL funding destination', issues)
  const fundingAmount = readU64(data, 4)
  if (fundingAmount === 0n) issues.push('WSOL funding amount must be positive')
  const outputAmount = parseUint(quotedOutput, 'quoted output amount', issues)
  if (outputAmount !== null && fundingAmount > outputAmount) issues.push('WSOL funding exceeds the quoted SOL output')
}

function validateWsolCleanup(
  instruction: JupiterInstructionPayload,
  data: Uint8Array,
  walletAddress: string,
  expectedWsolAccount: string,
  issues: string[],
): boolean {
  if (data.length !== 1 || instruction.accounts.length !== 3) {
    issues.push('WSOL cleanup has an invalid shape')
    return false
  }
  requireMeta(instruction, 0, expectedWsolAccount, false, true, 'WSOL cleanup account', issues)
  requireMeta(instruction, 1, walletAddress, false, true, 'WSOL refund destination', issues)
  requireMeta(instruction, 2, walletAddress, true, false, 'WSOL cleanup authority', issues)
  return true
}

function compareCompiledInstructions(
  transaction: VersionedTransaction,
  rawInstructions: ReadonlyArray<JupiterInstructionPayload>,
  accountKeys: ReturnType<VersionedTransaction['message']['getAccountKeys']> | undefined,
  issues: string[],
) {
  const compiled = transaction.message.compiledInstructions
  if (compiled.length !== rawInstructions.length) {
    issues.push('compiled instruction count does not match the Jupiter build')
    return
  }
  if (!accountKeys) return
  for (const [index, raw] of rawInstructions.entries()) {
    const compiledInstruction = compiled[index]
    const compiledProgram = accountKeys.get(compiledInstruction.programIdIndex)?.toBase58()
    if (compiledProgram !== raw.programId) issues.push(`compiled program mismatch at instruction ${index}`)
    const rawData = toUint8Array(raw.data)
    if (!sameBytes(compiledInstruction.data, rawData)) issues.push(`compiled data mismatch at instruction ${index}`)
    if (compiledInstruction.accountKeyIndexes.length !== raw.accounts.length) {
      issues.push(`compiled account count mismatch at instruction ${index}`)
      continue
    }
    for (const [accountIndex, rawAccount] of raw.accounts.entries()) {
      const keyIndex = compiledInstruction.accountKeyIndexes[accountIndex]
      const compiledAccount = accountKeys.get(keyIndex)
      if (!compiledAccount || compiledAccount.toBase58() !== rawAccount.pubkey) {
        issues.push(`compiled account mismatch at instruction ${index}:${accountIndex}`)
        continue
      }
      if (rawAccount.isSigner && !transaction.message.isAccountSigner(keyIndex))
        issues.push(`compiled signer flag mismatch at instruction ${index}:${accountIndex}`)
      if (rawAccount.isWritable && !transaction.message.isAccountWritable(keyIndex))
        issues.push(`compiled writable flag mismatch at instruction ${index}:${accountIndex}`)
    }
  }
}

function requireTokenProgramMeta(
  instruction: JupiterInstructionPayload,
  index: number,
  label: string,
  issues: string[],
) {
  requireMeta(instruction, index, C3_CORE_MAINNET_CONFIG.programs.token, false, false, label, issues)
}

function requireMeta(
  instruction: JupiterInstructionPayload,
  index: number,
  expectedPubkey: string | undefined,
  expectedSigner: boolean,
  expectedWritable: boolean,
  label: string,
  issues: string[],
) {
  const account = instruction.accounts[index]
  if (!account) {
    issues.push(`${label} is missing`)
    return
  }
  try {
    new PublicKey(account.pubkey)
  } catch {
    issues.push(`${label} is not a valid public key`)
  }
  if (expectedPubkey && account.pubkey !== expectedPubkey) issues.push(`${label} mismatch: ${account.pubkey}`)
  if (account.isSigner !== expectedSigner) issues.push(`${label} signer flag is unexpected`)
  if (account.isWritable !== expectedWritable) issues.push(`${label} writable flag is unexpected`)
}

function requireAccount(instruction: JupiterInstructionPayload, index: number, label: string) {
  const account = instruction.accounts[index]
  if (!account) throw new Error(`${label} is missing`)
  return account
}

function requireRouteString(value: string | undefined, label: string, issues: string[]): string | null {
  if (!value) {
    issues.push(`${label} is missing`)
    return null
  }
  try {
    new PublicKey(value)
    return value
  } catch {
    issues.push(`${label} is not a valid public key`)
    return null
  }
}

function isCanonicalPublicKey(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value
  } catch {
    return false
  }
}

function parseUint(value: string | undefined, label: string, issues: string[]): bigint | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) {
    issues.push(`${label} is not a canonical unsigned integer`)
    return null
  }
  try {
    return BigInt(value)
  } catch {
    issues.push(`${label} is outside the supported integer range`)
    return null
  }
}

function readU16(data: Uint8Array, offset: number): number {
  return offset + 2 <= data.length ? data[offset] | (data[offset + 1] << 8) : -1
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) return -1
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function readU64(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) return -1n
  let value = 0n
  for (let index = 0; index < 8; index += 1) value |= BigInt(data[offset + index]) << BigInt(index * 8)
  return value
}

function sameBytes(left: Uint8Array, right: number[] | Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
