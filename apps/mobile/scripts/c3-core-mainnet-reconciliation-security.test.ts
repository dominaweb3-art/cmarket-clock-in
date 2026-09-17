import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import {
  getC3MainnetEvidenceFingerprint,
  reconcileC3MainnetSignature,
  verifyC3MainnetTransactionEvidence,
  type C3MainnetConfirmationProvider,
  type C3MainnetTransactionEvidence,
} from '../services/c3-core-mainnet-reconciliation.ts'
import {
  fingerprintC3AuthorizationMessage,
  type C3MainnetAuthorizationManifest,
} from '../services/c3-core-mainnet-manifest.ts'
import {
  assertC3VersionedTransactionFits,
  C3TransactionSizeError,
  C3_MAINNET_ROUTE_ACCOUNT_LIMITS,
  estimateC3VersionedTransactionBytes,
} from '../services/c3-core-mainnet-validation.ts'
import {
  createOversizedPortalEthTransaction,
  REALISTIC_FIXTURE_CBBTC_DESTINATION,
  REALISTIC_FIXTURE_ETH_DESTINATION,
  REALISTIC_FIXTURE_ROUTE_PROGRAM,
  REALISTIC_FIXTURE_SIGNATURE,
  REALISTIC_FIXTURE_WALLET,
  REALISTIC_FIXTURE_WSOL_DESTINATION,
  realisticC3Evidence,
} from './fixtures/c3-core-mainnet-realistic-fixtures.ts'

