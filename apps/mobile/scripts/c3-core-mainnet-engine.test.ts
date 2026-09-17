import { fromUint8Array } from 'js-base64'
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import {
  allocateC3Core,
  assertC3MainnetExecution,
  assertC3MainnetStateTransition,
  canTransitionC3MainnetState,
  deriveC3PurchaseIntentId,
  isC3MainnetEnabled,
  nextC3MainnetPurchaseState,
  parseC3UsdcAmount,
} from '../services/c3-core-mainnet-core.ts'
import {
  decodeC3Blockhash,
  validateC3AddressLookupTableRecord,
  validateC3AddressLookupTables,
  validateC3CoreMainnetTransaction,
  type JupiterBuildResponse,
  type JupiterInstructionPayload,
} from '../services/c3-core-mainnet-validation.ts'
import { getAssociatedTokenAddressSync } from '../utils/spl-token-compatible.ts'

const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`)
  },
  throws(callback: () => unknown) {
    let threw = false
    try {
      callback()
    } catch {
      threw = true
    }
    if (!threw) throw new Error('Expected callback to throw')
  },
  doesNotThrow(callback: () => unknown) {
    callback()
  },
  match(value: string, pattern: RegExp) {
    if (!pattern.test(value)) throw new Error(`Expected ${value} to match ${pattern}`)
  },
}

const fiftyUsdc = 50_000_000n
const allocation = allocateC3Core(fiftyUsdc)
assert.equal(allocation.legs.cbBTC, 20_000_000n)
assert.equal(allocation.legs.portalETH, 15_000_000n)
assert.equal(allocation.legs.SOL, 15_000_000n)
assert.equal(allocation.legs.cbBTC + allocation.legs.portalETH + allocation.legs.SOL, allocation.totalUsdcBaseUnits)
assert.equal(parseC3UsdcAmount('50.000001'), 50_000_001n)
assert.equal(parseC3UsdcAmount('500'), 500_000_000n)
for (const malformed of ['', ' 50', '50 ', '+50', '-50', '1e2', 'NaN', 'Infinity', '50.1234567', '00']) {
  assert.throws(() => parseC3UsdcAmount(malformed))
}
assert.throws(() => allocateC3Core(49_999_999n))
assert.throws(() => allocateC3Core(500_000_001n))

const previousFlag = process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET
try {
  delete process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET
  assert.equal(isC3MainnetEnabled(), false)
  assert.throws(() => assertC3MainnetExecution('mainnet-beta'))
  process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET = 'TRUE'
  assert.equal(isC3MainnetEnabled(), false)
  assert.throws(() => assertC3MainnetExecution('mainnet-beta'))
  process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET = 'true'
  assert.equal(isC3MainnetEnabled(), false)
  assert.throws(() => assertC3MainnetExecution('mainnet-beta'))
  assert.throws(() => assertC3MainnetExecution('devnet'))
} finally {
  if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET
  else process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET = previousFlag
}

assert.equal(canTransitionC3MainnetState('draft', 'quoting'), true)
assert.equal(canTransitionC3MainnetState('completed', 'quoting'), false)
assert.equal(canTransitionC3MainnetState('confirmed', 'submitted_unconfirmed'), false)
assert.equal(nextC3MainnetPurchaseState({ confirmedLegs: 1, totalLegs: 3, failed: false }), 'partially_completed')
assert.equal(nextC3MainnetPurchaseState({ confirmedLegs: 1, totalLegs: 3, failed: true }), 'partially_completed')
assert.doesNotThrow(() => assertC3MainnetStateTransition('submitted_unconfirmed', 'confirmed'))
assert.throws(() => assertC3MainnetStateTransition('completed', 'submitted_unconfirmed'))

const intentInput = {
  walletAddress: 'Wallet1111111111111111111111111111111111111',
  totalUsdcBaseUnits: fiftyUsdc,
  createdAtMs: 1,
}
const deterministicId = () => 'c3-core-mainnet-v1-' + 'a'.repeat(32)
assert.equal(
  deriveC3PurchaseIntentId(intentInput, deterministicId),
  deriveC3PurchaseIntentId(intentInput, deterministicId),
)
assert.equal(decodeC3Blockhash(Array.from({ length: 32 }, () => 0)), '11111111111111111111111111111111')
assert.throws(() => decodeC3Blockhash([1, 2, 3]))

const wallet = new PublicKey('DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej')
const sourceToken = new PublicKey('GzHwuZ17v1L3avncqgpbmkFMwHThDRKntWQqVRSdwkHc')
const outputAta = getAssociatedTokenAddressSync(C3_CORE_MAINNET_CONFIG.cbBTCMint, wallet).toBase58()
const expectedWsolAccount = getAssociatedTokenAddressSync(C3_CORE_MAINNET_CONFIG.wrappedSolMint, wallet).toBase58()
const ammAccount = '8TxrtAxqA5PA2Y1d2pxzCz9SoDhjrBcYqNAQKVv6p443'
const approvedRouteProgram = '9xQeWvG816bUx9EPfP5uQ5aQJ7hXfD8h3WZ2kYp5u7V'
const eventAuthority = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf'
const routeDiscriminator = [187, 100, 250, 204, 49, 196, 175, 20]

function littleEndian(value: bigint, width: number): number[] {
  return Array.from({ length: width }, (_, index) => Number((value >> BigInt(index * 8)) & 255n))
}

function routeData(input: bigint, output: bigint, bps = 10_000, variant = 407): string {
  return fromUint8Array(
    Uint8Array.from([
      ...routeDiscriminator,
      ...littleEndian(input, 8),
      ...littleEndian(output, 8),
      ...littleEndian(100n, 2),
      ...littleEndian(0n, 2),
      ...littleEndian(0n, 2),
      ...littleEndian(1n, 4),
      ...littleEndian(BigInt(variant), 2),
      ...littleEndian(BigInt(bps), 2),
      0,
      1,
    ]),
  )
}

function meta(pubkey: string, isSigner = false, isWritable = false) {
  return { pubkey, isSigner, isWritable }
}

const validSwapInstruction: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6,
  accounts: [
    meta(wallet.toBase58(), true),
    meta(sourceToken.toBase58(), false, true),
    meta(outputAta, false, true),
    meta(C3_CORE_MAINNET_CONFIG.assets.input),
    meta(C3_CORE_MAINNET_CONFIG.assets.cbBTC),
    meta(C3_CORE_MAINNET_CONFIG.programs.token),
    meta(C3_CORE_MAINNET_CONFIG.programs.token),
    meta(C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6),
    meta(eventAuthority),
    meta(C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6),
    meta(ammAccount),
  ],
  data: routeData(20_000_000n, 26_474n),
}

const validBuild: JupiterBuildResponse = {
  inputMint: C3_CORE_MAINNET_CONFIG.assets.input,
  outputMint: C3_CORE_MAINNET_CONFIG.assets.cbBTC,
  inAmount: '20000000',
  outAmount: '26474',
  otherAmountThreshold: '26400',
  swapMode: 'ExactIn',
  slippageBps: 100,
  taker: wallet.toBase58(),
  priceImpactPct: '0.1',
  blockhashWithMetadata: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 },
  swapInstruction: validSwapInstruction,
  approvedRouteProgramIds: [approvedRouteProgram],
  routePlan: [
    {
      percent: 100,
      bps: 10_000,
      swapInfo: {
        ammKey: ammAccount,
        label: 'GoonFi V2',
        inputMint: C3_CORE_MAINNET_CONFIG.assets.input,
        outputMint: C3_CORE_MAINNET_CONFIG.assets.cbBTC,
        inAmount: '20000000',
        outAmount: '26474',
      },
    },
  ],
}

function transactionFor(
  instructions: ReadonlyArray<JupiterInstructionPayload>,
  lookupTables: AddressLookupTableAccount[] = [],
  payer = wallet,
) {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: instructions.map(
        (instruction) =>
          new TransactionInstruction({
            programId: new PublicKey(instruction.programId),
            keys: instruction.accounts.map((account) => ({
              pubkey: new PublicKey(account.pubkey),
              isSigner: account.isSigner,
              isWritable: account.isWritable,
            })),
            data: Buffer.from(instruction.data, 'base64'),
          }),
      ),
    }).compileToV0Message(lookupTables),
  )
}

function validationFor(build: JupiterBuildResponse, transaction = transactionFor([build.swapInstruction])) {
  return validationForLeg(build, 'cbBTC', 20_000_000n, transaction)
}

function validationForLeg(
  build: JupiterBuildResponse,
  leg: 'cbBTC' | 'portalETH' | 'SOL',
  inputAmountBaseUnits: bigint,
  transaction: VersionedTransaction,
  lookupTables: ReadonlyArray<AddressLookupTableAccount> = [],
) {
  return validateC3CoreMainnetTransaction({
    walletAddress: wallet.toBase58(),
    leg,
    inputAmountBaseUnits,
    build,
    transaction,
    lookupTables,
  })
}

const validValidation = validationFor(validBuild)
assert.equal(validValidation.passed, true)
assert.equal(validValidation.issues.length, 0)

function expectRejected(build: JupiterBuildResponse, transaction?: VersionedTransaction) {
  const result = validationFor(build, transaction)
  assert.equal(result.passed, false)
  return result.issues.join(' ')
}

const extraSystem: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.system,
  accounts: [meta(wallet.toBase58(), true, true), meta(expectedWsolAccount, false, true)],
  data: fromUint8Array(Uint8Array.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])),
}
expectRejected(
  { ...validBuild, otherInstructions: [extraSystem] },
  transactionFor([extraSystem, validBuild.swapInstruction]),
)

const extraTokenTransfer: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.token,
  accounts: [meta(sourceToken.toBase58(), false, true), meta(outputAta, false, true), meta(wallet.toBase58(), true)],
  data: fromUint8Array(Uint8Array.from([3, 1, 0, 0, 0, 0, 0, 0, 0])),
}
expectRejected(
  { ...validBuild, otherInstructions: [extraTokenTransfer] },
  transactionFor([extraTokenTransfer, validBuild.swapInstruction]),
)

const thirdPartyDestination = '11111111111111111111111111111112'
const thirdPartyBuild = {
  ...validBuild,
  swapInstruction: {
    ...validSwapInstruction,
    accounts: validSwapInstruction.accounts.map((account, index) =>
      index === 2 ? meta(thirdPartyDestination, false, true) : account,
    ),
  },
}
expectRejected(thirdPartyBuild, transactionFor([thirdPartyBuild.swapInstruction]))

const extraSignerBuild = {
  ...validBuild,
  swapInstruction: {
    ...validSwapInstruction,
    accounts: validSwapInstruction.accounts.map((account, index) => (index === 10 ? meta(ammAccount, true) : account)),
  },
}
expectRejected(extraSignerBuild, transactionFor([extraSignerBuild.swapInstruction]))
expectRejected(
  validBuild,
  transactionFor([validBuild.swapInstruction], [], new PublicKey('7Yj3Z4fYd4uP4d7p3Jj2WvG3QxWfRk9W6DqYxN7mM8sQ')),
)
expectRejected({ ...validBuild, inAmount: '20000001' })
expectRejected({ ...validBuild, outputMint: C3_CORE_MAINNET_CONFIG.assets.portalETH })
expectRejected({ ...validBuild, otherAmountThreshold: '26475' })
expectRejected({ ...validBuild, slippageBps: 101 })
expectRejected({ ...validBuild, taker: undefined as unknown as string })
expectRejected({ ...validBuild, swapMode: 'ExactOut' })
expectRejected({
  ...validBuild,
  routePlan: [{ ...validBuild.routePlan[0], swapInfo: { ...validBuild.routePlan[0].swapInfo, inAmount: '20000001' } }],
})
expectRejected({
  ...validBuild,
  swapInstruction: {
    ...validBuild.swapInstruction,
    data: routeData(20_000_000n, 1_500_000n, 10_000, 999),
  },
})

const unknownProgram: JupiterInstructionPayload = {
  programId: '11111111111111111111111111111112',
  accounts: [],
  data: fromUint8Array(Uint8Array.from([1])),
}
const unknownIssues = expectRejected(
  { ...validBuild, otherInstructions: [unknownProgram] },
  transactionFor([unknownProgram, validBuild.swapInstruction]),
)
assert.match(unknownIssues, /unknown or unsupported executable program ID/)

const closeAccount: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.token,
  accounts: [meta(outputAta, false, true), meta(wallet.toBase58(), false, true), meta(wallet.toBase58(), true)],
  data: fromUint8Array(Uint8Array.from([9])),
}
expectRejected(
  { ...validBuild, cleanupInstruction: closeAccount },
  transactionFor([validBuild.swapInstruction, closeAccount]),
)

const altKey = new PublicKey('9ztRVKk2uBJGJdHg5vuDA8TFMdP96eUgV2AvBzWCHopH')
const altAddress = new PublicKey('6gVvQNMBecUAqSswntizqMHy6QEJnsUryWLa4Us1Lva5')
const activeAlt = new AddressLookupTableAccount({
  key: altKey,
  state: {
    deactivationSlot: BigInt('18446744073709551615'),
    lastExtendedSlot: 1,
    lastExtendedSlotStartIndex: 0,
    addresses: [altAddress],
  },
})
const altInstruction: JupiterInstructionPayload = {
  ...validSwapInstruction,
  accounts: [...validSwapInstruction.accounts, meta(altAddress.toBase58())],
}
const altTransaction = transactionFor([altInstruction], [activeAlt])
assert.equal(validateC3AddressLookupTables(altTransaction, []).length > 0, true)
assert.equal(validateC3AddressLookupTables(altTransaction, [activeAlt]).length, 0)
const deactivatedAlt = new AddressLookupTableAccount({
  key: altKey,
  state: { ...activeAlt.state, deactivationSlot: 10n },
})
assert.equal(validateC3AddressLookupTableRecord(deactivatedAlt, altKey.toBase58(), 100).length > 0, true)

const fabricatedAlt = new AddressLookupTableAccount({
  key: new PublicKey('4uQe5vZ4uF3GJZ1m6xD8C9hY2wL7pR5sN8tV3bK6cQ1A'),
  state: {
    deactivationSlot: BigInt('18446744073709551615'),
    lastExtendedSlot: 1,
    lastExtendedSlotStartIndex: 0,
    addresses: [altAddress],
  },
})
const fabricatedAltTransaction = transactionFor([altInstruction], [fabricatedAlt])
assert.equal(validateC3AddressLookupTables(fabricatedAltTransaction, []).length > 0, true)

const solOutput = 100_000_000n
const solSwapInstruction: JupiterInstructionPayload = {
  ...validSwapInstruction,
  accounts: validSwapInstruction.accounts
    .map((account, index) => {
      if (index === 2) return meta(wallet.toBase58(), false, true)
      if (index === 4) return meta(C3_CORE_MAINNET_CONFIG.assets.wSOL)
      return account
    })
    .concat(meta(expectedWsolAccount, false, true)),
  data: routeData(15_000_000n, solOutput),
}
const solAtaSetup: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.associatedToken,
  accounts: [
    meta(wallet.toBase58(), true, true),
    meta(expectedWsolAccount, false, true),
    meta(wallet.toBase58()),
    meta(C3_CORE_MAINNET_CONFIG.assets.wSOL),
    meta(C3_CORE_MAINNET_CONFIG.programs.system),
    meta(C3_CORE_MAINNET_CONFIG.programs.token),
  ],
  data: fromUint8Array(Uint8Array.from([1])),
}
const solFunding: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.system,
  accounts: [meta(wallet.toBase58(), true, true), meta(expectedWsolAccount, false, true)],
  data: fromUint8Array(Uint8Array.from([2, 0, 0, 0, ...littleEndian(solOutput, 8)])),
}
const solSync: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.token,
  accounts: [meta(expectedWsolAccount, false, true)],
  data: fromUint8Array(Uint8Array.from([17])),
}
const solCleanup: JupiterInstructionPayload = {
  programId: C3_CORE_MAINNET_CONFIG.programs.token,
  accounts: [
    meta(expectedWsolAccount, false, true),
    meta(wallet.toBase58(), false, true),
    meta(wallet.toBase58(), true),
  ],
  data: fromUint8Array(Uint8Array.from([9])),
}
const solBuild: JupiterBuildResponse = {
  ...validBuild,
  outputMint: C3_CORE_MAINNET_CONFIG.assets.wSOL,
  inAmount: '15000000',
  outAmount: solOutput.toString(),
  otherAmountThreshold: '99000000',
  setupInstructions: [solAtaSetup, solFunding, solSync],
  swapInstruction: solSwapInstruction,
  cleanupInstruction: solCleanup,
  routePlan: [
    {
      ...validBuild.routePlan[0],
      swapInfo: {
        ...validBuild.routePlan[0].swapInfo,
        inputMint: C3_CORE_MAINNET_CONFIG.assets.input,
        outputMint: C3_CORE_MAINNET_CONFIG.assets.wSOL,
        inAmount: '15000000',
        outAmount: solOutput.toString(),
      },
    },
  ],
}
const solTransaction = transactionFor([solAtaSetup, solFunding, solSync, solSwapInstruction, solCleanup])
assert.equal(validationForLeg(solBuild, 'SOL', 15_000_000n, solTransaction).passed, true)
const thirdPartyRefundSolBuild = {
  ...solBuild,
  cleanupInstruction: {
    ...solCleanup,
    accounts: [solCleanup.accounts[0], meta('11111111111111111111111111111112', false, true), solCleanup.accounts[2]],
  },
}
const thirdPartyRefundSolTransaction = transactionFor([
  solAtaSetup,
  solFunding,
  solSync,
  solSwapInstruction,
  thirdPartyRefundSolBuild.cleanupInstruction,
])
assert.equal(
  validationForLeg(thirdPartyRefundSolBuild, 'SOL', 15_000_000n, thirdPartyRefundSolTransaction).passed,
  false,
)

console.log('C3 Core Mainnet engine security checks passed.')
