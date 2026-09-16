import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { fromUint8Array } from 'js-base64'
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'

import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import {
  allocateC3Core,
  assertC3MainnetExecution,
  assertC3MainnetStateTransition,
  canTransitionC3MainnetState,
  deriveC3PurchaseIntentId,
  isC3MainnetEnabled,
  nextC3MainnetPurchaseState,
} from '../services/c3-core-mainnet-core.ts'
import { validateC3CoreMainnetTransaction } from '../services/c3-core-mainnet-validation.ts'

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

const rounded = allocateC3Core(fiftyUsdc + 1n)
assert.equal(rounded.legs.cbBTC + rounded.legs.portalETH + rounded.legs.SOL, rounded.totalUsdcBaseUnits)
assert.throws(() => allocateC3Core(49_999_999n))

assert.equal(isC3MainnetEnabled(undefined), false)
assert.equal(isC3MainnetEnabled('TRUE'), false)
assert.equal(isC3MainnetEnabled('true'), true)
assert.throws(() => assertC3MainnetExecution('devnet', true))
assert.throws(() => assertC3MainnetExecution('mainnet-beta', false))
assert.doesNotThrow(() => assertC3MainnetExecution('mainnet-beta', true))

assert.equal(canTransitionC3MainnetState('draft', 'quoting'), true)
assert.equal(canTransitionC3MainnetState('completed', 'quoting'), false)
assert.equal(canTransitionC3MainnetState('confirmed', 'submitted'), false)
assert.equal(nextC3MainnetPurchaseState({ confirmedLegs: 1, totalLegs: 3, failed: false }), 'partially_completed')
assert.equal(nextC3MainnetPurchaseState({ confirmedLegs: 1, totalLegs: 3, failed: true }), 'partially_completed')
assert.doesNotThrow(() => assertC3MainnetStateTransition('submitted', 'confirmed'))
assert.throws(() => assertC3MainnetStateTransition('completed', 'submitted'))

const intentInput = {
  walletAddress: 'Wallet1111111111111111111111111111111111111',
  totalUsdcBaseUnits: fiftyUsdc,
  createdAtMs: 1,
}
assert.equal(deriveC3PurchaseIntentId(intentInput), deriveC3PurchaseIntentId(intentInput))

const wallet = new PublicKey('DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej')
const outputAta = getAssociatedTokenAddressSync(C3_CORE_MAINNET_CONFIG.cbBTCMint, wallet).toBase58()
const instruction = {
  programId: C3_CORE_MAINNET_CONFIG.programs.jupiterSwapV6,
  accounts: [{ pubkey: outputAta, isSigner: false, isWritable: true }],
  data: fromUint8Array(new Uint8Array([1])),
}
const build = {
  inputMint: C3_CORE_MAINNET_CONFIG.assets.input,
  outputMint: C3_CORE_MAINNET_CONFIG.assets.cbBTC,
  inAmount: '20000000',
  outAmount: '1',
  otherAmountThreshold: '1',
  blockhashWithMetadata: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 },
  swapInstruction: instruction,
}
const transaction = new VersionedTransaction(
  new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: [{ pubkey: new PublicKey(outputAta), isSigner: false, isWritable: true }],
        data: Buffer.from([1]),
      }),
    ],
  }).compileToV0Message(),
)
const validValidation = validateC3CoreMainnetTransaction({
  walletAddress: wallet.toBase58(),
  leg: 'cbBTC',
  inputAmountBaseUnits: 20_000_000n,
  build,
  transaction,
})
assert.equal(validValidation.passed, true)
const unknownValidation = validateC3CoreMainnetTransaction({
  walletAddress: wallet.toBase58(),
  leg: 'cbBTC',
  inputAmountBaseUnits: 20_000_000n,
  build: { ...build, otherInstructions: [{ ...instruction, programId: '11111111111111111111111111111112' }] },
  transaction: new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: [{ pubkey: new PublicKey(outputAta), isSigner: false, isWritable: true }],
          data: Buffer.from([1]),
        }),
        new TransactionInstruction({
          programId: new PublicKey('11111111111111111111111111111112'),
          keys: [],
          data: Buffer.from([1]),
        }),
      ],
    }).compileToV0Message(),
  ),
})
assert.equal(unknownValidation.passed, false)
assert.match(unknownValidation.issues.join(' '), /unknown program ID/)

console.log('C3 Core Mainnet engine unit checks passed.')
