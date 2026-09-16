import { Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

import { C3_CORE_MAINNET_ASSETS } from './c3-core-mainnet-core.ts'
import type { C3CoreMainnetLegId } from './c3-core-mainnet-core.ts'
import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'

export type C3MainnetAccountKeyEvidence = Readonly<{
  address: string
  isSigner: boolean
  isWritable: boolean
  source: 'transaction' | 'lookupTable'
}>

export type C3MainnetInstructionEvidence = Readonly<{
  index: number
  parentIndex?: number
  programId: string
  accountAddresses: readonly string[]
  dataBase64: string
}>

export type C3MainnetTokenBalanceEvidence = Readonly<{
  accountIndex: number
  mint: string
  owner?: string
  programId?: string
  amountBaseUnits: string
}>

export type C3MainnetLookupTableEvidence = Readonly<{
  address: string
  owner: string
  active: boolean
  lastExtendedSlot: number
  addresses: readonly string[]
  writableIndexes: readonly number[]
  readonlyIndexes: readonly number[]
  loadedWritableAddresses: readonly string[]
  loadedReadonlyAddresses: readonly string[]
}>

export type C3MainnetRawTransactionEvidence = Readonly<{
  accountKeys: readonly C3MainnetAccountKeyEvidence[]
  outerInstructions: readonly C3MainnetInstructionEvidence[]
  innerInstructions: readonly C3MainnetInstructionEvidence[]
  preTokenBalances: readonly C3MainnetTokenBalanceEvidence[]
  postTokenBalances: readonly C3MainnetTokenBalanceEvidence[]
  preLamportBalances: readonly string[]
  postLamportBalances: readonly string[]
  feeLamports: string
  logMessages: readonly string[]
  addressLookupTables: readonly C3MainnetLookupTableEvidence[]
  validationIssues?: readonly string[]
}>

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
  executableProgramIds?: readonly string[]
  unknownProgramIds?: readonly string[]
  input?: Readonly<{ owner: string; mint: string; amountBaseUnits: string; destination?: string }>
  output?: Readonly<{ owner: string; mint: string; amountBaseUnits: string; destination: string }>
  treasuryAddresses: readonly string[]
  lookupTablesValidated: boolean
  effectsComplete: boolean
  raw: C3MainnetRawTransactionEvidence
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
  approvedRouteProgramIds?: readonly string[]
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
  evidenceFingerprints?: readonly string[]
}>

export type C3MainnetConfirmationProvider = Readonly<{
  providerId: string
  endpoint: string
  cluster: 'mainnet-beta'
  getFinalizedTransaction: (signature: string) => Promise<C3MainnetTransactionEvidence | null>
  getRecentTransactions?: (walletAddress: string, limit: number) => Promise<readonly C3MainnetTransactionEvidence[]>
}>

const CORE_PROGRAMS: Set<string> = new Set<string>([
  C3_CORE_MAINNET_CONFIG.programs.system,
  C3_CORE_MAINNET_CONFIG.programs.token,
  C3_CORE_MAINNET_CONFIG.programs.token2022,
  C3_CORE_MAINNET_CONFIG.programs.associatedToken,
  C3_CORE_MAINNET_CONFIG.programs.computeBudget,
  C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6,
])
const ALLOWLISTED_SYSTEM_INSTRUCTIONS = new Set([0, 1, 2, 8])
const ALLOWLISTED_TOKEN_INSTRUCTIONS = new Set([1, 3, 9, 12, 16, 17, 18, 22, 23])
const PROHIBITED_TOKEN_INSTRUCTIONS = new Set([4, 5, 6, 7, 8, 13, 14, 15])

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
  if (evidence.blockTimeMs === null || evidence.blockTimeMs === undefined) {
    issues.push('finalized transaction block time is missing')
  } else if (!Number.isSafeInteger(evidence.blockTimeMs)) {
    issues.push('finalized transaction block time is invalid')
  }
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
  if (expected.treasuryAddress && evidence.raw.accountKeys.some((key) => key.address === expected.treasuryAddress)) {
    issues.push('configured treasury appears in transaction account evidence')
  }
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

  issues.push(...validateRawEvidence(evidence.raw, evidence, expected))

  const input = evidence.input ?? deriveTokenDelta(evidence.raw, expected.inputMint, expected.walletAddress, true)
  const output =
    evidence.output ??
    (expected.leg === 'SOL'
      ? undefined
      : deriveTokenDelta(evidence.raw, expected.outputMint, expected.walletAddress, false))

  if (evidence.metaErr === null) {
    if (!input) {
      issues.push('USDC debit evidence is missing')
    } else {
      if (input.owner !== expected.walletAddress) issues.push('USDC source is not owned by the connected wallet')
      if (input.mint !== expected.inputMint) issues.push('USDC input mint mismatch')
      if (input.amountBaseUnits !== expected.inputAmountBaseUnits)
        issues.push('USDC debit is not exactly the approved leg')
    }

    if (expected.leg !== 'SOL') {
      if (!output) {
        issues.push('successful transaction has no output evidence')
      } else {
        if (output.owner !== expected.walletAddress) issues.push('output account is not owned by the connected wallet')
        if (output.destination !== expected.destination) issues.push('output destination mismatch')
        if (output.mint !== expected.outputMint) issues.push('output mint mismatch')
        if (!isCanonicalBaseUnits(output.amountBaseUnits)) issues.push('output amount is malformed')
        else if (BigInt(output.amountBaseUnits) < BigInt(expected.minimumOutputBaseUnits))
          issues.push('output is below the approved minimum')
      }
    }
  } else if (output && output.owner !== expected.walletAddress) {
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
    outputAmountBaseUnits: output?.amountBaseUnits ?? evidence.sol?.outputLamports,
  }
}

