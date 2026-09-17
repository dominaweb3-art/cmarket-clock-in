import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import {
  C3CoreMainnetStore,
  C3PersistenceError,
  migrateC3PersistedPurchaseIntent,
  C3_CORE_MAINNET_STORAGE_KEY,
  C3_CORE_MAINNET_STAGING_KEY,
  consumeC3RecoveryAttempt,
  createC3BoundedRecoveryRecord,
  type C3AsyncStorage,
  validateC3PersistedPurchaseIntent,
} from '../services/c3-core-mainnet-state.ts'
import {
  recoverC3MainnetSignature,
  reconcileC3MainnetSignature,
  verifyC3MainnetTransactionEvidence,
} from '../services/c3-core-mainnet-reconciliation.ts'
import type { C3MainnetTransactionEvidence } from '../services/c3-core-mainnet-reconciliation.ts'
import {
  REALISTIC_FIXTURE_CBBTC_DESTINATION,
  REALISTIC_FIXTURE_ROUTE_PROGRAM,
  REALISTIC_FIXTURE_SIGNATURE,
  REALISTIC_FIXTURE_WALLET,
  realisticC3Evidence,
} from './fixtures/c3-core-mainnet-realistic-fixtures.ts'

const wallet = REALISTIC_FIXTURE_WALLET
const signature = REALISTIC_FIXTURE_SIGNATURE
const secondSignature = 'AKAh9LUoWFG2sxAMotzmLNpKwPTCiG6Q4YTwAinZMnkvYKPAKVPwYSfoQDp8XLKWzpbCNx66XB1BrcD1ZUPqU39'
const minOutput = '26000'
const jupiter = C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6

const recoveryBoundary = createC3BoundedRecoveryRecord('reconciliation_required', 10_000)
assert(consumeC3RecoveryAttempt(recoveryBoundary, 10_000).record.attempts === 1, 'attempt 0 must be allowed')
assert(
  consumeC3RecoveryAttempt({ ...recoveryBoundary, attempts: 1 }, 10_000).record.attempts === 2,
  'attempt 1 must be allowed',
)
assert(
  consumeC3RecoveryAttempt({ ...recoveryBoundary, attempts: 2 }, 10_000).record.attempts === 3,
  'attempt 2 must be allowed',
)
assert(
  consumeC3RecoveryAttempt({ ...recoveryBoundary, attempts: 3 }, 10_000).status === 'exhausted',
  'attempt 3 must exhaust',
)
assert(
  consumeC3RecoveryAttempt({ ...recoveryBoundary, attempts: 2 }, recoveryBoundary.expiresAt).status === 'expired',
  'exact expiry must block',
)
assert(
  consumeC3RecoveryAttempt({ ...recoveryBoundary, attempts: 0 }, recoveryBoundary.expiresAt + 1).status === 'expired',
  'post-expiry must block',
)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function expectThrow(callback: () => unknown, message: string) {
  let thrown: unknown
  try {
    callback()
  } catch (error) {
    thrown = error
  }
  assert(thrown, message)
}

async function expectAsyncThrow(callback: () => Promise<unknown>, message: string) {
  let thrown: unknown
  try {
    await callback()
  } catch (error) {
    thrown = error
  }
  assert(thrown, message)
}

class MemoryStorage implements C3AsyncStorage {
  readonly values = new Map<string, string>()
  failWrites = false

  async getItem(key: string) {
    return this.values.get(key) ?? null
  }

  async setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('simulated storage failure')
    this.values.set(key, value)
  }

  async removeItem(key: string) {
    this.values.delete(key)
  }
}

function expectation(overrides: Partial<Parameters<typeof verifyC3MainnetTransactionEvidence>[1]> = {}) {
  return {
    leg: 'cbBTC' as const,
    walletAddress: wallet,
    inputMint: C3_CORE_MAINNET_CONFIG.assets.input,
    inputAmountBaseUnits: '20000000',
    outputMint: C3_CORE_MAINNET_CONFIG.assets.cbBTC,
    destination: REALISTIC_FIXTURE_CBBTC_DESTINATION,
    minimumOutputBaseUnits: minOutput,
    jupiterProgramId: jupiter,
    approvedRouteProgramIds: [REALISTIC_FIXTURE_ROUTE_PROGRAM],
    ...overrides,
  }
}

function evidence(overrides: Partial<C3MainnetTransactionEvidence> = {}): C3MainnetTransactionEvidence {
  return {
    ...realisticC3Evidence('cbBTC'),
    ...overrides,
  }
}

