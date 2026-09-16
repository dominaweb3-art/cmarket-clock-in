import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js'
import { toUint8Array } from 'js-base64'

import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import type { C3CoreMainnetLegId } from './c3-core-mainnet-core.ts'

export type JupiterInstructionPayload = Readonly<{
  programId: string
  accounts: ReadonlyArray<{
    pubkey: string
    isSigner: boolean
    isWritable: boolean
  }>
  data: string
}>

export type JupiterBuildResponse = Readonly<{
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  slippageBps?: number
  priceImpactPct?: string | null
  taker?: string
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
  routePlan?: ReadonlyArray<{
    swapInfo?: {
      label?: string
      ammKey?: string
      inputMint?: string
      outputMint?: string
      inAmount?: string
      outAmount?: string
    }
  }>
}>

export type C3CoreMainnetValidationContext = Readonly<{
  walletAddress: string
  leg: C3CoreMainnetLegId
  inputAmountBaseUnits: bigint
  build: JupiterBuildResponse
  transaction: VersionedTransaction
  treasuryAddress?: string
}>

export type C3CoreMainnetValidationResult = Readonly<{
  passed: boolean
  expectedOutputDestination: string
  outputDestinationMentions: string[]
  signerAccounts: string[]
  programIds: string[]
  issues: string[]
}>

const PROGRAM_LABELS: Record<string, string> = {
  [C3_CORE_MAINNET_CONFIG.programs.system]: 'System Program',
  [C3_CORE_MAINNET_CONFIG.programs.token]: 'SPL Token Program',
  [C3_CORE_MAINNET_CONFIG.programs.token2022]: 'SPL Token-2022 Program',
  [C3_CORE_MAINNET_CONFIG.programs.associatedToken]: 'Associated Token Program',
  [C3_CORE_MAINNET_CONFIG.programs.computeBudget]: 'Compute Budget Program',
  [C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6]: 'Jupiter Swap Program v6',
}

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

export function validateC3CoreMainnetTransaction(
  context: C3CoreMainnetValidationContext,
): C3CoreMainnetValidationResult {
  const { build, leg, transaction, walletAddress, inputAmountBaseUnits, treasuryAddress } = context
  const instructions = flattenC3BuildInstructions(build)
  const user = new PublicKey(walletAddress)
  const outputMint = new PublicKey(
    leg === 'cbBTC'
      ? C3_CORE_MAINNET_CONFIG.assets.cbBTC
      : leg === 'portalETH'
        ? C3_CORE_MAINNET_CONFIG.assets.portalETH
        : C3_CORE_MAINNET_CONFIG.assets.wSOL,
  )
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
  const issues: string[] = []
  const signerAccounts = unique(
    instructions.flatMap((instruction) =>
      instruction.accounts.filter((account) => account.isSigner).map((account) => account.pubkey),
    ),
  )
  const programIds = unique(instructions.map((instruction) => instruction.programId))
  const outputDestinationMentions = unique(
    instructions
      .flatMap((instruction) => instruction.accounts.map((account) => account.pubkey))
      .filter((account) => account === outputDestination),
  )

  if (build.inputMint !== C3_CORE_MAINNET_CONFIG.assets.input) issues.push(`input mint mismatch: ${build.inputMint}`)
  if (build.outputMint !== outputMint.toBase58()) issues.push(`output mint mismatch: ${build.outputMint}`)
  if (BigInt(build.inAmount) !== inputAmountBaseUnits) issues.push(`input amount mismatch: ${build.inAmount}`)
  if (build.taker && build.taker !== walletAddress) issues.push(`taker mismatch: ${build.taker}`)
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

  const messageAccounts = transaction.message.staticAccountKeys
  const requiredSigners = messageAccounts
    .slice(0, transaction.message.header.numRequiredSignatures)
    .map((key) => key.toBase58())
  if (requiredSigners.length !== 1 || requiredSigners[0] !== walletAddress) {
    issues.push(`compiled required signers are not user-only: ${requiredSigners.join(',')}`)
  }
  if (messageAccounts[0]?.toBase58() !== walletAddress) issues.push('fee payer is not the connected wallet')

  for (const instruction of instructions) {
    const data = toUint8Array(instruction.data)
    if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.system && readU32(data) === 2) {
      if (instruction.accounts[1]?.pubkey !== walletAddress) {
        issues.push(`unexpected top-level SOL transfer destination: ${instruction.accounts[1]?.pubkey ?? 'missing'}`)
      }
    }
    if (
      instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token ||
      instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token2022
    ) {
      const tokenInstruction = data[0]
      if ([4, 5, 6].includes(tokenInstruction))
        issues.push(`prohibited token authority instruction: ${tokenInstruction}`)
      if (tokenInstruction === 9 && leg !== 'SOL') issues.push('unexpected token close-account instruction')
    }
    if (!PROGRAM_LABELS[instruction.programId]) issues.push(`unknown program ID: ${instruction.programId}`)
  }

  return {
    passed: issues.length === 0,
    expectedOutputDestination: outputDestination,
    outputDestinationMentions,
    signerAccounts,
    programIds,
    issues,
  }
}

function readU32(data: Uint8Array): number | null {
  if (data.length < 4) return null
  return data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