export async function reconcileC3MainnetSignature(
  providers: readonly C3MainnetConfirmationProvider[],
  signature: string,
  expected: Omit<C3MainnetLegExpectation, 'signature'>,
): Promise<C3MainnetReconciliationResult> {
  const providerIssues = validateIndependentProviders(providers)
  if (providerIssues.length > 0) {
    return {
      status: 'reconciliation_required',
      signature,
      issues: providerIssues,
      providerNames: providerIds(providers),
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
      providerNames: providerIds(providers),
    }
  }
  const evidence = results.map((result) => result.evidence as C3MainnetTransactionEvidence)
  if (evidence.some((candidate) => !isEvidenceShape(candidate))) {
    return {
      status: 'reconciliation_required',
      signature,
      issues: ['confirmation provider returned malformed evidence'],
      providerNames: providerIds(providers),
    }
  }
  const semanticFingerprints = evidence.map((candidate) => evidenceSemanticFingerprint(candidate))
  if (semanticFingerprints.some((fingerprint) => fingerprint !== semanticFingerprints[0])) {
    return {
      status: 'reconciliation_required',
      signature,
      issues: ['confirmation providers disagree on the transaction or its effects'],
      providerNames: providerIds(providers),
      evidenceFingerprints: evidence.map((candidate, index) =>
        evidenceFingerprint(candidate, providers[index].providerId),
      ),
    }
  }
  const verified = verifyC3MainnetTransactionEvidence(evidence[0], { ...expected, signature })
  return {
    ...verified,
    providerNames: providerIds(providers),
    evidenceFingerprints: evidence.map((candidate, index) =>
      evidenceFingerprint(candidate, providers[index].providerId),
    ),
  }
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
  providerId: string,
  connection: Connection,
  endpoint = connection.rpcEndpoint,
): C3MainnetConfirmationProvider {
  return {
    providerId,
    endpoint,
    cluster: 'mainnet-beta',
    async getFinalizedTransaction(signature) {
      const [transaction, statusResponse] = await Promise.all([
        connection.getTransaction(signature, {
          commitment: 'finalized',
          maxSupportedTransactionVersion: 0,
        }),
        connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
      ])
      if (!transaction) return null
      const status = statusResponse.value[0]
      return parseConnectionTransaction(signature, connection, transaction, status?.confirmationStatus === 'finalized')
    },
    async getRecentTransactions(walletAddress, limit) {
      const signatures = await connection.getSignaturesForAddress(new PublicKey(walletAddress), {
        limit: Math.min(Math.max(limit, 1), 20),
      })
      const evidence = await Promise.all(signatures.map(({ signature }) => this.getFinalizedTransaction(signature)))
      return evidence.filter((item): item is C3MainnetTransactionEvidence => item !== null)
    },
  }
}

