import AsyncStorage from '@react-native-async-storage/async-storage'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

import {
  C3_CORE_MAINNET_ASSETS,
  C3_CORE_MAINNET_VERSION,
  allocateC3Core,
  assertC3MainnetStateTransition,
  assertC3PurchaseAmount,
  generateC3PurchaseIntentId,
  nextC3MainnetPurchaseState,
} from './c3-core-mainnet-core.ts'
import type {
  C3CoreMainnetLegId,
  C3CoreMainnetPurchaseState,
  C3PurchaseIntentIdGenerator,
} from './c3-core-mainnet-core.ts'
import type { C3MainnetAuthorizationManifest } from './c3-core-mainnet-manifest.ts'

export const C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION = 3 as const
export const C3_CORE_MAINNET_STORAGE_KEY = 'cmarket.c3-core-mainnet.purchase-intents.v3'
export const C3_CORE_MAINNET_STAGING_KEY = 'cmarket.c3-core-mainnet.purchase-intents.v3.staging'
export const C3_CORE_MAINNET_LEGACY_STORAGE_KEY = 'cmarket.c3-core-mainnet.purchase-intents.v2'
export const C3_CORE_MAINNET_LEGACY_STAGING_KEY = 'cmarket.c3-core-mainnet.purchase-intents.v2.staging'

export type C3CoreMainnetLegState =
  | 'pending'
  | 'awaiting_approval'
  | 'submitted_unconfirmed'
  | 'confirmed'
  | 'failed_on_chain'
  | 'cancelled_before_submission'
  | 'submission_outcome_uncertain'
  | 'reconciliation_required'

export type C3CoreMainnetRecoveryRecord = Readonly<{
  kind: 'bounded_review'
  reason: 'wallet_interrupted' | 'missing_signature' | 'storage_conflict' | 'reconciliation_required'
  createdAt: number
  expiresAt: number
  attempts: number
  maxAttempts: number
}>

export type C3CoreMainnetFinalizedEvidence = Readonly<{
  status: 'finalized'
  verifiedAt: number
  fingerprint: string
}>

export type C3CoreMainnetLegRecord = Readonly<{
  id: C3CoreMainnetLegId
  order: number
  inputMint: typeof C3_CORE_MAINNET_ASSETS.input
  outputMint: string
  destination: string
  allocationUsdcBaseUnits: string
  state: C3CoreMainnetLegState
  signature?: string
  minimumOutputBaseUnits?: string
  confirmedOutputBaseUnits?: string
  finalizedEvidence?: C3CoreMainnetFinalizedEvidence
  authorizationManifest?: C3MainnetAuthorizationManifest
  recovery?: C3CoreMainnetRecoveryRecord
  updatedAt: number
  errorCode?: string
}>

export type C3CoreMainnetPurchaseIntent = Readonly<{
  schemaVersion: typeof C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION
  id: string
  walletAddress: string
  cluster: 'mainnet-beta'
  totalUsdcBaseUnits: string
  state: C3CoreMainnetPurchaseState
  basketVersion: string
  createdAt: number
  updatedAt: number
  revision: number
  diagnostic?: string
  legs: Readonly<Record<C3CoreMainnetLegId, C3CoreMainnetLegRecord>>
}>

type PersistedDocument = Readonly<{
  schemaVersion: typeof C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION
  revision: number
  intents: readonly C3CoreMainnetPurchaseIntent[]
}>

export type C3AsyncStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}>

export type C3PersistenceErrorCode =
  | 'corrupt_state'
  | 'unsupported_schema_version'
  | 'reconciliation_required'
  | 'storage_conflict'
  | 'storage_write_failed'

export class C3PersistenceError extends Error {
  readonly code: C3PersistenceErrorCode

  constructor(code: C3PersistenceErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'C3PersistenceError'
  }
}