const valid = verifyC3MainnetTransactionEvidence(evidence(), { ...expectation(), signature })
assert(valid.status === 'confirmed', 'valid evidence must confirm')
for (const [name, override] of [
  ['wrong sender', { feePayer: '11111111111111111111111111111111' }],
  [
    'wrong mint',
    { input: { owner: wallet, mint: C3_CORE_MAINNET_CONFIG.assets.portalETH, amountBaseUnits: '20000000' } },
  ],
  [
    'wrong amount',
    { input: { owner: wallet, mint: C3_CORE_MAINNET_CONFIG.assets.input, amountBaseUnits: '20000001' } },
  ],
  [
    'output below minimum',
    {
      output: {
        owner: wallet,
        mint: C3_CORE_MAINNET_CONFIG.assets.cbBTC,
        amountBaseUnits: '1',
        destination: expectation().destination,
      },
    },
  ],
  [
    'missing output',
    {
      output: undefined,
      raw: {
        ...evidence().raw,
        preTokenBalances: evidence().raw.preTokenBalances.slice(0, 1),
        postTokenBalances: evidence().raw.postTokenBalances.slice(0, 1),
      },
    },
  ],
  ['missing effects', { effectsComplete: false }],
  ['unknown program', { unknownProgramIds: ['BadProgram11111111111111111111111111111111111'] }],
  ['undefined meta error', { metaErr: undefined }],
] as const) {
  assert(
    verifyC3MainnetTransactionEvidence(evidence(override), { ...expectation(), signature }).status ===
      'reconciliation_required',
    `${name} must fail closed`,
  )
}
assert(
  verifyC3MainnetTransactionEvidence(evidence({ metaErr: { InstructionError: [0, 'Custom'] } }), {
    ...expectation(),
    signature,
  }).status === 'failed_on_chain',
  'verified on-chain error must be failed_on_chain',
)

const provider = (name: string, item: C3MainnetTransactionEvidence, recent = false) => ({
  providerId: name,
  operatorMetadata: {
    operatorId: `operator-${name}`,
    reviewed: true as const,
    reviewReference: `review-${name}`,
  },
  endpoint: `https://${name}.example.invalid/rpc`,
  cluster: 'mainnet-beta' as const,
  async getFinalizedTransaction() {
    return item
  },
  ...(recent
    ? {
        async getRecentTransactions() {
          return [item]
        },
      }
    : {}),
})
const expected = expectation()
const quorum = await reconcileC3MainnetSignature(
  [provider('rpc-a', evidence()), provider('rpc-b', evidence())],
  signature,
  expected,
)
assert(quorum.status === 'confirmed', 'matching RPC providers must confirm')
const disagreement = await reconcileC3MainnetSignature(
  [provider('rpc-a', evidence()), provider('rpc-b', evidence({ slot: 101 }))],
  signature,
  expected,
)
assert(disagreement.status === 'reconciliation_required', 'conflicting RPC providers must block')
const timeout = await reconcileC3MainnetSignature(
  [
    provider('rpc-a', evidence()),
    {
      ...provider('rpc-b', evidence()),
      async getFinalizedTransaction() {
        throw new Error('timeout')
      },
    },
  ],
  signature,
  expected,
)
assert(timeout.status === 'reconciliation_required', 'RPC timeout must block')
const oneProvider = await reconcileC3MainnetSignature([provider('rpc-a', evidence())], signature, expected)
assert(oneProvider.status === 'reconciliation_required', 'one provider must fail closed')
const malformedProvider = await reconcileC3MainnetSignature(
  [provider('rpc-a', evidence()), provider('rpc-b', {} as C3MainnetTransactionEvidence)],
  signature,
  expected,
)
assert(malformedProvider.status === 'reconciliation_required', 'malformed provider response must block')
const recovered = await recoverC3MainnetSignature(provider('history', evidence({ blockTimeMs: 10_000 }), true), {
  ...expected,
  createdAtMs: 5_000,
  nowMs: 20_000,
})
assert(recovered.status === 'recovered' && recovered.signature === signature, 'one exact history match must recover')
const none = await recoverC3MainnetSignature(provider('history', evidence({ blockTimeMs: 400_000 }), true), {
  ...expected,
  createdAtMs: 5_000,
  nowMs: 20_000,
})
assert(none.status === 'none', 'out-of-window history must not match')
const ambiguous = await recoverC3MainnetSignature(
  {
    ...provider('history', evidence(), true),
    async getRecentTransactions() {
      return [evidence({ blockTimeMs: 10_000 }), evidence({ signature: secondSignature, blockTimeMs: 10_000 })]
    },
  },
  { ...expected, createdAtMs: 5_000, nowMs: 20_000 },
)
assert(ambiguous.status === 'ambiguous', 'multiple history matches must block')