async function parseConnectionTransaction(
  signature: string,
  connection: Connection,
  transaction: any,
  finalized: boolean,
): Promise<C3MainnetTransactionEvidence> {
  const message = transaction.transaction?.message
  const meta = transaction.meta
  const staticKeys = Array.isArray(message?.staticAccountKeys) ? message.staticAccountKeys : []
  const loadedWritable = Array.isArray(meta?.loadedAddresses?.writable) ? meta.loadedAddresses.writable : []
  const loadedReadonly = Array.isArray(meta?.loadedAddresses?.readonly) ? meta.loadedAddresses.readonly : []
  const staticAccountKeys = staticKeys.map((key: unknown, index: number) => ({
    address: publicKeyText(key) ?? '',
    isSigner: index < Number(message?.header?.numRequiredSignatures ?? 0),
    isWritable: isStaticKeyWritable(message?.header, index, staticKeys.length),
    source: 'transaction' as const,
  }))
  const accountKeys: C3MainnetAccountKeyEvidence[] = [
    ...staticAccountKeys,
    ...loadedWritable.map((key: unknown) => ({
      address: publicKeyText(key) ?? '',
      isSigner: false,
      isWritable: true,
      source: 'lookupTable' as const,
    })),
    ...loadedReadonly.map((key: unknown) => ({
      address: publicKeyText(key) ?? '',
      isSigner: false,
      isWritable: false,
      source: 'lookupTable' as const,
    })),
  ]
  const outerInstructions = compileInstructions(message?.compiledInstructions, accountKeys)
  const innerInstructions = (meta?.innerInstructions ?? []).flatMap((group: any) =>
    compileInstructions(group.instructions, accountKeys, Number(group.index)),
  )
  const signerAddresses = accountKeys.filter((account) => account.isSigner).map((account) => account.address)
  const feePayer = signerAddresses[0] ?? ''
  const lookupResolution = await resolveLookupTables(connection, message, meta, transaction.slot)
  const raw: C3MainnetRawTransactionEvidence = {
    accountKeys,
    outerInstructions,
    innerInstructions,
    preTokenBalances: toTokenBalances(meta?.preTokenBalances),
    postTokenBalances: toTokenBalances(meta?.postTokenBalances),
    preLamportBalances: toBaseUnitArray(meta?.preBalances),
    postLamportBalances: toBaseUnitArray(meta?.postBalances),
    feeLamports: String(meta?.fee ?? 0),
    logMessages: Array.isArray(meta?.logMessages)
      ? meta.logMessages.filter((value: unknown): value is string => typeof value === 'string')
      : [],
    addressLookupTables: lookupResolution.tables,
    validationIssues: [
      ...lookupResolution.issues,
      ...(!meta ||
      !message ||
      !accountKeys.length ||
      !Array.isArray(meta.preBalances) ||
      !Array.isArray(meta.postBalances)
        ? ['RPC response omitted required raw transaction or balance evidence']
        : []),
    ],
  }
  const jupiterProgramIds = unique(
    [...outerInstructions, ...innerInstructions]
      .map((instruction) => instruction.programId)
      .filter((programId) => programId === C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6),
  )
  const executableProgramIds = unique(
    [...outerInstructions, ...innerInstructions].map((instruction) => instruction.programId),
  )
  const input = deriveTokenDelta(raw, C3_CORE_MAINNET_ASSETS.input, feePayer, true)
  return {
    signature,
    cluster: 'mainnet-beta',
    slot: transaction.slot,
    blockTimeMs: typeof transaction.blockTime === 'number' ? transaction.blockTime * 1000 : null,
    finalized,
    metaErr: meta && 'err' in meta ? meta.err : undefined,
    feePayer,
    signerAddresses,
    jupiterProgramIds,
    executableProgramIds,
    input: input ?? undefined,
    treasuryAddresses: [],
    lookupTablesValidated: lookupResolution.valid,
    effectsComplete:
      raw.validationIssues?.length === 0 &&
      raw.innerInstructions.length > 0 &&
      raw.preTokenBalances.length > 0 &&
      raw.postTokenBalances.length > 0,
    raw,
    sol: {
      outputLamports: nativeDelta(raw, feePayer),
      feeLamports: raw.feeLamports,
      userLamportsReturned: '0',
    },
  }
}

async function resolveLookupTables(
  connection: Connection,
  message: any,
  meta: any,
  transactionSlot: number,
): Promise<{ valid: boolean; tables: C3MainnetLookupTableEvidence[]; issues: string[] }> {
  const lookups = Array.isArray(message?.addressTableLookups) ? message.addressTableLookups : []
  if (lookups.length === 0) return { valid: true, tables: [], issues: [] }
  const loadedWritable = Array.isArray(meta?.loadedAddresses?.writable) ? meta.loadedAddresses.writable : []
  const loadedReadonly = Array.isArray(meta?.loadedAddresses?.readonly) ? meta.loadedAddresses.readonly : []
  const tables: C3MainnetLookupTableEvidence[] = []
  const issues: string[] = []
  let writableOffset = 0
  let readonlyOffset = 0
  for (const lookup of lookups) {
    const address = publicKeyText(lookup.accountKey)
    if (!address) {
      issues.push('RPC response contained an invalid address lookup table key')
      continue
    }
    try {
      const key = new PublicKey(address)
      const [accountInfo, response] = await Promise.all([
        connection.getAccountInfo(key, 'finalized'),
        connection.getAddressLookupTable(key, { commitment: 'finalized' }),
      ])
      const table = response.value
      const owner = accountInfo?.owner.toBase58() ?? ''
      if (!accountInfo || !table) {
        issues.push(`address lookup table could not be independently resolved: ${address}`)
        continue
      }
      const writableIndexes = Array.isArray(lookup.writableIndexes) ? lookup.writableIndexes.map(Number) : []
      const readonlyIndexes = Array.isArray(lookup.readonlyIndexes) ? lookup.readonlyIndexes.map(Number) : []
      const loadedWritableAddresses: Array<string | null> = loadedWritable
        .slice(writableOffset, writableOffset + writableIndexes.length)
        .map((value: unknown) => publicKeyText(value))
      const loadedReadonlyAddresses: Array<string | null> = loadedReadonly
        .slice(readonlyOffset, readonlyOffset + readonlyIndexes.length)
        .map((value: unknown) => publicKeyText(value))
      writableOffset += writableIndexes.length
      readonlyOffset += readonlyIndexes.length
      if (owner !== C3_CORE_MAINNET_CONFIG.programs.addressLookupTable)
        issues.push(`address lookup table owner mismatch: ${address}`)
      if (!table.isActive() || table.state.lastExtendedSlot > transactionSlot)
        issues.push(`address lookup table is stale or inactive: ${address}`)
      if (loadedWritableAddresses.some((value) => !value) || loadedReadonlyAddresses.some((value) => !value))
        issues.push(`loaded address lookup keys are incomplete: ${address}`)
      const expectedWritable = writableIndexes.map((index: number) => table.state.addresses[index]?.toBase58() ?? '')
      const expectedReadonly = readonlyIndexes.map((index: number) => table.state.addresses[index]?.toBase58() ?? '')
      if (JSON.stringify(expectedWritable) !== JSON.stringify(loadedWritableAddresses))
        issues.push(`loaded writable addresses do not match lookup table: ${address}`)
      if (JSON.stringify(expectedReadonly) !== JSON.stringify(loadedReadonlyAddresses))
        issues.push(`loaded readonly addresses do not match lookup table: ${address}`)
      tables.push({
        address,
        owner,
        active: table.isActive(),
        lastExtendedSlot: table.state.lastExtendedSlot,
        addresses: table.state.addresses.map((value: PublicKey) => value.toBase58()),
        writableIndexes,
        readonlyIndexes,
        loadedWritableAddresses: loadedWritableAddresses.filter((value: string | null): value is string =>
          Boolean(value),
        ),
        loadedReadonlyAddresses: loadedReadonlyAddresses.filter((value: string | null): value is string =>
          Boolean(value),
        ),
      })
    } catch {
      issues.push(`address lookup table resolution failed: ${address}`)
    }
  }
  if (writableOffset !== loadedWritable.length || readonlyOffset !== loadedReadonly.length)
    issues.push('RPC loaded address arrays do not match transaction lookup references')
  return { valid: issues.length === 0, tables, issues }
}