const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (actual !== expected) throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`)
  },
  deepEqual(actual: unknown, expected: unknown, message?: string) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message ?? 'Expected values to match')
  },
  ok(value: unknown, message?: string) {
    if (!value) throw new Error(message ?? 'Expected a truthy value')
  },
  match(value: string, pattern: RegExp) {
    if (!pattern.test(value)) throw new Error(`Expected ${value} to match ${pattern}`)
  },
  throws(callback: () => unknown, predicate: (error: unknown) => boolean) {
    let thrown: unknown
    try {
      callback()
    } catch (error) {
      thrown = error
    }
    if (!thrown || !predicate(thrown)) throw new Error('Expected callback to throw the requested error')
  },
}

const jupiter = C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6

function expectation(leg: 'cbBTC' | 'portalETH' | 'SOL') {
  const outputMint =
    leg === 'cbBTC'
      ? C3_CORE_MAINNET_CONFIG.assets.cbBTC
      : leg === 'portalETH'
        ? C3_CORE_MAINNET_CONFIG.assets.portalETH
        : C3_CORE_MAINNET_CONFIG.assets.wSOL
  const destination =
    leg === 'cbBTC'
      ? REALISTIC_FIXTURE_CBBTC_DESTINATION
      : leg === 'portalETH'
        ? REALISTIC_FIXTURE_ETH_DESTINATION
        : REALISTIC_FIXTURE_WALLET
  return {
    leg,
    walletAddress: REALISTIC_FIXTURE_WALLET,
    inputMint: C3_CORE_MAINNET_CONFIG.assets.input,
    inputAmountBaseUnits: leg === 'cbBTC' ? '20000000' : '15000000',
    outputMint,
    destination,
    minimumOutputBaseUnits: leg === 'SOL' ? '15000000' : '26000',
    jupiterProgramId: jupiter,
    approvedRouteProgramIds: [REALISTIC_FIXTURE_ROUTE_PROGRAM],
    ...(leg === 'SOL' ? { temporaryWsolAccount: REALISTIC_FIXTURE_WSOL_DESTINATION } : {}),
  } as const
}

function evidence(leg: 'cbBTC' | 'portalETH' | 'SOL', overrides: Partial<C3MainnetTransactionEvidence> = {}) {
  return { ...realisticC3Evidence(leg), ...overrides }
}

function manifestFixture() {
  const base = evidence('cbBTC')
  const raw = base.raw
  const staticAccountKeys = raw.accountKeys
    .filter((account) => account.source === 'transaction')
    .map(({ address, isSigner, isWritable }) => ({ address, isSigner, isWritable }))
  const messageHeader = { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 }
  const outerInstructions = raw.outerInstructions.map((instruction) => ({
    index: instruction.index,
    programId: instruction.programId,
    accounts: instruction.accountAddresses.map((address) => {
      const key = raw.accountKeys.find((candidate) => candidate.address === address)
      return { address, isSigner: key?.isSigner ?? false, isWritable: key?.isWritable ?? false }
    }),
    dataBase64: instruction.dataBase64,
  }))
  const addressLookupTables = raw.addressLookupTables.map((table) => ({
    address: table.address,
    writableIndexes: table.writableIndexes,
    readonlyIndexes: table.readonlyIndexes,
    addresses: table.addresses,
    loadedWritableAddresses: table.loadedWritableAddresses,
    loadedReadonlyAddresses: table.loadedReadonlyAddresses,
  }))
  const recentBlockhash = '11111111111111111111111111111111'
  const messageFingerprint = fingerprintC3AuthorizationMessage({
    version: 0,
    header: messageHeader,
    recentBlockhash,
    staticAccountKeys,
    messageHeader,
    addressLookupTables,
    outerInstructions,
  })
  const manifest: C3MainnetAuthorizationManifest = {
    version: 1,
    leg: 'cbBTC',
    walletAddress: REALISTIC_FIXTURE_WALLET,
    feePayer: REALISTIC_FIXTURE_WALLET,
    requiredSignerAddresses: [REALISTIC_FIXTURE_WALLET],
    staticAccountKeys,
    messageHeader,
    addressLookupTables,
    outerInstructions,
    approvedRouteProgramIds: [REALISTIC_FIXTURE_ROUTE_PROGRAM],
    jupiterProgramId: C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6,
    inputMint: C3_CORE_MAINNET_CONFIG.assets.input,
    inputAccount: 'GzHwuZ17v1L3avncqgpbmkFMwHThDRKntWQqVRSdwkHc',
    inputAmountBaseUnits: '20000000',
    outputMint: C3_CORE_MAINNET_CONFIG.assets.cbBTC,
    outputDestination: REALISTIC_FIXTURE_CBBTC_DESTINATION,
    minimumOutputBaseUnits: '26000',
    recentBlockhash,
    lastValidBlockHeight: 200,
    minContextSlot: 100,
    messageFingerprint,
  }
  return {
    manifest,
    evidence: evidence('cbBTC', {
      raw: {
        ...raw,
        messageVersion: 0,
        recentBlockhash,
        requiredSignerCount: 1,
        messageHeader,
        staticAccountKeys: raw.accountKeys.filter((account) => account.source === 'transaction'),
      },
    }),
  }
}

for (const leg of ['cbBTC', 'portalETH', 'SOL'] as const) {
  const verified = verifyC3MainnetTransactionEvidence(evidence(leg), {
    ...expectation(leg),
    signature: REALISTIC_FIXTURE_SIGNATURE,
  })
  assert.equal(verified.status, 'confirmed', `${leg} realistic fixture must verify`)
}

const bound = manifestFixture()
const boundExpectation = {
  ...expectation('cbBTC'),
  inputAccount: bound.manifest.inputAccount,
  authorizationManifest: bound.manifest,
  signature: REALISTIC_FIXTURE_SIGNATURE,
}
const boundResult = verifyC3MainnetTransactionEvidence(bound.evidence, boundExpectation)
assert.equal(boundResult.status, 'confirmed', JSON.stringify(boundResult.issues))
const missingRouteEvidence = verifyC3MainnetTransactionEvidence(
  { ...bound.evidence, executableProgramIds: undefined },
  boundExpectation,
)
assert.equal(missingRouteEvidence.status, 'reconciliation_required', 'missing route evidence must fail closed')
for (const [name, outerInstructions] of [
  [
    'modified outer Jupiter data',
    bound.evidence.raw.outerInstructions.map((instruction, index) =>
      index === 1 ? { ...instruction, dataBase64: 'AQID' } : instruction,
    ),
  ],
  ['reordered outer instructions', [...bound.evidence.raw.outerInstructions].reverse()],
  [
    'extra outer account',
    bound.evidence.raw.outerInstructions.map((instruction, index) =>
      index === 1
        ? { ...instruction, accountAddresses: [...instruction.accountAddresses, REALISTIC_FIXTURE_ROUTE_PROGRAM] }
        : instruction,
    ),
  ],
] as const) {
  const hostile = verifyC3MainnetTransactionEvidence(
    { ...bound.evidence, raw: { ...bound.evidence.raw, outerInstructions } },
    boundExpectation,
  )
  assert.equal(hostile.status, 'reconciliation_required', `${name} must fail closed`)
}

const extraTokenAccount = '9dYjA7v6c7NfLh4d3hCkYQ1FQvYw8GqN6oP3rT2sU1V'
const extraDebit = verifyC3MainnetTransactionEvidence(
  {
    ...bound.evidence,
    raw: {
      ...bound.evidence.raw,
      accountKeys: [
        ...bound.evidence.raw.accountKeys,
        { address: extraTokenAccount, isSigner: false, isWritable: true, source: 'transaction' },
      ],
      preTokenBalances: [
        ...bound.evidence.raw.preTokenBalances,
        {
          accountIndex: bound.evidence.raw.accountKeys.length,
          mint: C3_CORE_MAINNET_CONFIG.assets.portalETH,
          owner: REALISTIC_FIXTURE_WALLET,
          amountBaseUnits: '100',
        },
      ],
      postTokenBalances: [
        ...bound.evidence.raw.postTokenBalances,
        {
          accountIndex: bound.evidence.raw.accountKeys.length,
          mint: C3_CORE_MAINNET_CONFIG.assets.portalETH,
          owner: REALISTIC_FIXTURE_WALLET,
          amountBaseUnits: '0',
        },
      ],
      preLamportBalances: [...bound.evidence.raw.preLamportBalances, '0'],
      postLamportBalances: [...bound.evidence.raw.postLamportBalances, '0'],
    },
  },
  boundExpectation,
)
assert.equal(extraDebit.status, 'reconciliation_required', 'extra user-owned token debit must fail closed')

const maliciousInnerTransfer = evidence('cbBTC', {
  raw: {
    ...realisticC3Evidence('cbBTC').raw,
    innerInstructions: realisticC3Evidence('cbBTC').raw.innerInstructions.map((instruction, index) =>
      index === 2
        ? { ...instruction, accountAddresses: [instruction.accountAddresses[0], REALISTIC_FIXTURE_ETH_DESTINATION] }
        : instruction,
    ),
  },
})
assert.equal(
  verifyC3MainnetTransactionEvidence(maliciousInnerTransfer, {
    ...expectation('cbBTC'),
    signature: REALISTIC_FIXTURE_SIGNATURE,
  }).status,
  'reconciliation_required',
)

const maliciousAlt = evidence('cbBTC', {
  raw: {
    ...realisticC3Evidence('cbBTC').raw,
    addressLookupTables: [
      { ...realisticC3Evidence('cbBTC').raw.addressLookupTables[0], owner: C3_CORE_MAINNET_CONFIG.programs.system },
    ],
  },
})
assert.equal(
  verifyC3MainnetTransactionEvidence(maliciousAlt, {
    ...expectation('cbBTC'),
    signature: REALISTIC_FIXTURE_SIGNATURE,
  }).status,
  'reconciliation_required',
)

const missingInner = evidence('cbBTC', {
  raw: { ...realisticC3Evidence('cbBTC').raw, innerInstructions: [] },
})
assert.equal(
  verifyC3MainnetTransactionEvidence(missingInner, {
    ...expectation('cbBTC'),
    signature: REALISTIC_FIXTURE_SIGNATURE,
  }).status,
  'reconciliation_required',
)

const wrongOutput = evidence('cbBTC', {
  output: {
    owner: REALISTIC_FIXTURE_WALLET,
    mint: C3_CORE_MAINNET_CONFIG.assets.cbBTC,
    amountBaseUnits: '26000',
    destination: REALISTIC_FIXTURE_ETH_DESTINATION,
  },
})
assert.equal(
  verifyC3MainnetTransactionEvidence(wrongOutput, {
    ...expectation('cbBTC'),
    signature: REALISTIC_FIXTURE_SIGNATURE,
  }).status,
  'reconciliation_required',
)

const treasuryReference = verifyC3MainnetTransactionEvidence(evidence('cbBTC'), {
  ...expectation('cbBTC'),
  signature: REALISTIC_FIXTURE_SIGNATURE,
  treasuryAddress: REALISTIC_FIXTURE_ROUTE_PROGRAM,
})
assert.equal(treasuryReference.status, 'reconciliation_required')

const provider = (
  providerId: string,
  item: C3MainnetTransactionEvidence,
  endpoint = `https://${providerId}.example.invalid/rpc`,
): C3MainnetConfirmationProvider => ({
  providerId,
  operatorMetadata: {
    operatorId: `operator-${providerId}`,
    reviewed: true,
    reviewReference: `review-${providerId}`,
  },
  endpoint,
  cluster: 'mainnet-beta',
  async getFinalizedTransaction() {
    return item
  },
})