class AsyncMutex {
  private tail = Promise.resolve()

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

const STORE_MUTEX = new AsyncMutex()
const LEG_IDS: readonly C3CoreMainnetLegId[] = ['cbBTC', 'portalETH', 'SOL']
const LEG_STATES: readonly C3CoreMainnetLegState[] = [
  'pending',
  'awaiting_approval',
  'submitted_unconfirmed',
  'confirmed',
  'failed_on_chain',
  'cancelled_before_submission',
  'submission_outcome_uncertain',
  'reconciliation_required',
]
const PURCHASE_STATES: readonly C3CoreMainnetPurchaseState[] = [
  'draft',
  'quoting',
  'ready_for_review',
  'awaiting_wallet',
  'submitted_unconfirmed',
  'confirmed',
  'failed_on_chain',
  'cancelled_before_submission',
  'submission_outcome_uncertain',
  'reconciliation_required',
  'partially_completed',
  'completed',
]
const DIAGNOSTICS = new Set(['corrupt_state', 'storage_conflict', 'storage_write_failed', 'reconciliation_required'])
const ERROR_CODES = new Set([
  'wallet_cancelled',
  'wallet_submission_uncertain',
  'submission_outcome_uncertain',
  'reconciliation_required',
  'on_chain_error',
  'recovered_signature',
  'history_no_match',
  'history_ambiguous',
  'recovery_expired',
  'recovery_exhausted',
  'missing_minimum_output',
  'missing_authorization_manifest',
  'explicit_review_no_match',
])

const LEG_TRANSITIONS: Readonly<Record<C3CoreMainnetLegState, readonly C3CoreMainnetLegState[]>> = {
  pending: ['awaiting_approval', 'cancelled_before_submission', 'reconciliation_required'],
  awaiting_approval: [
    'submitted_unconfirmed',
    'cancelled_before_submission',
    'submission_outcome_uncertain',
    'reconciliation_required',
  ],
  submitted_unconfirmed: ['confirmed', 'failed_on_chain', 'submission_outcome_uncertain', 'reconciliation_required'],
  confirmed: ['confirmed'],
  failed_on_chain: ['awaiting_approval', 'cancelled_before_submission', 'reconciliation_required'],
  cancelled_before_submission: ['awaiting_approval', 'reconciliation_required'],
  submission_outcome_uncertain: ['reconciliation_required'],
  reconciliation_required: ['reconciliation_required', 'awaiting_approval', 'cancelled_before_submission'],
}

export const C3_STATE_INVARIANT_MATRIX = Object.freeze({
  draft: 'all legs pending; no confirmation or recovery evidence',
  quoting: 'no blocked leg; at least one leg remains unresolved',
  ready_for_review: 'at least one leg awaits approval; no blocked leg',
  awaiting_wallet: 'at least one leg awaits wallet approval; no blocked leg',
  submitted_unconfirmed: 'at least one leg has a preserved signature or bounded recovery record',
  confirmed: 'all legs are finalized and carry validated evidence',
  failed_on_chain: 'at least one on-chain failure and no unresolved submitted signature',
  cancelled_before_submission: 'at least one cancelled leg and no confirmed or submitted leg',
  submission_outcome_uncertain: 'at least one uncertain leg with preserved signature or bounded recovery record',
  reconciliation_required: 'at least one blocked leg with preserved signature or bounded recovery record',
  partially_completed: 'at least one confirmed leg and at least one unresolved or failed leg',
  completed: 'every leg is confirmed with finalized evidence',
} as const)

const RECOVERY_REASONS = new Set([
  'wallet_interrupted',
  'missing_signature',
  'storage_conflict',
  'reconciliation_required',
])

export function validateC3PersistedPurchaseIntent(value: unknown): C3CoreMainnetPurchaseIntent {
  if (!isRecord(value)) throw corrupt('persisted purchase is not an object')
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'id',
      'walletAddress',
      'cluster',
      'totalUsdcBaseUnits',
      'state',
      'basketVersion',
      'createdAt',
      'updatedAt',
      'revision',
      'legs',
    ],
    ['diagnostic'],
  )
  if (value.schemaVersion !== C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION) throw unsupportedSchema()
  const id = expectString(value.id, 'intent id')
  if (!/^c3-core-mainnet-v1-[a-f0-9]{32}$/.test(id))
    throw corrupt('intent id is not a cryptographically random C3 identifier')
  const walletAddress = expectPublicKey(value.walletAddress, 'wallet address')
  if (value.cluster !== 'mainnet-beta') throw corrupt('persisted purchase cluster is not mainnet-beta')
  const totalUsdcBaseUnits = expectBaseUnits(value.totalUsdcBaseUnits, 'total USDC')
  try {
    assertC3PurchaseAmount(totalUsdcBaseUnits)
  } catch {
    throw corrupt('persisted total USDC is outside the allowed purchase range')
  }
  if (!PURCHASE_STATES.includes(value.state as C3CoreMainnetPurchaseState)) throw corrupt('unknown purchase state')
  const basketVersion = expectString(value.basketVersion, 'basket version')
  if (basketVersion !== C3_CORE_MAINNET_VERSION) throw corrupt('unsupported basket version')
  const createdAt = expectTimestamp(value.createdAt, 'createdAt')
  const updatedAt = expectTimestamp(value.updatedAt, 'updatedAt')
  if (updatedAt < createdAt) throw corrupt('updatedAt precedes createdAt')
  const revision = expectInteger(value.revision, 'revision')
  if (revision < 1) throw corrupt('revision must be positive')
  if (value.diagnostic !== undefined) {
    const diagnostic = expectString(value.diagnostic, 'diagnostic')
    if (!DIAGNOSTICS.has(diagnostic)) throw corrupt('unsupported diagnostic')
  }
  if (!isRecord(value.legs)) throw corrupt('legs are missing')
  assertExactKeys(value.legs, LEG_IDS)
  const allocation = allocateC3Core(totalUsdcBaseUnits)
  const legs = {} as Record<C3CoreMainnetLegId, C3CoreMainnetLegRecord>
  for (const [order, legId] of LEG_IDS.entries()) {
    legs[legId] = validateC3PersistedLeg(value.legs[legId], legId, order, walletAddress, allocation.legs[legId])
  }
  const result = {
    ...value,
    walletAddress,
    totalUsdcBaseUnits: totalUsdcBaseUnits.toString(),
    createdAt,
    updatedAt,
    revision,
    legs,
  } as C3CoreMainnetPurchaseIntent
  validatePurchaseStateAgainstLegs(result)
  return result
}