function validateRawEvidence(
  raw: C3MainnetRawTransactionEvidence,
  evidence: C3MainnetTransactionEvidence,
  expected: C3MainnetLegExpectation,
): string[] {
  const issues: string[] = [...(raw.validationIssues ?? [])]
  if (raw.accountKeys.some((key) => !isCanonicalPublicKey(key.address)))
    issues.push('raw account-key evidence contains an invalid public key')
  for (const balance of [...raw.preTokenBalances, ...raw.postTokenBalances]) {
    if (!Number.isSafeInteger(balance.accountIndex) || balance.accountIndex < 0)
      issues.push('token balance evidence has an invalid account index')
    if (!isCanonicalPublicKey(balance.mint)) issues.push('token balance evidence has an invalid mint')
    if (balance.owner !== undefined && !isCanonicalPublicKey(balance.owner))
      issues.push('token balance evidence has an invalid owner')
    if (balance.programId !== undefined && !isCanonicalPublicKey(balance.programId))
      issues.push('token balance evidence has an invalid token program')
    if (!isCanonicalBaseUnits(balance.amountBaseUnits)) issues.push('token balance evidence is malformed')
  }
  const allowedPrograms: Set<string> = new Set([
    ...CORE_PROGRAMS,
    expected.jupiterProgramId,
    ...(expected.approvedRouteProgramIds ?? []),
  ])
  if (
    expected.approvedRouteProgramIds === undefined &&
    (evidence.executableProgramIds ?? []).some((id) => !CORE_PROGRAMS.has(id))
  ) {
    issues.push('approved route program allowlist is missing')
  }
  const allInstructions = [...raw.outerInstructions, ...raw.innerInstructions]
  if (!raw.outerInstructions.some((instruction) => instruction.programId === expected.jupiterProgramId))
    issues.push('raw outer instruction evidence is missing the expected Jupiter instruction')
  if (raw.innerInstructions.length === 0) issues.push('inner instruction evidence is missing')
  const parentAccounts = new Map<number, Set<string>>()
  for (const instruction of raw.outerInstructions)
    parentAccounts.set(instruction.index, new Set(instruction.accountAddresses))
  for (const instruction of allInstructions) {
    if (!allowedPrograms.has(instruction.programId))
      issues.push(`unapproved executable program: ${instruction.programId}`)
    if (!instruction.accountAddresses.every(isCanonicalPublicKey))
      issues.push('instruction contains an invalid account key')
    if (!isBase64(instruction.dataBase64)) issues.push('instruction data is not valid base64')
    validateInstructionSemantics(instruction, parentAccounts, expected, issues)
  }
  validateTokenEffects(raw, evidence, expected, issues)
  validateLamportEffects(raw, expected, issues)
  validateLookupEvidence(raw, evidence.slot, issues)
  return issues
}