const expected = expectation('portalETH')
const duplicateId = await reconcileC3MainnetSignature(
  [
    provider('same', evidence('portalETH')),
    provider('same', evidence('portalETH'), 'https://other.example.invalid/rpc'),
  ],
  REALISTIC_FIXTURE_SIGNATURE,
  expected,
)
assert.equal(duplicateId.status, 'reconciliation_required')

const duplicateEndpoint = await reconcileC3MainnetSignature(
  [
    provider('rpc-a', evidence('portalETH'), 'https://same.example.invalid/rpc'),
    provider('rpc-b', evidence('portalETH'), 'https://same.example.invalid/rpc/'),
  ],
  REALISTIC_FIXTURE_SIGNATURE,
  expected,
)
assert.equal(duplicateEndpoint.status, 'reconciliation_required')

const disagreement = await reconcileC3MainnetSignature(
  [
    provider('rpc-a', evidence('portalETH')),
    provider('rpc-b', evidence('portalETH', { blockTimeMs: 1_700_000_000_001 })),
  ],
  REALISTIC_FIXTURE_SIGNATURE,
  expected,
)
assert.equal(disagreement.status, 'reconciliation_required')

const matching = await reconcileC3MainnetSignature(
  [provider('rpc-a', evidence('portalETH')), provider('rpc-b', evidence('portalETH'))],
  REALISTIC_FIXTURE_SIGNATURE,
  expected,
)
assert.equal(matching.status, 'confirmed')
assert.equal(matching.evidenceFingerprints?.length, 2)
assert.match(getC3MainnetEvidenceFingerprint(evidence('portalETH'), 'rpc-a'), /"providerId":"rpc-a"/)
assert.match(getC3MainnetEvidenceFingerprint(evidence('portalETH'), 'rpc-a'), /"blockTimeMs":1700000000000/)

