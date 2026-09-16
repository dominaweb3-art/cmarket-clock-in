import { Connection } from '@solana/web3.js'
import bs58 from 'bs58'

import { C3_CORE_MAINNET_ASSETS } from './c3-core-mainnet-core.ts'
import type { C3CoreMainnetLegId } from './c3-core-mainnet-core.ts'

export type C3MainnetTransactionEvidence = Readonly<{
  signature: string
  cluster: 'mainnet-beta' | string
  slot: number
  blockTimeMs?: number | null
  finalized: boolean
  metaErr: unknown | null
  feePayer: string
  signerAddresses: readonly string[]
  jupiterProgramIds: readonly string[]
  unknownProgramIds?: readonly string[]
  input?: Readonly<{ owner: string; mint: string; amountBaseUnits: string }>
  output?: Readonly<{ owner: string; mint: string; amountBaseUnits: string; destination: string }>
  treasuryAddresses: readonly string[]
  lookupTablesValidated: boolean
  effectsComplete: boolean
  unexpectedAuthorityChange?: boolean
  unexpectedDelegateOrApproval?: boolean
  unexpectedLamportRecipients?: readonly string[]
  unexpectedAccountClosure?: boolean
  closedAccount?: string
  closeDestination?: string
  sol?: Readonly<{
    outputLamports: string
    feeLamports: string
    userLamportsReturned: string
  }>
}>

export type C3MainnetLegExpectation = Readonly<{
  signature?: string
  leg: C3CoreMainnetLegId
  walletAddress: string
  inputMint: string
  inputAmountBaseUnits: string
  outputMint: string
  destination: string
  minimumOutputBaseUnits: string
  treasuryAddress?: string
  jupiterProgramId: string
  temporaryWsolAccount?: string
  createdAtMs?: number
  nowMs?: number
}>

export type C3MainnetReconciliationStatus = 'confirmed' | 'failed_on_chain' | 'reconciliation_required'

export type C3MainnetReconciliationResult = Readonly<{
  status: C3MainnetReconciliationStatus
  signature: string
  issues: readonly string[]
  outputAmountBaseUnits?: string
  providerNames?: readonly string[]
}>

export type C3MainnetConfirmationProvider = Readonly<{
  name: string
  cluster: 'mainnet-beta'
  getFinalizedTransaction: (signature: string) => Promise<C3MainnetTransactionEvidence | null>
  getRecentTransactions?: (walletAddress: string, limit: number) => Promise<readonly C3MainnetTransactionEvidence[]>
}>