/**
 * Migrate only safe v2 records. Records that cannot prove the new finalized
 * evidence and recovery invariants are quarantined by the validator instead of
 * being silently normalized.
 */
export function migrateC3PersistedPurchaseIntent(value: unknown): C3CoreMainnetPurchaseIntent {
  if (!isRecord(value) || value.schemaVersion !== 2) throw unsupportedSchema()
  return validateC3PersistedPurchaseIntent({ ...value, schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION })
}

export function createC3BoundedRecoveryRecord(
  reason: C3CoreMainnetRecoveryRecord['reason'],
  now = Date.now(),
): C3CoreMainnetRecoveryRecord {
  return {
    kind: 'bounded_review',
    reason,
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
    attempts: 0,
    maxAttempts: 3,
  }
}

export type C3RecoveryAttemptResult = Readonly<{
  status: 'allowed' | 'expired' | 'exhausted'
  record: C3CoreMainnetRecoveryRecord
}>

export function consumeC3RecoveryAttempt(
  record: C3CoreMainnetRecoveryRecord,
  now = Date.now(),
): C3RecoveryAttemptResult {
  if (now >= record.expiresAt) return { status: 'expired', record }
  if (record.attempts >= record.maxAttempts) return { status: 'exhausted', record }
  return { status: 'allowed', record: { ...record, attempts: record.attempts + 1 } }
}

export class C3CoreMainnetStore {
  private readonly storage: C3AsyncStorage

  constructor(storage: C3AsyncStorage = AsyncStorage) {
    this.storage = storage
  }

  async list(): Promise<C3CoreMainnetPurchaseIntent[]> {
    return (await this.readDocument()).intents.slice()
  }

  async get(id: string): Promise<C3CoreMainnetPurchaseIntent | undefined> {
    return (await this.list()).find((intent) => intent.id === id)
  }

  async save(
    intent: C3CoreMainnetPurchaseIntent,
    expectedRevision = intent.revision,
  ): Promise<C3CoreMainnetPurchaseIntent> {
    return STORE_MUTEX.runExclusive(async () => {
      const document = await this.readDocument()
      const existing = document.intents.find((candidate) => candidate.id === intent.id)
      if (!existing) throw new C3PersistenceError('storage_conflict', 'The C3 purchase no longer exists.')
      if (existing.revision !== expectedRevision || intent.revision !== expectedRevision) {
        throw new C3PersistenceError('storage_conflict', 'The C3 purchase has a newer revision.')
      }
      assertImmutableIntentFields(existing, intent)
      if (existing.state === 'confirmed' && intent.state !== 'confirmed') {
        throw new C3PersistenceError('storage_conflict', 'A confirmed C3 purchase is immutable.')
      }
      if (existing.state !== intent.state) assertC3MainnetStateTransition(existing.state, intent.state)
      validateLegTransitions(existing, intent)
      const next = validateC3PersistedPurchaseIntent({ ...intent, revision: document.revision + 1 })
      const intents = document.intents.map((candidate) => (candidate.id === intent.id ? next : candidate))
      await this.writeDocument(
        {
          schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION,
          revision: document.revision + 1,
          intents,
        },
        document.revision,
      )
      return next
    })
  }

  async create(input: {
    walletAddress: string
    totalUsdcBaseUnits: bigint
    legs?: Readonly<Record<C3CoreMainnetLegId, bigint>>
    now?: number
    idGenerator?: C3PurchaseIntentIdGenerator
  }): Promise<C3CoreMainnetPurchaseIntent> {
    return STORE_MUTEX.runExclusive(async () => {
      const document = await this.readDocument()
      const now = input.now ?? Date.now()
      const walletAddress = expectPublicKey(input.walletAddress, 'wallet address')
      const allocation = allocateC3Core(input.totalUsdcBaseUnits)
      if (input.legs && LEG_IDS.some((leg) => input.legs?.[leg] !== allocation.legs[leg])) {
        throw new C3PersistenceError('corrupt_state', 'Requested allocation does not match the canonical basket.')
      }
      const id = generateC3PurchaseIntentId(input.idGenerator)
      if (document.intents.some((candidate) => candidate.id === id)) {
        throw new C3PersistenceError('storage_conflict', 'Duplicate C3 intent identifier.')
      }
      const revision = document.revision + 1
      const intent = validateC3PersistedPurchaseIntent({
        schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION,
        id,
        walletAddress,
        cluster: 'mainnet-beta',
        totalUsdcBaseUnits: input.totalUsdcBaseUnits.toString(),
        state: 'draft',
        basketVersion: C3_CORE_MAINNET_VERSION,
        createdAt: now,
        updatedAt: now,
        revision,
        legs: makeInitialLegs(walletAddress, allocation.legs, now),
      })
      await this.writeDocument(
        {
          schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION,
          revision,
          intents: [intent, ...document.intents].slice(0, 20),
        },
        document.revision,
      )
      return intent
    })
  }