const httpProvider = await reconcileC3MainnetSignature(
  [
    provider('rpc-a', evidence('portalETH'), 'http://rpc-a.example.invalid/rpc'),
    provider('rpc-b', evidence('portalETH')),
  ],
  REALISTIC_FIXTURE_SIGNATURE,
  expected,
)
assert.equal(httpProvider.status, 'reconciliation_required')
const sameOperator = await reconcileC3MainnetSignature(
  [
    provider('rpc-a', evidence('portalETH')),
    {
      ...provider('rpc-b', evidence('portalETH')),
      operatorMetadata: { operatorId: 'operator-rpc-a', reviewed: true, reviewReference: 'review-rpc-b' },
    },
  ],
  REALISTIC_FIXTURE_SIGNATURE,
  expected,
)
assert.equal(sameOperator.status, 'reconciliation_required')
const unreviewedOperator = await reconcileC3MainnetSignature(
  [
    provider('rpc-a', evidence('portalETH')),
    {
      ...provider('rpc-b', evidence('portalETH')),
      operatorMetadata: { operatorId: 'operator-rpc-b', reviewed: false as unknown as true, reviewReference: '' },
    },
  ],
  REALISTIC_FIXTURE_SIGNATURE,
  expected,
)
assert.equal(unreviewedOperator.status, 'reconciliation_required')

const oversizedPortalEth = createOversizedPortalEthTransaction()
assert.deepEqual(C3_MAINNET_ROUTE_ACCOUNT_LIMITS, [64, 48, 32])
assert.ok(estimateC3VersionedTransactionBytes(oversizedPortalEth) > 1232)
assert.throws(
  () => assertC3VersionedTransactionFits(oversizedPortalEth),
  (error: unknown) => error instanceof C3TransactionSizeError && error.code === 'c3_route_too_large',
)
let walletCallbackInvoked = false
try {
  assertC3VersionedTransactionFits(oversizedPortalEth)
} catch (error) {
  assert.equal(error instanceof C3TransactionSizeError, true)
  assert.equal(walletCallbackInvoked, false)
}

console.log(
  'C3 reconciliation, provider independence, malicious fixtures, fingerprints, and v0 size-boundary tests passed.',
)
