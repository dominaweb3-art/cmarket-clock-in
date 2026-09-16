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

export const C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION = 2 as const
export const C3_CORE_MAINNET_STORAGE_KEY = 'cmarket.c3-core-mainnet.purchase-intents.v2'
export const C3_CORE_MAINNET_STAGING_KEY = 'cmarket.c3-core-mainnet.purchase-intents.v2.staging'

export type C3CoreMainnetLegState =
  | 'pending'
  | 'awaiting_approval'
  | 'submitted_unconfirmed'
  | 'confirmed'
  | 'failed_on_chain'
  | 'cancelled_before_submission'
  | 'submission_outcome_uncertain'
  | 'reconciliation_required'

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
  'missing_minimum_output',
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
      if (existing.state === 'confirmed' && intent.state !== 'confirmed') {
        throw new C3PersistenceError('storage_conflict', 'A confirmed C3 purchase is immutable.')
      }
      if (existing.state !== intent.state) assertC3MainnetStateTransition(existing.state, intent.state)
      validateLegTransitions(existing, intent)
      const next = validateC3PersistedPurchaseIntent({ ...intent, revision: document.revision + 1 })
      const intents = document.intents.map((candidate) => (candidate.id === intent.id ? next : candidate))
      await this.writeDocument({
        schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION,
        revision: document.revision + 1,
        intents,
      })
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
      await this.writeDocument({
        schemaVersion: C3_CORE_MAINNET_PERSISTED_SCHEMA_VERSION,
        revision,
        intents: [intent, ...document.intents].slice(0, 20),
      })
      return intent
    })
  }

  private async readDocument(): Promise<PersistedDocument> {
    const raw = await this.storage.getItem(C3_CORE_MAINNET_STORAGE_KEY)
    const stagedRaw = await this.storage.getItem(C3_CORE_MAINNET_STAGING_KEY)
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
    return document ?? emptyDocument()
  }

  private async writeDocument(document: PersistedDocument): Promise<void> {
    const payload = JSON.stringify(document)
    try {
      await this.storage.setItem(C3_CORE_MAINNET_STAGING_KEY, payload)
      if ((await this.storage.getItem(C3_CORE_MAINNET_STAGING_KEY)) !== payload)
        throw new Error('staging verification failed')
      await this.storage.setItem(C3_CORE_MAINNET_STORAGE_KEY, payload)
      if ((await this.storage.getItem(C3_CORE_MAINNET_STORAGE_KEY)) !== payload)
        throw new Error('revision verification failed')
      await this.storage.removeItem(C3_CORE_MAINNET_STAGING_KEY)
    } catch (error) {
      throw new C3PersistenceError(
        'storage_write_failed',
        error instanceof Error ? error.message : 'storage write failed',
      )
    }
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
    ['signature', 'minimumOutputBaseUnits', 'confirmedOutputBaseUnits', 'errorCode'],
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
  if (value.errorCode !== undefined) {
    const errorCode = expectString(value.errorCode, `leg ${id} error code`)
    if (!ERROR_CODES.has(errorCode)) throw corrupt(`leg ${id} error code is not an approved diagnostic`)
  }
  if (
    ['submitted_unconfirmed', 'confirmed', 'failed_on_chain'].includes(value.state as string) &&
    value.signature === undefined
  ) {
    throw corrupt(`leg ${id} submitted state has no signature`)
  }
  if (
    value.state === 'confirmed' &&
    (value.minimumOutputBaseUnits === undefined || value.confirmedOutputBaseUnits === undefined)
  ) {
    throw corrupt(`leg ${id} confirmed state lacks output evidence`)
  }
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
  const blocked = states.some(
    (state) => state === 'submission_outcome_uncertain' || state === 'reconciliation_required',
  )
  if (blocked && ['draft', 'quoting', 'ready_for_review', 'awaiting_wallet'].includes(intent.state)) {
    throw corrupt('blocked leg cannot become executable without reconciliation')
  }
  if (intent.state === 'completed' && states.some((state) => state !== 'confirmed'))
    throw corrupt('completed purchase has unconfirmed legs')
  if (
    intent.state === 'submission_outcome_uncertain' &&
    !states.some((state) => state === 'submission_outcome_uncertain')
  )
    throw corrupt('uncertain purchase has no uncertain leg')
  if (
    intent.state === 'reconciliation_required' &&
    !states.some((state) => state === 'reconciliation_required' || state === 'submission_outcome_uncertain')
  )
    throw corrupt('reconciliation state has no blocked leg')
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
  return new C3PersistenceError('corrupt_state', message)
}

function unsupportedSchema(): C3PersistenceError {
  return new C3PersistenceError('unsupported_schema_version', 'Unsupported C3 persisted-state schema version.')
}