  private async readDocument(): Promise<PersistedDocument> {
    const raw = await this.storage.getItem(C3_CORE_MAINNET_STORAGE_KEY)
    const stagedRaw = await this.storage.getItem(C3_CORE_MAINNET_STAGING_KEY)
    const legacyRaw = await this.storage.getItem(C3_CORE_MAINNET_LEGACY_STORAGE_KEY)
    const legacyStagedRaw = await this.storage.getItem(C3_CORE_MAINNET_LEGACY_STAGING_KEY)
    const document = parseDocument(raw)
    if (stagedRaw) {
      const staged = parseDocument(stagedRaw)
      if (
        !document ||
        !staged ||
        staged.revision > document.revision ||
        JSON.stringify(staged) !== JSON.stringify(document)
      ) {
        throw new C3PersistenceError('reconciliation_required', 'A staged C3 state write requires reconciliation.')
      }
    }
    if (document) return document
    if (legacyStagedRaw) {
      throw new C3PersistenceError('reconciliation_required', 'A legacy staged C3 state write requires reconciliation.')
    }
    return parseLegacyDocument(legacyRaw) ?? emptyDocument()
  }

  private async writeDocument(document: PersistedDocument, expectedPreviousRevision: number): Promise<void> {
    const currentRevision = await this.readCurrentRevision()
    if (currentRevision !== expectedPreviousRevision) {
      throw new C3PersistenceError('storage_conflict', 'The C3 storage revision changed before the write.')
    }
    const payload = JSON.stringify(document)
    try {
      await this.storage.setItem(C3_CORE_MAINNET_STAGING_KEY, payload)
      if ((await this.storage.getItem(C3_CORE_MAINNET_STAGING_KEY)) !== payload)
        throw new Error('staging verification failed')
      await this.storage.setItem(C3_CORE_MAINNET_STORAGE_KEY, payload)
      if ((await this.storage.getItem(C3_CORE_MAINNET_STORAGE_KEY)) !== payload)
        throw new C3PersistenceError('storage_conflict', 'C3 storage changed during the write.')
      await this.storage.removeItem(C3_CORE_MAINNET_STAGING_KEY)
    } catch (error) {
      if (error instanceof C3PersistenceError) throw error
      throw new C3PersistenceError(
        'storage_write_failed',
        error instanceof Error ? error.message : 'storage write failed',
      )
    }
  }

  private async readCurrentRevision(): Promise<number> {
    const raw = await this.storage.getItem(C3_CORE_MAINNET_STORAGE_KEY)
    if (raw) return parseDocument(raw)?.revision ?? 0
    const legacyRaw = await this.storage.getItem(C3_CORE_MAINNET_LEGACY_STORAGE_KEY)
    return parseLegacyDocument(legacyRaw)?.revision ?? 0
  }
}

export function deriveStateFromLegs(intent: C3CoreMainnetPurchaseIntent): C3CoreMainnetPurchaseState {
  const legs = Object.values(intent.legs)
  return nextC3MainnetPurchaseState({
    confirmedLegs: legs.filter((leg) => leg.state === 'confirmed').length,
    totalLegs: legs.length,
    failed: legs.some((leg) => leg.state === 'failed_on_chain' || leg.state === 'cancelled_before_submission'),
    uncertain: legs.some((leg) => leg.state === 'submission_outcome_uncertain'),
    reconciliationRequired: legs.some((leg) => leg.state === 'reconciliation_required'),
  })
}

function makeInitialLegs(walletAddress: string, allocation: Readonly<Record<C3CoreMainnetLegId, bigint>>, now: number) {
  return Object.fromEntries(
    LEG_IDS.map((id, order) => [
      id,
      {
        id,
        order,
        inputMint: C3_CORE_MAINNET_ASSETS.input,
        outputMint:
          id === 'cbBTC'
            ? C3_CORE_MAINNET_ASSETS.cbBTC
            : id === 'portalETH'
              ? C3_CORE_MAINNET_ASSETS.portalETH
              : C3_CORE_MAINNET_ASSETS.wSOL,
        destination: id === 'SOL' ? walletAddress : associatedTokenAddress(id, walletAddress),
        allocationUsdcBaseUnits: allocation[id].toString(),
        state: 'pending',
        updatedAt: now,
      },
    ]),
  )
}