const storage = new MemoryStorage()
const store = new C3CoreMainnetStore(storage)
const idGenerator = () => 'c3-core-mainnet-v1-' + 'a'.repeat(32)
const intent = await store.create({ walletAddress: wallet, totalUsdcBaseUnits: 50_000_000n, now: 10_000, idGenerator })
assert(intent.revision === 1 && intent.cluster === 'mainnet-beta', 'new intent must be versioned and clustered')
expectThrow(
  () => validateC3PersistedPurchaseIntent({ ...intent, schemaVersion: 99 }),
  'unknown schema must be rejected',
)
expectThrow(
  () => validateC3PersistedPurchaseIntent({ ...intent, walletAddress: 'not-a-wallet' }),
  'changed wallet must be rejected',
)
expectThrow(
  () => validateC3PersistedPurchaseIntent({ ...intent, totalUsdcBaseUnits: '51000000' }),
  'changed amount must be rejected',
)
expectThrow(
  () => validateC3PersistedPurchaseIntent({ ...intent, extraSecurityField: 'x' }),
  'extra fields must be rejected',
)
expectThrow(
  () =>
    validateC3PersistedPurchaseIntent({
      ...intent,
      legs: { ...intent.legs, cbBTC: { ...intent.legs.cbBTC, allocationUsdcBaseUnits: '1' } },
    }),
  'changed allocation must be rejected',
)
expectThrow(
  () =>
    validateC3PersistedPurchaseIntent({
      ...intent,
      legs: { ...intent.legs, cbBTC: { ...intent.legs.cbBTC, destination: wallet } },
    }),
  'changed destination must be rejected',
)
expectThrow(
  () =>
    validateC3PersistedPurchaseIntent({
      ...intent,
      legs: { ...intent.legs, cbBTC: { ...intent.legs.cbBTC, signature } },
    }),
  'forged pre-submission signature must be rejected',
)
const updated = { ...intent, state: 'quoting' as const, updatedAt: 10_001 }
const [firstWrite, secondWrite] = await Promise.allSettled([store.save(updated), store.save(updated)])
assert(
  firstWrite.status === 'fulfilled' && secondWrite.status === 'rejected',
  'stale concurrent write must be rejected',
)
assert(
  secondWrite.status === 'rejected' &&
    secondWrite.reason instanceof C3PersistenceError &&
    secondWrite.reason.code === 'storage_conflict',
  'stale write must expose conflict',
)
await expectAsyncThrow(
  () => store.create({ walletAddress: wallet, totalUsdcBaseUnits: 50_000_000n, idGenerator }),
  'duplicate intent IDs must be rejected',
)
storage.failWrites = true
await expectAsyncThrow(
  () =>
    store.create({
      walletAddress: wallet,
      totalUsdcBaseUnits: 50_000_000n,
      idGenerator: () => 'c3-core-mainnet-v1-' + 'b'.repeat(32),
    }),
  'storage failure must be surfaced',
)
storage.failWrites = false

const quoted = await store.get(intent.id)
assert(quoted, 'quoted intent must remain readable')
await expectAsyncThrow(
  () => store.save({ ...quoted, walletAddress: '11111111111111111111111111111111' }),
  'immutable wallet identity must be protected at save time',
)
const ready = await store.save({
  ...quoted,
  state: 'ready_for_review',
  updatedAt: 10_002,
  legs: {
    ...quoted.legs,
    cbBTC: { ...quoted.legs.cbBTC, state: 'awaiting_approval', minimumOutputBaseUnits: minOutput, updatedAt: 10_002 },
  },
})
const awaitingWallet = await store.save({ ...ready, state: 'awaiting_wallet', updatedAt: 10_003 })
const submitted = await store.save({
  ...awaitingWallet,
  state: 'submitted_unconfirmed',
  updatedAt: 10_004,
  legs: {
    ...awaitingWallet.legs,
    cbBTC: { ...awaitingWallet.legs.cbBTC, state: 'submitted_unconfirmed', signature, updatedAt: 10_004 },
  },
})
assert(
  (await new C3CoreMainnetStore(storage).get(intent.id))?.state === 'submitted_unconfirmed',
  'submitted state must survive app restart',
)
storage.failWrites = true
await expectAsyncThrow(
  () =>
    store.save({
      ...submitted,
      state: 'reconciliation_required',
      legs: {
        ...submitted.legs,
        cbBTC: { ...submitted.legs.cbBTC, state: 'reconciliation_required', updatedAt: 10_005 },
      },
    }),
  'storage failure after signature must be surfaced',
)
storage.failWrites = false
const blocked = await store.save({
  ...submitted,
  state: 'reconciliation_required',
  updatedAt: 10_006,
  legs: { ...submitted.legs, cbBTC: { ...submitted.legs.cbBTC, state: 'reconciliation_required', updatedAt: 10_006 } },
})
await expectAsyncThrow(
  () => store.save({ ...blocked, state: 'quoting', updatedAt: 10_007 }),
  'unreconciled state must not become executable',
)