function validateInstructionSemantics(
  instruction: C3MainnetInstructionEvidence,
  parentAccounts: Map<number, Set<string>>,
  expected: C3MainnetLegExpectation,
  issues: string[],
) {
  const data = decodeBase64(instruction.dataBase64)
  if (!data) return
  const accounts = instruction.accountAddresses
  const parent = instruction.parentIndex === undefined ? undefined : parentAccounts.get(instruction.parentIndex)
  if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.system) {
    const opcode = readU32(data)
    if (opcode === null || !ALLOWLISTED_SYSTEM_INSTRUCTIONS.has(opcode)) {
      issues.push('unsupported System Program instruction in transaction evidence')
      return
    }
    if (opcode === 2 && !isAllowedLamportDestination(accounts[1], expected))
      issues.push('unexpected native SOL transfer destination')
    if (
      (opcode === 0 || opcode === 1 || opcode === 8) &&
      !isAllowedTemporaryAccount(accounts[1] ?? accounts[0], expected)
    )
      issues.push('unexpected WSOL or token-account System Program target')
    if (opcode === 0 && data.length >= 48) {
      const owner = publicKeyFromBytes(data.slice(16, 48))
      if (owner && owner !== C3_CORE_MAINNET_CONFIG.programs.token)
        issues.push('created account owner is not SPL Token')
    }
    return
  }
  if (
    instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token ||
    instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token2022
  ) {
    if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.token2022)
      issues.push('Token-2022 instructions are not enabled for the approved C3 assets')
    const opcode = data[0]
    if (opcode === undefined || PROHIBITED_TOKEN_INSTRUCTIONS.has(opcode)) {
      issues.push('unexpected token authority, approval, mint, burn, or revoke instruction')
      return
    }
    if (!ALLOWLISTED_TOKEN_INSTRUCTIONS.has(opcode)) {
      issues.push(`unsupported token instruction in transaction evidence: ${opcode ?? 'missing'}`)
      return
    }
    if (opcode === 9) {
      if (
        expected.leg !== 'SOL' ||
        accounts[0] !== expected.temporaryWsolAccount ||
        accounts[1] !== expected.walletAddress
      )
        issues.push('WSOL close-account is not limited to the temporary user account and wallet')
      return
    }
    if (opcode === 17 && (expected.leg !== 'SOL' || accounts[0] !== expected.temporaryWsolAccount))
      issues.push('WSOL sync is not limited to the expected temporary account')
    if (opcode === 3 || opcode === 12) {
      const source = accounts[0]
      const destination = accounts[1]
      if (!source || !destination) issues.push('token transfer is missing source or destination')
      if (destination === expected.treasuryAddress) issues.push('token transfer targets the treasury')
      const allowedRouteAccounts = new Set([
        ...(parent ?? []),
        expected.walletAddress,
        expected.destination,
        expected.temporaryWsolAccount ?? '',
      ])
      if (
        instruction.parentIndex !== undefined &&
        (!allowedRouteAccounts.has(source) || !allowedRouteAccounts.has(destination))
      ) {
        issues.push('inner token transfer leaves the approved Jupiter route account set')
      }
    }
    return
  }
  if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.associatedToken) {
    const expectedAta = expected.leg === 'SOL' ? expected.temporaryWsolAccount : expected.destination
    const expectedMint = expected.leg === 'SOL' ? C3_CORE_MAINNET_ASSETS.wSOL : expected.outputMint
    if (
      !expectedAta ||
      !accounts.includes(expectedAta) ||
      !accounts.includes(expected.walletAddress) ||
      !accounts.includes(expectedMint)
    )
      issues.push('associated-token instruction does not target the user-owned expected mint and account')
    return
  }
  if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.computeBudget) {
    if (!((data[0] === 2 && data.length === 5) || (data[0] === 3 && data.length === 9)))
      issues.push('unsupported compute-budget instruction in transaction evidence')
    return
  }
  if (instruction.programId === C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6 && instruction.parentIndex !== undefined)
    issues.push('Jupiter must not be invoked as an unexpected inner program')
}

function validateTokenEffects(
  raw: C3MainnetRawTransactionEvidence,
  evidence: C3MainnetTransactionEvidence,
  expected: C3MainnetLegExpectation,
  issues: string[],
) {
  const deltas = tokenDeltas(raw)
  for (const delta of deltas) {
    if (!isCanonicalBaseUnits(delta.amountBaseUnits)) issues.push('token balance evidence is malformed')
    if (expected.treasuryAddress && delta.address === expected.treasuryAddress)
      issues.push('token balance evidence references the treasury')
  }
  if (evidence.metaErr !== null) return
  const inputDebit = deltas
    .filter((delta) => delta.mint === expected.inputMint && delta.owner === expected.walletAddress && delta.delta < 0n)
    .reduce((total, delta) => total - delta.delta, 0n)
  if (inputDebit !== BigInt(expected.inputAmountBaseUnits))
    issues.push('raw token balances do not prove the exact USDC debit')
  if (expected.leg !== 'SOL') {
    const outputDeltas = deltas.filter((delta) => delta.mint === expected.outputMint && delta.delta > 0n)
    const destinationDelta = outputDeltas.find((delta) => delta.address === expected.destination)
    if (!destinationDelta) issues.push('raw token balances do not prove output to the expected user account')
    if (outputDeltas.some((delta) => delta.address !== expected.destination))
      issues.push('output mint increased in an unexpected destination account')
  } else {
    const wsolDeltas = deltas.filter((delta) => delta.mint === C3_CORE_MAINNET_ASSETS.wSOL && delta.delta > 0n)
    if (
      wsolDeltas.some(
        (delta) => delta.address !== expected.temporaryWsolAccount && delta.address !== expected.walletAddress,
      )
    )
      issues.push('WSOL increased in an unexpected destination account')
  }
}