function validateC3PersistedLeg(
  value: unknown,
  id: C3CoreMainnetLegId,
  order: number,
  walletAddress: string,
  allocation: bigint,
): C3CoreMainnetLegRecord {
  if (!isRecord(value)) throw corrupt(`leg ${id} is not an object`)
  assertExactKeys(
    value,
    ['id', 'order', 'inputMint', 'outputMint', 'destination', 'allocationUsdcBaseUnits', 'state', 'updatedAt'],
    [
      'signature',
      'minimumOutputBaseUnits',
      'confirmedOutputBaseUnits',
      'finalizedEvidence',
      'authorizationManifest',
      'recovery',
      'errorCode',
    ],
  )
  if (value.id !== id || value.order !== order) throw corrupt(`leg ${id} order or identifier changed`)
  if (value.inputMint !== C3_CORE_MAINNET_ASSETS.input) throw corrupt(`leg ${id} input mint changed`)
  const expectedOutputMint =
    id === 'cbBTC'
      ? C3_CORE_MAINNET_ASSETS.cbBTC
      : id === 'portalETH'
        ? C3_CORE_MAINNET_ASSETS.portalETH
        : C3_CORE_MAINNET_ASSETS.wSOL
  if (value.outputMint !== expectedOutputMint) throw corrupt(`leg ${id} output mint changed`)
  const expectedDestination = id === 'SOL' ? walletAddress : associatedTokenAddress(id, walletAddress)
  if (value.destination !== expectedDestination) throw corrupt(`leg ${id} destination changed`)
  if (expectBaseUnits(value.allocationUsdcBaseUnits, `leg ${id} allocation`) !== allocation)
    throw corrupt(`leg ${id} allocation changed`)
  if (!LEG_STATES.includes(value.state as C3CoreMainnetLegState)) throw corrupt(`leg ${id} state is unknown`)
  const updatedAt = expectTimestamp(value.updatedAt, `leg ${id} updatedAt`)
  const result: C3CoreMainnetLegRecord = {
    ...value,
    allocationUsdcBaseUnits: allocation.toString(),
    updatedAt,
  } as C3CoreMainnetLegRecord
  if (value.signature !== undefined) validateSignature(value.signature, `leg ${id} signature`)
  if (value.minimumOutputBaseUnits !== undefined)
    expectBaseUnits(value.minimumOutputBaseUnits, `leg ${id} minimum output`)
  if (value.confirmedOutputBaseUnits !== undefined)
    expectBaseUnits(value.confirmedOutputBaseUnits, `leg ${id} confirmed output`)
  if (value.finalizedEvidence !== undefined)
    validateFinalizedEvidence(value.finalizedEvidence, `leg ${id} finalized evidence`)
  if (value.authorizationManifest !== undefined)
    validateAuthorizationManifest(value.authorizationManifest, `leg ${id} authorization manifest`)
  if (value.recovery !== undefined) validateRecoveryRecord(value.recovery, `leg ${id} recovery`)
  if (value.errorCode !== undefined) {
    const errorCode = expectString(value.errorCode, `leg ${id} error code`)
    if (!ERROR_CODES.has(errorCode)) throw corrupt(`leg ${id} error code is not an approved diagnostic`)
  }
  const requiresRecoveryEvidence = ['submitted_unconfirmed', 'submission_outcome_uncertain', 'reconciliation_required']
  if (
    requiresRecoveryEvidence.includes(value.state as string) &&
    value.signature === undefined &&
    value.recovery === undefined
  )
    throw corrupt(`leg ${id} blocked state has no signature or bounded recovery record`)
  if (value.state === 'failed_on_chain' && value.signature === undefined)
    throw corrupt(`leg ${id} failed state has no preserved signature`)
  if (value.finalizedEvidence !== undefined && value.state !== 'confirmed')
    throw corrupt(`leg ${id} finalized evidence is outside confirmed state`)
  if (value.confirmedOutputBaseUnits !== undefined && value.state !== 'confirmed')
    throw corrupt(`leg ${id} confirmed output is outside confirmed state`)
  if (
    value.recovery !== undefined &&
    !['awaiting_approval', 'submitted_unconfirmed', 'submission_outcome_uncertain', 'reconciliation_required'].includes(
      value.state as string,
    )
  )
    throw corrupt(`leg ${id} recovery record is outside a recoverable state`)
  if (
    value.state === 'confirmed' &&
    (value.minimumOutputBaseUnits === undefined ||
      value.confirmedOutputBaseUnits === undefined ||
      value.finalizedEvidence === undefined ||
      value.signature === undefined)
  ) {
    throw corrupt(`leg ${id} confirmed state lacks finalized output evidence`)
  }
  if (value.state === 'confirmed') {
    if (value.errorCode !== undefined) throw corrupt(`leg ${id} confirmed state has an error diagnostic`)
    if (BigInt(value.confirmedOutputBaseUnits as string) < BigInt(value.minimumOutputBaseUnits as string))
      throw corrupt(`leg ${id} confirmed output is below its approved minimum`)
  }
  if (
    ['failed_on_chain', 'cancelled_before_submission'].includes(value.state as string) &&
    (value.finalizedEvidence !== undefined || value.confirmedOutputBaseUnits !== undefined)
  ) {
    throw corrupt(`leg ${id} failed or cancelled state contains confirmed evidence`)
  }
  if (value.state === 'awaiting_approval' && value.minimumOutputBaseUnits === undefined)
    throw corrupt(`leg ${id} awaiting approval has no approved minimum output`)
  if (
    ['pending', 'quoting', 'cancelled_before_submission'].includes(value.state as string) &&
    value.authorizationManifest !== undefined
  )
    throw corrupt(`leg ${id} pre-approval state contains an authorization manifest`)
  if (
    ['pending', 'awaiting_approval', 'cancelled_before_submission'].includes(value.state as string) &&
    value.signature !== undefined
  ) {
    throw corrupt(`leg ${id} pre-submission state contains a signature`)
  }
  return result
}