export function verifyC3MainnetTransactionEvidence(
  evidence: C3MainnetTransactionEvidence,
  expected: C3MainnetLegExpectation,
): C3MainnetReconciliationResult {
  if (!isEvidenceShape(evidence)) {
    return {
      status: 'reconciliation_required',
      signature:
        typeof (evidence as Partial<C3MainnetTransactionEvidence>).signature === 'string'
          ? (evidence as Partial<C3MainnetTransactionEvidence>).signature!
          : '',
      issues: ['confirmation evidence is malformed'],
    }
  }
  const issues: string[] = []
  if (evidence.signature !== expected.signature && expected.signature) issues.push('signature mismatch')
  if (!isCanonicalSignature(evidence.signature)) issues.push('signature is malformed')
  if (evidence.cluster !== 'mainnet-beta') issues.push('transaction cluster is not mainnet-beta')
  if (!Number.isSafeInteger(evidence.slot) || evidence.slot < 0) issues.push('slot is invalid')
  if (!evidence.finalized) issues.push('transaction is not finalized')
  if (!evidence.effectsComplete) issues.push('transaction effects are incomplete')
  if (evidence.feePayer !== expected.walletAddress) issues.push('fee payer is not the connected wallet')
  if (evidence.signerAddresses.length !== 1 || evidence.signerAddresses[0] !== expected.walletAddress) {
    issues.push('required signers are not exactly the connected wallet')
  }
  if (!evidence.jupiterProgramIds.includes(expected.jupiterProgramId))
    issues.push('expected Jupiter program is missing')
  if ((evidence.unknownProgramIds ?? []).length > 0) issues.push('unknown executable program is present')
  if (evidence.treasuryAddresses.length > 0) issues.push('purchased assets or instructions reference the treasury')
  if (evidence.unexpectedAuthorityChange) issues.push('unexpected authority change')
  if (evidence.unexpectedDelegateOrApproval) issues.push('unexpected delegate or token approval')
  if (evidence.unexpectedAccountClosure) issues.push('unexpected account closure')
  if (evidence.closedAccount && evidence.closedAccount !== expected.temporaryWsolAccount)
    issues.push('unexpected closed account')
  if (evidence.closeDestination && evidence.closeDestination !== expected.walletAddress)
    issues.push('account closure refund is not user-only')
  if ((evidence.unexpectedLamportRecipients ?? []).some((address) => address !== expected.walletAddress)) {
    issues.push('unexpected lamport recipient')
  }
  if (!evidence.lookupTablesValidated) issues.push('address lookup tables were not independently validated')

  if (!evidence.input) {
    issues.push('USDC debit evidence is missing')
  } else {
    if (evidence.input.owner !== expected.walletAddress) issues.push('USDC source is not owned by the connected wallet')
    if (evidence.input.mint !== expected.inputMint) issues.push('USDC input mint mismatch')
    if (evidence.input.amountBaseUnits !== expected.inputAmountBaseUnits)
      issues.push('USDC debit is not exactly the approved leg')
  }

  if (evidence.metaErr === null) {
    if (!evidence.output) {
      issues.push('successful transaction has no output evidence')
    } else {
      if (evidence.output.owner !== expected.walletAddress)
        issues.push('output account is not owned by the connected wallet')
      if (evidence.output.destination !== expected.destination) issues.push('output destination mismatch')
      if (evidence.output.mint !== expected.outputMint) issues.push('output mint mismatch')
      if (!isCanonicalBaseUnits(evidence.output.amountBaseUnits)) issues.push('output amount is malformed')
      else if (BigInt(evidence.output.amountBaseUnits) < BigInt(expected.minimumOutputBaseUnits))
        issues.push('output is below the approved minimum')
    }
  } else if (evidence.output && evidence.output.owner !== expected.walletAddress) {
    issues.push('failed transaction exposes a non-user output account')
  }

  if (expected.leg === 'SOL') {
    if (!evidence.sol) {
      issues.push('native SOL accounting evidence is missing')
    } else {
      if (!isCanonicalBaseUnits(evidence.sol.outputLamports)) issues.push('SOL output is malformed')
      if (!isCanonicalBaseUnits(evidence.sol.feeLamports)) issues.push('SOL fee is malformed')
      if (!isCanonicalBaseUnits(evidence.sol.userLamportsReturned)) issues.push('WSOL return accounting is malformed')
      if (
        evidence.metaErr === null &&
        isCanonicalBaseUnits(evidence.sol.outputLamports) &&
        BigInt(evidence.sol.outputLamports) < BigInt(expected.minimumOutputBaseUnits)
      ) {
        issues.push('native SOL output is below the approved minimum')
      }
    }
  }

  if (issues.length > 0) return { status: 'reconciliation_required', signature: evidence.signature, issues }
  return {
    status: evidence.metaErr === null ? 'confirmed' : 'failed_on_chain',
    signature: evidence.signature,
    issues: [],
    outputAmountBaseUnits: evidence.output?.amountBaseUnits ?? evidence.sol?.outputLamports,
  }
}

export async function reconcileC3MainnetSignature(
  providers: readonly C3MainnetConfirmationProvider[],
  signature: string,
  expected: Omit<C3MainnetLegExpectation, 'signature'>,
): Promise<C3MainnetReconciliationResult> {
  if (providers.length < 2 || providers.some((provider) => provider.cluster !== 'mainnet-beta')) {
    return {
      status: 'reconciliation_required',
      signature,
      issues: ['two independent Mainnet confirmation providers are required'],
    }
  }
  const results = await Promise.all(
    providers.map(async (provider) => {
      try {
        return { provider, evidence: await provider.getFinalizedTransaction(signature), error: null as string | null }
      } catch {
        return { provider, evidence: null, error: 'provider request failed' }
      }
    }),
  )
  if (results.some((result) => result.error || !result.evidence)) {
    return {
      status: 'reconciliation_required',
      signature,
      issues: ['confirmation provider returned timeout, malformed data, or no finalized transaction'],
      providerNames: results.map(({ provider }) => provider.name),
    }
  }
  const evidence = results.map((result) => result.evidence as C3MainnetTransactionEvidence)
  if (evidence.some((candidate) => !isEvidenceShape(candidate))) {
    return {
      status: 'reconciliation_required',
      signature,
      issues: ['confirmation provider returned malformed evidence'],
      providerNames: results.map(({ provider }) => provider.name),
    }
  }
  if (evidence.some((candidate) => evidenceFingerprint(candidate) !== evidenceFingerprint(evidence[0]))) {
    return {
      status: 'reconciliation_required',
      signature,
      issues: ['confirmation providers disagree on the transaction or its effects'],
      providerNames: results.map(({ provider }) => provider.name),
    }
  }
  const verified = verifyC3MainnetTransactionEvidence(evidence[0], { ...expected, signature })
  return { ...verified, providerNames: results.map(({ provider }) => provider.name) }
}