function validateLamportEffects(
  raw: C3MainnetRawTransactionEvidence,
  expected: C3MainnetLegExpectation,
  issues: string[],
) {
  if (!isCanonicalBaseUnits(raw.feeLamports)) {
    issues.push('fee evidence is malformed')
    return
  }
  if (
    raw.preLamportBalances.length !== raw.accountKeys.length ||
    raw.postLamportBalances.length !== raw.accountKeys.length
  ) {
    issues.push('native balance evidence does not cover the complete account-key list')
    return
  }
  if (
    raw.preLamportBalances.some((value) => !isCanonicalBaseUnits(value)) ||
    raw.postLamportBalances.some((value) => !isCanonicalBaseUnits(value))
  ) {
    issues.push('native balance evidence is malformed')
    return
  }
  for (let index = 0; index < raw.accountKeys.length; index += 1) {
    const delta = BigInt(raw.postLamportBalances[index]) - BigInt(raw.preLamportBalances[index])
    if (
      delta > 0n &&
      raw.accountKeys[index].address !== expected.walletAddress &&
      raw.accountKeys[index].address !== expected.temporaryWsolAccount &&
      raw.accountKeys[index].address !== expected.destination
    ) {
      issues.push(`unexpected native lamport recipient: ${raw.accountKeys[index].address}`)
    }
  }
}

function validateLookupEvidence(raw: C3MainnetRawTransactionEvidence, slot: number, issues: string[]) {
  for (const table of raw.addressLookupTables) {
    if (!isCanonicalPublicKey(table.address)) issues.push('lookup table address is invalid')
    if (table.owner !== C3_CORE_MAINNET_CONFIG.programs.addressLookupTable)
      issues.push('lookup table owner is not the official ALT program')
    if (!table.active) issues.push('lookup table is inactive')
    if (!Number.isSafeInteger(table.lastExtendedSlot) || table.lastExtendedSlot > slot)
      issues.push('lookup table was not current at transaction finality')
    const indexes = [...table.writableIndexes, ...table.readonlyIndexes]
    if (new Set(indexes).size !== indexes.length) issues.push('lookup table indexes repeat')
    if (indexes.some((index) => index < 0 || index >= table.addresses.length))
      issues.push('lookup table index is out of bounds')
    if (table.addresses.some((address) => !isCanonicalPublicKey(address)))
      issues.push('lookup table contains an invalid address')
    if (table.loadedWritableAddresses.some((address) => !isCanonicalPublicKey(address)))
      issues.push('loaded writable ALT address is invalid')
    if (table.loadedReadonlyAddresses.some((address) => !isCanonicalPublicKey(address)))
      issues.push('loaded readonly ALT address is invalid')
    const writable = table.writableIndexes.map((index) => table.addresses[index])
    const readonly = table.readonlyIndexes.map((index) => table.addresses[index])
    if (JSON.stringify(writable) !== JSON.stringify(table.loadedWritableAddresses))
      issues.push('loaded writable ALT addresses do not match the table')
    if (JSON.stringify(readonly) !== JSON.stringify(table.loadedReadonlyAddresses))
      issues.push('loaded readonly ALT addresses do not match the table')
  }
}

function tokenDeltas(raw: C3MainnetRawTransactionEvidence) {
  const indices = new Set([...raw.preTokenBalances, ...raw.postTokenBalances].map((entry) => entry.accountIndex))
  return [...indices].flatMap((accountIndex) => {
    const pre = raw.preTokenBalances.find((entry) => entry.accountIndex === accountIndex)
    const post = raw.postTokenBalances.find((entry) => entry.accountIndex === accountIndex)
    const mint = post?.mint ?? pre?.mint
    if (!mint) return []
    const owner = post?.owner ?? pre?.owner
    const before = parseBaseUnits(pre?.amountBaseUnits ?? '0')
    const after = parseBaseUnits(post?.amountBaseUnits ?? '0')
    if (before === null || after === null) {
      return [
        {
          accountIndex,
          address: raw.accountKeys[accountIndex]?.address ?? '',
          mint,
          owner,
          amountBaseUnits: 'invalid',
          delta: 0n,
        },
      ]
    }
    return [
      {
        accountIndex,
        address: raw.accountKeys[accountIndex]?.address ?? '',
        mint,
        owner,
        amountBaseUnits: (after > before ? after - before : before - after).toString(),
        delta: after - before,
      },
    ]
  })
}

function deriveTokenDelta(raw: C3MainnetRawTransactionEvidence, mint: string, owner: string, input: boolean) {
  const candidates = tokenDeltas(raw).filter(
    (delta) => delta.mint === mint && delta.owner === owner && (input ? delta.delta < 0n : delta.delta > 0n),
  )
  if (!candidates.length) return undefined
  const amount = candidates.reduce((total, candidate) => total + (input ? -candidate.delta : candidate.delta), 0n)
  return { owner, mint, amountBaseUnits: amount.toString(), destination: candidates[0].address }
}