function validatePurchaseStateAgainstLegs(intent: C3CoreMainnetPurchaseIntent) {
  const states = Object.values(intent.legs).map((leg) => leg.state)
  const confirmed = states.filter((state) => state === 'confirmed').length
  const blocked = states.some(
    (state) => state === 'submission_outcome_uncertain' || state === 'reconciliation_required',
  )
  const submitted = states.some((state) => state === 'submitted_unconfirmed')
  const failed = states.some((state) => state === 'failed_on_chain')
  const cancelled = states.some((state) => state === 'cancelled_before_submission')
  const awaiting = states.some((state) => state === 'awaiting_approval')
  const unresolvedOrFailed = states.some((state) => state !== 'confirmed')

  switch (intent.state) {
    case 'draft':
      if (states.some((state) => state !== 'pending')) throw corrupt('draft purchase has non-pending legs')
      break
    case 'quoting':
      if (blocked || confirmed === states.length) throw corrupt('quoting purchase has blocked or completed legs')
      break
    case 'ready_for_review':
    case 'awaiting_wallet':
      if (blocked || !awaiting) throw corrupt('review purchase has no approvable leg or contains a blocked leg')
      break
    case 'submitted_unconfirmed':
      if (blocked || !submitted) throw corrupt('submitted purchase has no submitted leg or contains a blocked leg')
      break
    case 'confirmed':
      if (confirmed !== states.length) throw corrupt('confirmed purchase has unconfirmed legs')
      break
    case 'failed_on_chain':
      if (!failed || submitted || blocked || confirmed > 0)
        throw corrupt('failed purchase has unresolved or confirmed legs')
      break
    case 'cancelled_before_submission':
      if (!cancelled || confirmed > 0 || submitted || blocked)
        throw corrupt('cancelled purchase has submitted or confirmed legs')
      break
    case 'submission_outcome_uncertain':
      if (!states.includes('submission_outcome_uncertain') || states.includes('reconciliation_required'))
        throw corrupt('uncertain purchase has an invalid leg matrix')
      break
    case 'reconciliation_required':
      if (!blocked) throw corrupt('reconciliation purchase has no blocked leg')
      break
    case 'partially_completed':
      if (confirmed === 0 || !unresolvedOrFailed) throw corrupt('partial purchase lacks confirmed and unresolved legs')
      break
    case 'completed':
      if (confirmed !== states.length) throw corrupt('completed purchase has unconfirmed legs')
      break
  }
}

function validateLegTransitions(previous: C3CoreMainnetPurchaseIntent, next: C3CoreMainnetPurchaseIntent) {
  for (const id of LEG_IDS) {
    const from = previous.legs[id].state
    const to = next.legs[id].state
    if (from !== to && !LEG_TRANSITIONS[from].includes(to))
      throw new C3PersistenceError('storage_conflict', `Invalid leg transition: ${from} -> ${to}`)
    if (from === 'confirmed' && JSON.stringify(previous.legs[id]) !== JSON.stringify(next.legs[id]))
      throw new C3PersistenceError('storage_conflict', 'A confirmed leg is immutable.')
  }
}

function assertImmutableIntentFields(previous: C3CoreMainnetPurchaseIntent, next: C3CoreMainnetPurchaseIntent) {
  if (
    previous.id !== next.id ||
    previous.walletAddress !== next.walletAddress ||
    previous.cluster !== next.cluster ||
    previous.totalUsdcBaseUnits !== next.totalUsdcBaseUnits ||
    previous.basketVersion !== next.basketVersion ||
    previous.createdAt !== next.createdAt
  ) {
    throw new C3PersistenceError('storage_conflict', 'C3 purchase intent fields are immutable.')
  }
  for (const id of LEG_IDS) {
    const before = previous.legs[id]
    const after = next.legs[id]
    if (
      before.id !== after.id ||
      before.order !== after.order ||
      before.inputMint !== after.inputMint ||
      before.outputMint !== after.outputMint ||
      before.destination !== after.destination ||
      before.allocationUsdcBaseUnits !== after.allocationUsdcBaseUnits ||
      JSON.stringify(before.authorizationManifest) !== JSON.stringify(after.authorizationManifest)
    ) {
      throw new C3PersistenceError('storage_conflict', `C3 ${id} leg intent fields are immutable.`)
    }
  }
}

function validateRecoveryRecord(value: unknown, label: string): asserts value is C3CoreMainnetRecoveryRecord {
  if (!isRecord(value)) throw corrupt(`${label} is invalid`)
  assertExactKeys(value, ['kind', 'reason', 'createdAt', 'expiresAt', 'attempts', 'maxAttempts'])
  if (value.kind !== 'bounded_review' || !RECOVERY_REASONS.has(value.reason as string))
    throw corrupt(`${label} is invalid`)
  const createdAt = expectTimestamp(value.createdAt, `${label} createdAt`)
  const expiresAt = expectTimestamp(value.expiresAt, `${label} expiresAt`)
  const attempts = expectInteger(value.attempts, `${label} attempts`)
  const maxAttempts = expectInteger(value.maxAttempts, `${label} maxAttempts`)
  if (expiresAt < createdAt || expiresAt - createdAt > 24 * 60 * 60 * 1000)
    throw corrupt(`${label} has an unbounded expiry window`)
  if (maxAttempts < 1 || maxAttempts > 3 || attempts < 0 || attempts > maxAttempts)
    throw corrupt(`${label} has an invalid retry budget`)
}