export type C3MainnetRecoveryResult = Readonly<{
  status: 'recovered' | 'none' | 'ambiguous' | 'reconciliation_required'
  signature?: string
  candidates: readonly string[]
  issues: readonly string[]
}>

export async function recoverC3MainnetSignature(
  provider: C3MainnetConfirmationProvider,
  expected: Omit<C3MainnetLegExpectation, 'signature'>,
  limit = 20,
): Promise<C3MainnetRecoveryResult> {
  if (!provider.getRecentTransactions)
    return { status: 'reconciliation_required', candidates: [], issues: ['bounded wallet history is unavailable'] }
  let history: readonly C3MainnetTransactionEvidence[]
  try {
    history = await provider.getRecentTransactions(expected.walletAddress, Math.min(Math.max(limit, 1), 20))
  } catch {
    return { status: 'reconciliation_required', candidates: [], issues: ['wallet history request failed'] }
  }
  const candidates = history.filter((evidence) => {
    if (
      expected.createdAtMs !== undefined &&
      expected.nowMs !== undefined &&
      evidence.blockTimeMs !== null &&
      evidence.blockTimeMs !== undefined
    ) {
      const earliest = expected.createdAtMs - 5 * 60_000
      const latest = expected.nowMs + 5 * 60_000
      if (evidence.blockTimeMs < earliest || evidence.blockTimeMs > latest) return false
    }
    return verifyC3MainnetTransactionEvidence(evidence, expected).status !== 'reconciliation_required'
  })
  const signatures = [...new Set(candidates.map((candidate) => candidate.signature))]
  if (signatures.length === 1)
    return { status: 'recovered', signature: signatures[0], candidates: signatures, issues: [] }
  if (signatures.length > 1)
    return {
      status: 'ambiguous',
      candidates: signatures,
      issues: ['multiple matching wallet transactions require explicit review'],
    }
  return { status: 'none', candidates: [], issues: ['no matching wallet transaction was found'] }
}

export function createConnectionConfirmationProvider(
  name: string,
  connection: Connection,
): C3MainnetConfirmationProvider {
  return {
    name,
    cluster: 'mainnet-beta',
    async getFinalizedTransaction(signature) {
      const transaction = await connection.getParsedTransaction(signature, {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      })
      return transaction ? parseConnectionTransaction(signature, transaction) : null
    },
  }
}

function parseConnectionTransaction(signature: string, transaction: any): C3MainnetTransactionEvidence {
  const accountKeys = (transaction.transaction?.message?.accountKeys ?? []).map((account: any) => ({
    address: publicKeyText(account.pubkey),
    signer: Boolean(account.signer ?? account.isSigner),
  }))
  const signerAddresses = accountKeys.filter((account: any) => account.signer).map((account: any) => account.address)
  const feePayer = signerAddresses[0] ?? ''
  const programIds = (transaction.transaction?.message?.instructions ?? [])
    .map((instruction: any) => publicKeyText(instruction.programId))
    .filter((programId: string | null): programId is string => Boolean(programId))
  const preBalances = transaction.meta?.preTokenBalances ?? []
  const postBalances = transaction.meta?.postTokenBalances ?? []
  const wallet = feePayer
  const inputBalance = tokenDelta(preBalances, postBalances, C3_CORE_MAINNET_ASSETS.input, wallet, accountKeys, true)
  const outputBalance = tokenDelta(preBalances, postBalances, C3_CORE_MAINNET_ASSETS.cbBTC, wallet, accountKeys, false)
  return {
    signature,
    cluster: 'mainnet-beta',
    slot: transaction.slot,
    blockTimeMs: typeof transaction.blockTime === 'number' ? transaction.blockTime * 1000 : null,
    finalized: true,
    metaErr: transaction.meta?.err ?? null,
    feePayer,
    signerAddresses,
    jupiterProgramIds: programIds,
    input: inputBalance ?? undefined,
    output: outputBalance ?? undefined,
    treasuryAddresses: [],
    lookupTablesValidated: false,
    effectsComplete: Boolean(transaction.meta && feePayer && programIds.length),
    sol: {
      outputLamports: nativeDelta(transaction, feePayer),
      feeLamports: String(transaction.meta?.fee ?? 0),
      userLamportsReturned: '0',
    },
  }
}