function nativeDelta(raw: C3MainnetRawTransactionEvidence, wallet: string): string {
  const index = raw.accountKeys.findIndex((account) => account.address === wallet)
  if (index < 0) return '0'
  const pre = BigInt(raw.preLamportBalances[index] ?? '0')
  const post = BigInt(raw.postLamportBalances[index] ?? '0')
  const fee = BigInt(raw.feeLamports)
  const delta = post - pre + fee
  return (delta > 0n ? delta : 0n).toString()
}

function compileInstructions(compiled: any, accountKeys: readonly C3MainnetAccountKeyEvidence[], parentIndex?: number) {
  if (!Array.isArray(compiled)) return []
  return compiled.map((instruction: any, index: number) => {
    const programId = accountKeys[Number(instruction.programIdIndex)]?.address ?? ''
    const accountAddresses = Array.isArray(instruction.accountKeyIndexes)
      ? instruction.accountKeyIndexes.map((accountIndex: number) => accountKeys[Number(accountIndex)]?.address ?? '')
      : Array.isArray(instruction.accounts)
        ? instruction.accounts.map((account: unknown) => publicKeyText(account) ?? '')
        : []
    const dataBase64 =
      typeof instruction.data === 'string' ? Buffer.from(bs58.decode(instruction.data)).toString('base64') : ''
    return { index, parentIndex, programId, accountAddresses, dataBase64 }
  })
}

function toTokenBalances(values: any): C3MainnetTokenBalanceEvidence[] {
  if (!Array.isArray(values)) return []
  return values.map((entry: any) => ({
    accountIndex: Number(entry.accountIndex),
    mint: String(entry.mint ?? ''),
    owner: typeof entry.owner === 'string' ? entry.owner : undefined,
    programId: typeof entry.programId === 'string' ? entry.programId : undefined,
    amountBaseUnits: String(entry.uiTokenAmount?.amount ?? ''),
  }))
}

function toBaseUnitArray(values: any): string[] {
  return Array.isArray(values) ? values.map((value) => String(value)) : []
}

function isStaticKeyWritable(header: any, index: number, length: number): boolean {
  const required = Number(header?.numRequiredSignatures ?? 0)
  const readonlySigned = Number(header?.numReadonlySignedAccounts ?? 0)
  const readonlyUnsigned = Number(header?.numReadonlyUnsignedAccounts ?? 0)
  if (index < required) return index < required - readonlySigned
  return index < length - readonlyUnsigned
}

function isAllowedLamportDestination(address: string | undefined, expected: C3MainnetLegExpectation): boolean {
  return (
    address === expected.walletAddress || address === expected.temporaryWsolAccount || address === expected.destination
  )
}

function isAllowedTemporaryAccount(address: string | undefined, expected: C3MainnetLegExpectation): boolean {
  return address === expected.destination || address === expected.temporaryWsolAccount
}

function publicKeyFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length !== 32) return null
  try {
    return new PublicKey(bytes).toBase58()
  } catch {
    return null
  }
}

function readU32(data: Uint8Array): number | null {
  if (data.length < 4) return null
  return data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)
}

function decodeBase64(value: string): Uint8Array | null {
  if (!isBase64(value)) return null
  try {
    return Uint8Array.from(Buffer.from(value, 'base64'))
  } catch {
    return null
  }
}

function isBase64(value: string): boolean {
  return typeof value === 'string' && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

function publicKeyText(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'toBase58' in value && typeof value.toBase58 === 'function') return value.toBase58()
  return null
}

function validateIndependentProviders(providers: readonly C3MainnetConfirmationProvider[]): string[] {
  if (providers.length < 2) return ['two independently configured Mainnet confirmation providers are required']
  const ids = providers.map((provider) => provider.providerId.trim())
  const endpoints = providers.map((provider) => normalizeRpcEndpoint(provider.endpoint))
  if (ids.some((id) => !id)) return ['every confirmation provider requires a non-empty provider identity']
  if (new Set(ids).size !== ids.length) return ['confirmation provider identities must be distinct']
  if (endpoints.some((endpoint) => endpoint === null))
    return ['every confirmation provider requires a valid RPC endpoint']
  const normalized = endpoints as string[]
  if (new Set(normalized).size !== normalized.length) return ['confirmation provider endpoints must be distinct']
  if (providers.some((provider) => provider.cluster !== 'mainnet-beta'))
    return ['confirmation providers must use Mainnet']
  return []
}

function normalizeRpcEndpoint(endpoint: string): string | null {
  try {
    const parsed = new URL(endpoint)
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      return null
    parsed.hostname = parsed.hostname.toLowerCase()
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.toString()
  } catch {
    return null
  }
}

function providerIds(providers: readonly C3MainnetConfirmationProvider[]): string[] {
  return providers.map((provider) => provider.providerId)
}

export function getC3MainnetEvidenceFingerprint(evidence: C3MainnetTransactionEvidence, providerId: string): string {
  return evidenceFingerprint(evidence, providerId)
}

function evidenceFingerprint(evidence: C3MainnetTransactionEvidence, providerId: string): string {
  return JSON.stringify({ providerId, ...JSON.parse(evidenceSemanticFingerprint(evidence)) })
}