function validateFinalizedEvidence(value: unknown, label: string): asserts value is C3CoreMainnetFinalizedEvidence {
  if (!isRecord(value)) throw corrupt(`${label} is invalid`)
  assertExactKeys(value, ['status', 'verifiedAt', 'fingerprint'])
  if (value.status !== 'finalized') throw corrupt(`${label} is not finalized evidence`)
  expectTimestamp(value.verifiedAt, `${label} verifiedAt`)
  const fingerprint = expectString(value.fingerprint, `${label} fingerprint`)
  if (fingerprint.length > 4096) throw corrupt(`${label} fingerprint is too large`)
}

function validateAuthorizationManifest(value: unknown, label: string): asserts value is C3MainnetAuthorizationManifest {
  if (!isRecord(value)) throw corrupt(`${label} is invalid`)
  const required = [
    'version',
    'leg',
    'walletAddress',
    'feePayer',
    'requiredSignerAddresses',
    'staticAccountKeys',
    'messageHeader',
    'addressLookupTables',
    'outerInstructions',
    'approvedRouteProgramIds',
    'jupiterProgramId',
    'inputMint',
    'inputAccount',
    'inputAmountBaseUnits',
    'outputMint',
    'outputDestination',
    'minimumOutputBaseUnits',
    'recentBlockhash',
    'lastValidBlockHeight',
    'minContextSlot',
    'messageFingerprint',
  ]
  assertExactKeys(value, required, ['temporaryWsolAccount'])
  if (value.version !== 1 || !['cbBTC', 'portalETH', 'SOL'].includes(value.leg as string))
    throw corrupt(`${label} version or leg is invalid`)
  expectPublicKey(value.walletAddress, `${label} wallet`)
  expectPublicKey(value.feePayer, `${label} fee payer`)
  if (
    !Array.isArray(value.requiredSignerAddresses) ||
    !value.requiredSignerAddresses.every((item) => typeof item === 'string')
  )
    throw corrupt(`${label} signers are invalid`)
  if (
    value.feePayer !== value.walletAddress ||
    value.requiredSignerAddresses.length !== 1 ||
    value.requiredSignerAddresses[0] !== value.walletAddress
  )
    throw corrupt(`${label} is not user-only`)
  if (!Array.isArray(value.staticAccountKeys) || !value.staticAccountKeys.every(isManifestAccount))
    throw corrupt(`${label} static account keys are invalid`)
  if (
    !isRecord(value.messageHeader) ||
    !Number.isSafeInteger(value.messageHeader.numRequiredSignatures) ||
    !Number.isSafeInteger(value.messageHeader.numReadonlySignedAccounts) ||
    !Number.isSafeInteger(value.messageHeader.numReadonlyUnsignedAccounts) ||
    value.messageHeader.numRequiredSignatures < 1 ||
    value.messageHeader.numReadonlySignedAccounts < 0 ||
    value.messageHeader.numReadonlyUnsignedAccounts < 0
  )
    throw corrupt(`${label} message header is invalid`)
  if (!Array.isArray(value.addressLookupTables) || !value.addressLookupTables.every(isManifestLookupTable))
    throw corrupt(`${label} lookup tables are invalid`)
  if (!Array.isArray(value.outerInstructions) || !value.outerInstructions.every(isManifestInstruction))
    throw corrupt(`${label} outer instructions are invalid`)
  if (!Array.isArray(value.approvedRouteProgramIds) || !value.approvedRouteProgramIds.every(isPublicKeyString))
    throw corrupt(`${label} route program registry is invalid`)
  expectPublicKey(value.jupiterProgramId, `${label} Jupiter program`)
  expectPublicKey(value.inputMint, `${label} input mint`)
  expectPublicKey(value.inputAccount, `${label} input account`)
  expectBaseUnits(value.inputAmountBaseUnits, `${label} input amount`)
  expectPublicKey(value.outputMint, `${label} output mint`)
  expectPublicKey(value.outputDestination, `${label} output destination`)
  expectBaseUnits(value.minimumOutputBaseUnits, `${label} minimum output`)
  if (value.temporaryWsolAccount !== undefined) expectPublicKey(value.temporaryWsolAccount, `${label} WSOL account`)
  expectString(value.recentBlockhash, `${label} recent blockhash`)
  if (!Number.isSafeInteger(value.lastValidBlockHeight) || value.lastValidBlockHeight <= 0)
    throw corrupt(`${label} blockhash expiry is invalid`)
  if (!Number.isSafeInteger(value.minContextSlot) || value.minContextSlot < 0)
    throw corrupt(`${label} context slot is invalid`)
  if (!/^[a-f0-9]{64}$/.test(String(value.messageFingerprint))) throw corrupt(`${label} fingerprint is invalid`)
}

function isPublicKeyString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}