function tokenDelta(pre: any[], post: any[], mint: string, owner: string, accountKeys: any[], input: boolean) {
  const entries = [...pre, ...post].filter((entry: any) => entry.mint === mint && entry.owner === owner)
  if (!entries.length) return null
  const accountIndex = entries[0].accountIndex
  const before = pre.find((entry: any) => entry.accountIndex === accountIndex)?.uiTokenAmount?.amount ?? '0'
  const after = post.find((entry: any) => entry.accountIndex === accountIndex)?.uiTokenAmount?.amount ?? '0'
  const delta = BigInt(after) - BigInt(before)
  const amount = input ? (delta < 0n ? -delta : 0n) : delta > 0n ? delta : 0n
  return { owner, mint, amountBaseUnits: amount.toString(), destination: accountKeys[accountIndex]?.address ?? '' }
}

function nativeDelta(transaction: any, wallet: string): string {
  const index = (transaction.transaction?.message?.accountKeys ?? []).findIndex(
    (account: any) => publicKeyText(account.pubkey) === wallet,
  )
  if (index < 0) return '0'
  const pre = BigInt(transaction.meta?.preBalances?.[index] ?? 0)
  const post = BigInt(transaction.meta?.postBalances?.[index] ?? 0)
  const fee = BigInt(transaction.meta?.fee ?? 0)
  const delta = post - pre + fee
  return (delta > 0n ? delta : 0n).toString()
}

function publicKeyText(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'toBase58' in value && typeof value.toBase58 === 'function') return value.toBase58()
  return null
}

function isCanonicalSignature(value: string): boolean {
  if (value.length < 80 || value.length > 90) return false
  try {
    return bs58.decode(value).length === 64
  } catch {
    return false
  }
}

function isEvidenceShape(value: unknown): value is C3MainnetTransactionEvidence {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<C3MainnetTransactionEvidence>
  return (
    typeof candidate.signature === 'string' &&
    typeof candidate.cluster === 'string' &&
    typeof candidate.slot === 'number' &&
    typeof candidate.finalized === 'boolean' &&
    'metaErr' in candidate &&
    candidate.metaErr !== undefined &&
    typeof candidate.feePayer === 'string' &&
    Array.isArray(candidate.signerAddresses) &&
    Array.isArray(candidate.jupiterProgramIds) &&
    Array.isArray(candidate.treasuryAddresses) &&
    typeof candidate.lookupTablesValidated === 'boolean' &&
    typeof candidate.effectsComplete === 'boolean'
  )
}

function isCanonicalBaseUnits(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/.test(value)
}

function evidenceFingerprint(evidence: C3MainnetTransactionEvidence): string {
  return JSON.stringify({
    signature: evidence.signature,
    cluster: evidence.cluster,
    slot: evidence.slot,
    finalized: evidence.finalized,
    metaErr: evidence.metaErr,
    feePayer: evidence.feePayer,
    signerAddresses: evidence.signerAddresses,
    jupiterProgramIds: evidence.jupiterProgramIds,
    unknownProgramIds: evidence.unknownProgramIds,
    input: evidence.input,
    output: evidence.output,
    treasuryAddresses: evidence.treasuryAddresses,
    lookupTablesValidated: evidence.lookupTablesValidated,
    effectsComplete: evidence.effectsComplete,
    unexpectedAuthorityChange: evidence.unexpectedAuthorityChange,
    unexpectedDelegateOrApproval: evidence.unexpectedDelegateOrApproval,
    unexpectedLamportRecipients: evidence.unexpectedLamportRecipients,
    unexpectedAccountClosure: evidence.unexpectedAccountClosure,
    closedAccount: evidence.closedAccount,
    closeDestination: evidence.closeDestination,
    sol: evidence.sol,
  })
}