const malformedStorage = new MemoryStorage()
malformedStorage.values.set(C3_CORE_MAINNET_STORAGE_KEY, '{')
await expectAsyncThrow(
  () => new C3CoreMainnetStore(malformedStorage).list(),
  'malformed persisted JSON must be rejected',
)
const stagedStorage = new MemoryStorage()
stagedStorage.values.set(C3_CORE_MAINNET_STAGING_KEY, JSON.stringify({ schemaVersion: 3, revision: 1, intents: [] }))
await expectAsyncThrow(
  () => new C3CoreMainnetStore(stagedStorage).list(),
  'interrupted staged write must require reconciliation',
)
const confirmedStorage = new MemoryStorage()
const confirmedLegs = Object.fromEntries(
  Object.entries(intent.legs).map(([id, leg]) => [
    id,
    {
      ...leg,
      state: 'confirmed',
      signature,
      minimumOutputBaseUnits: minOutput,
      confirmedOutputBaseUnits: minOutput,
      finalizedEvidence: { status: 'finalized', verifiedAt: 10_010, fingerprint: 'fixture-finalized-evidence' },
    },
  ]),
)
const completed = validateC3PersistedPurchaseIntent({ ...intent, state: 'completed', legs: confirmedLegs })
confirmedStorage.values.set(
  C3_CORE_MAINNET_STORAGE_KEY,
  JSON.stringify({ schemaVersion: 3, revision: 1, intents: [completed] }),
)
await expectAsyncThrow(
  () =>
    new C3CoreMainnetStore(confirmedStorage).save({
      ...completed,
      legs: { ...completed.legs, cbBTC: { ...completed.legs.cbBTC, confirmedOutputBaseUnits: '26001' } },
    }),
  'confirmed legs must be immutable',
)

const safeLegacyDraft = JSON.parse(JSON.stringify(intent)) as Record<string, unknown>
safeLegacyDraft.schemaVersion = 2
const migratedDraft = migrateC3PersistedPurchaseIntent(safeLegacyDraft)
assert(migratedDraft.schemaVersion === 3 && migratedDraft.state === 'draft', 'safe v2 draft must migrate to v3')
await expectAsyncThrow(
  () => Promise.resolve(migrateC3PersistedPurchaseIntent({ ...safeLegacyDraft, state: 'completed' })),
  'legacy completed purchase without finalized evidence must be quarantined',
)

const impossiblePartial = {
  ...intent,
  state: 'partially_completed' as const,
  legs: { ...intent.legs, cbBTC: { ...intent.legs.cbBTC, state: 'confirmed' as const } },
}
await expectAsyncThrow(
  () => Promise.resolve(validateC3PersistedPurchaseIntent(impossiblePartial)),
  'partial purchase without finalized evidence must be rejected',
)
await expectAsyncThrow(
  () =>
    Promise.resolve(
      validateC3PersistedPurchaseIntent({
        ...intent,
        legs: {
          ...intent.legs,
          cbBTC: {
            ...intent.legs.cbBTC,
            recovery: {
              kind: 'bounded_review',
              reason: 'wallet_interrupted',
              createdAt: 10_020,
              expiresAt: 10_020 + 60_000,
              attempts: 0,
              maxAttempts: 3,
            },
          },
        },
      }),
    ),
  'pending leg recovery evidence must be rejected',
)
await expectAsyncThrow(
  () =>
    Promise.resolve(
      validateC3PersistedPurchaseIntent({
        ...intent,
        legs: {
          ...intent.legs,
          cbBTC: {
            ...intent.legs.cbBTC,
            state: 'submitted_unconfirmed',
            signature,
            finalizedEvidence: {
              status: 'finalized',
              verifiedAt: 10_020,
              fingerprint: 'invalid-premature-finalized-evidence',
            },
          },
        },
      }),
    ),
  'finalized evidence outside confirmed state must be rejected',
)

console.log('C3 Mainnet recovery, persistence, quorum, and duplicate-prevention tests passed.')