function isManifestAccount(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPublicKeyString(value.address) &&
    typeof value.isSigner === 'boolean' &&
    typeof value.isWritable === 'boolean'
  )
}

function isManifestInstruction(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.index) &&
    value.index >= 0 &&
    isPublicKeyString(value.programId) &&
    Array.isArray(value.accounts) &&
    value.accounts.every(isManifestAccount) &&
    typeof value.dataBase64 === 'string'
  )
}

function isManifestLookupTable(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPublicKeyString(value.address) &&
    Array.isArray(value.writableIndexes) &&
    Array.isArray(value.readonlyIndexes) &&
    Array.isArray(value.addresses) &&
    Array.isArray(value.loadedWritableAddresses) &&
    Array.isArray(value.loadedReadonlyAddresses) &&
    [...value.writableIndexes, ...value.readonlyIndexes].every((index) => Number.isSafeInteger(index) && index >= 0) &&
    [...value.addresses, ...value.loadedWritableAddresses, ...value.loadedReadonlyAddresses].every(isPublicKeyString)
  )
}

function parseDocument(raw: string | null): PersistedDocument | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw corrupt('persisted C3 JSON is malformed')
  }
  if (!isRecord(value)) throw corrupt('persisted C3 document is not an object')
  assertExactKeys(value, ['schemaVersion', 'revision', 'intents'])
  if (value.schemaVersion !== C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION) throw unsupportedSchema()
  const revision = expectInteger(value.revision, 'document revision')
  if (revision < 0) throw corrupt('document revision is negative')
  if (!Array.isArray(value.intents)) throw corrupt('persisted intents are not an array')
  const intents = value.intents.map(validateC3PersistedPurchaseIntent)
  const ids = new Set<string>()
  for (const intent of intents) {
    if (ids.has(intent.id)) throw corrupt('duplicate persisted intent identifier')
    ids.add(intent.id)
    if (intent.revision > revision) throw corrupt('intent revision exceeds document revision')
  }
  return { schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION, revision, intents }
}

function parseLegacyDocument(raw: string | null): PersistedDocument | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw corrupt('legacy persisted C3 JSON is malformed')
  }
  if (!isRecord(value)) throw corrupt('legacy persisted C3 document is not an object')
  assertExactKeys(value, ['schemaVersion', 'revision', 'intents'])
  if (value.schemaVersion !== 2) throw unsupportedSchema()
  const revision = expectInteger(value.revision, 'legacy document revision')
  if (revision < 0 || !Array.isArray(value.intents)) throw corrupt('legacy persisted C3 document is invalid')
  const intents = value.intents.map(migrateC3PersistedPurchaseIntent)
  const ids = new Set<string>()
  for (const intent of intents) {
    if (ids.has(intent.id)) throw corrupt('duplicate legacy persisted intent identifier')
    ids.add(intent.id)
    if (intent.revision > revision) throw corrupt('legacy intent revision exceeds document revision')
  }
  return { schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION, revision, intents }
}

function emptyDocument(): PersistedDocument {
  return { schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION, revision: 0, intents: [] }
}

function associatedTokenAddress(id: C3CoreMainnetLegId, walletAddress: string): string {
  const mint = id === 'cbBTC' ? C3_CORE_MAINNET_ASSETS.cbBTC : C3_CORE_MAINNET_ASSETS.portalETH
  const wallet = new PublicKey(walletAddress)
  const token = new PublicKey(mint)
  const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  const associatedProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  return PublicKey.findProgramAddressSync(
    [wallet.toBytes(), tokenProgram.toBytes(), token.toBytes()],
    associatedProgram,
  )[0].toBase58()
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw corrupt(`unexpected persisted field: ${key}`)
  for (const key of required) if (!(key in value)) throw corrupt(`missing persisted field: ${key}`)
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw corrupt(`${label} is invalid`)
  return value
}

function expectInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw corrupt(`${label} is invalid`)
  return value
}

function expectTimestamp(value: unknown, label: string): number {
  const timestamp = expectInteger(value, label)
  if (timestamp < 0) throw corrupt(`${label} is negative`)
  return timestamp
}

function expectBaseUnits(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value))
    throw corrupt(`${label} is not canonical base units`)
  try {
    return BigInt(value)
  } catch {
    throw corrupt(`${label} is outside the supported integer range`)
  }
}

function expectPublicKey(value: unknown, label: string): string {
  const text = expectString(value, label)
  try {
    const key = new PublicKey(text)
    if (key.toBase58() !== text) throw new Error('non-canonical')
  } catch {
    throw corrupt(`${label} is malformed`)
  }
  return text
}

function validateSignature(value: unknown, label: string) {
  const text = expectString(value, label)
  try {
    if (bs58.decode(text).length !== 64) throw new Error('wrong signature length')
  } catch {
    throw corrupt(`${label} is malformed`)
  }
}

function corrupt(message: string): C3PersistenceError {
  return new C3PersistenceError('corrupt_state', `Quarantined C3 state; review required: ${message}`)
}

function unsupportedSchema(): C3PersistenceError {
  return new C3PersistenceError('unsupported_schema_version', 'Unsupported C3 persisted-state schema version.')
}
