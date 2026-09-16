import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import {
  getC3MainnetEvidenceFingerprint,
  reconcileC3MainnetSignature,
  verifyC3MainnetTransactionEvidence,
  type C3MainnetConfirmationProvider,
  type C3MainnetTransactionEvidence,
} from '../services/c3-core-mainnet-reconciliation.ts'
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

for (const leg of ['cbBTC', 'portalETH', 'SOL'] as const) {
  const verified = verifyC3MainnetTransactionEvidence(evidence(leg), {
    ...expectation(leg),
    signature: REALISTIC_FIXTURE_SIGNATURE,
  })
  assert.equal(verified.status, 'confirmed', `${leg} realistic fixture must verify`)
}

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