function evidenceSemanticFingerprint(evidence: C3MainnetTransactionEvidence): string {
  return JSON.stringify({
    signature: evidence.signature,
    cluster: evidence.cluster,
    slot: evidence.slot,
    blockTimeMs: evidence.blockTimeMs,
    finalized: evidence.finalized,
    metaErr: evidence.metaErr,
    feePayer: evidence.feePayer,
    signerAddresses: evidence.signerAddresses,
    jupiterProgramIds: evidence.jupiterProgramIds,
    executableProgramIds: evidence.executableProgramIds,
    unknownProgramIds: evidence.unknownProgramIds,
    input: evidence.input,
    output: evidence.output,
    treasuryAddresses: evidence.treasuryAddresses,
    lookupTablesValidated: evidence.lookupTablesValidated,
    effectsComplete: evidence.effectsComplete,
    raw: evidence.raw,
    unexpectedAuthorityChange: evidence.unexpectedAuthorityChange,
    unexpectedDelegateOrApproval: evidence.unexpectedDelegateOrApproval,
    unexpectedLamportRecipients: evidence.unexpectedLamportRecipients,
    unexpectedAccountClosure: evidence.unexpectedAccountClosure,
    closedAccount: evidence.closedAccount,
    closeDestination: evidence.closeDestination,
    sol: evidence.sol,
  })
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
    typeof candidate.effectsComplete === 'boolean' &&
    isRawEvidenceShape(candidate.raw)
  )
}

function isRawEvidenceShape(value: unknown): value is C3MainnetRawTransactionEvidence {
  if (!value || typeof value !== 'object') return false
  const raw = value as Partial<C3MainnetRawTransactionEvidence>
  return (
    Array.isArray(raw.accountKeys) &&
    raw.accountKeys.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.address === 'string' &&
        typeof entry.isSigner === 'boolean' &&
        typeof entry.isWritable === 'boolean' &&
        (entry.source === 'transaction' || entry.source === 'lookupTable'),
    ) &&
    Array.isArray(raw.outerInstructions) &&
    raw.outerInstructions.every(isInstructionEvidenceShape) &&
    Array.isArray(raw.innerInstructions) &&
    raw.innerInstructions.every(isInstructionEvidenceShape) &&
    Array.isArray(raw.preTokenBalances) &&
    raw.preTokenBalances.every(isTokenBalanceEvidenceShape) &&
    Array.isArray(raw.postTokenBalances) &&
    raw.postTokenBalances.every(isTokenBalanceEvidenceShape) &&
    Array.isArray(raw.preLamportBalances) &&
    raw.preLamportBalances.every((entry) => typeof entry === 'string') &&
    Array.isArray(raw.postLamportBalances) &&
    raw.postLamportBalances.every((entry) => typeof entry === 'string') &&
    typeof raw.feeLamports === 'string' &&
    Array.isArray(raw.logMessages) &&
    raw.logMessages.every((entry) => typeof entry === 'string') &&
    Array.isArray(raw.addressLookupTables) &&
    raw.addressLookupTables.every(isLookupTableEvidenceShape) &&
    (raw.validationIssues === undefined ||
      (Array.isArray(raw.validationIssues) && raw.validationIssues.every((entry) => typeof entry === 'string')))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isInstructionEvidenceShape(value: unknown): value is C3MainnetInstructionEvidence {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.index) &&
    (value.parentIndex === undefined || Number.isSafeInteger(value.parentIndex)) &&
    typeof value.programId === 'string' &&
    Array.isArray(value.accountAddresses) &&
    value.accountAddresses.every((entry) => typeof entry === 'string') &&
    typeof value.dataBase64 === 'string'
  )
}

function isTokenBalanceEvidenceShape(value: unknown): value is C3MainnetTokenBalanceEvidence {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.accountIndex) &&
    typeof value.mint === 'string' &&
    (value.owner === undefined || typeof value.owner === 'string') &&
    (value.programId === undefined || typeof value.programId === 'string') &&
    typeof value.amountBaseUnits === 'string'
  )
}

function isLookupTableEvidenceShape(value: unknown): value is C3MainnetLookupTableEvidence {
  return (
    isRecord(value) &&
    typeof value.address === 'string' &&
    typeof value.owner === 'string' &&
    typeof value.active === 'boolean' &&
    Number.isSafeInteger(value.lastExtendedSlot) &&
    Array.isArray(value.addresses) &&
    value.addresses.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.writableIndexes) &&
    value.writableIndexes.every((entry) => Number.isSafeInteger(entry)) &&
    Array.isArray(value.readonlyIndexes) &&
    value.readonlyIndexes.every((entry) => Number.isSafeInteger(entry)) &&
    Array.isArray(value.loadedWritableAddresses) &&
    value.loadedWritableAddresses.every((entry) => typeof entry === 'string') &&
    Array.isArray(value.loadedReadonlyAddresses) &&
    value.loadedReadonlyAddresses.every((entry) => typeof entry === 'string')
  )
}

function isCanonicalBaseUnits(value: string): boolean {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)
}

function parseBaseUnits(value: string): bigint | null {
  if (!isCanonicalBaseUnits(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function isCanonicalPublicKey(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
