import { C3_MAINNET_BUILD_CAPABILITY } from '../constants/c3-mainnet-build-capability.ts'

export const C3_CORE_MAINNET_VERSION = 'c3-core-mainnet-v1' as const

export const C3_CORE_MAINNET_ASSETS = {
  input: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  cbBTC: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  portalETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  wSOL: 'So11111111111111111111111111111111111111112',
} as const

export const C3_CORE_MAINNET_DECIMALS = {
  USDC: 6,
  cbBTC: 8,
  portalETH: 8,
  SOL: 9,
} as const

export const C3_CORE_MAINNET_WEIGHTS = {
  cbBTC: 40,
  portalETH: 30,
  SOL: 30,
} as const

export const C3_CORE_MAINNET_POLICY = {
  minimumPurchaseUsdc: 50,
  maximumPurchaseUsdc: 500,
  maximumSlippageBps: 100,
  quoteEndpoint: 'https://api.jup.ag/swap/v2/build',
  programLabelsEndpoint: 'https://api.jup.ag/swap/v1/program-id-to-label',
  rpcEndpoint: 'https://api.mainnet.solana.com',
  maxTransactionBytes: 1232,
  blockhashSlotsToExpiry: 150,
  keylessRequestIntervalMs: 2500,
  maxRateLimitRetries: 2,
} as const

export type C3CoreMainnetLegId = keyof typeof C3_CORE_MAINNET_WEIGHTS

export type C3CoreMainnetAllocation = Readonly<{
  totalUsdcBaseUnits: bigint
  legs: Readonly<Record<C3CoreMainnetLegId, bigint>>
}>

export type C3CoreMainnetPurchaseState =
  | 'draft'
  | 'quoting'
  | 'ready_for_review'
  | 'awaiting_wallet'
  | 'submitted_unconfirmed'
  | 'confirmed'
  | 'failed_on_chain'
  | 'cancelled_before_submission'
  | 'submission_outcome_uncertain'
  | 'reconciliation_required'
  | 'partially_completed'
  | 'completed'

const STATE_TRANSITIONS: Readonly<Record<C3CoreMainnetPurchaseState, readonly C3CoreMainnetPurchaseState[]>> = {
  draft: ['quoting', 'cancelled_before_submission'],
  quoting: ['ready_for_review', 'reconciliation_required', 'draft', 'cancelled_before_submission'],
  ready_for_review: [
    'awaiting_wallet',
    'cancelled_before_submission',
    'submission_outcome_uncertain',
    'reconciliation_required',
  ],
  awaiting_wallet: [
    'submitted_unconfirmed',
    'cancelled_before_submission',
    'submission_outcome_uncertain',
    'reconciliation_required',
  ],
  submitted_unconfirmed: [
    'confirmed',
    'failed_on_chain',
    'submission_outcome_uncertain',
    'reconciliation_required',
    'partially_completed',
    'completed',
  ],
  confirmed: ['quoting', 'partially_completed', 'completed'],
  failed_on_chain: ['quoting', 'cancelled_before_submission', 'partially_completed'],
  cancelled_before_submission: ['quoting'],
  submission_outcome_uncertain: ['reconciliation_required'],
  reconciliation_required: ['quoting', 'cancelled_before_submission', 'partially_completed'],
  partially_completed: ['quoting', 'cancelled_before_submission', 'completed'],
  completed: [],
}

export function isC3MainnetEnabled(): boolean {
  return C3_MAINNET_BUILD_CAPABILITY
}

export function assertC3MainnetExecution(configuredCluster: string): void {
  if (!isC3MainnetEnabled()) {
    throw new Error('C3 Mainnet is disabled in this build artifact.')
  }

  if (configuredCluster !== 'mainnet-beta') {
    throw new Error('C3 Mainnet requires the configured cluster to be mainnet-beta.')
  }
}

export function parseC3UsdcAmount(value: string): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('C3 Mainnet amount must be a plain decimal with at most 6 fractional digits.')
  }

  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0')
}

export function assertC3PurchaseAmount(totalUsdcBaseUnits: bigint): void {
  if (totalUsdcBaseUnits < 0n) throw new Error('C3 Mainnet purchase amount cannot be negative.')

  const minimum = BigInt(C3_CORE_MAINNET_POLICY.minimumPurchaseUsdc) * 1_000_000n
  const maximum = BigInt(C3_CORE_MAINNET_POLICY.maximumPurchaseUsdc) * 1_000_000n
  if (totalUsdcBaseUnits < minimum) {
    throw new Error(`C3 Mainnet purchases require at least ${C3_CORE_MAINNET_POLICY.minimumPurchaseUsdc} USDC.`)
  }
  if (totalUsdcBaseUnits > maximum) {
    throw new Error(`C3 Mainnet purchases are limited to ${C3_CORE_MAINNET_POLICY.maximumPurchaseUsdc} USDC.`)
  }
}

export function allocateC3Core(totalUsdcBaseUnits: bigint): C3CoreMainnetAllocation {
  assertC3PurchaseAmount(totalUsdcBaseUnits)

  const cbBTC = (totalUsdcBaseUnits * BigInt(C3_CORE_MAINNET_WEIGHTS.cbBTC)) / 100n
  const portalETH = (totalUsdcBaseUnits * BigInt(C3_CORE_MAINNET_WEIGHTS.portalETH)) / 100n
  const SOL = totalUsdcBaseUnits - cbBTC - portalETH

  return Object.freeze({
    totalUsdcBaseUnits,
    legs: Object.freeze({ cbBTC, portalETH, SOL }),
  })
}

export function canTransitionC3MainnetState(
  current: C3CoreMainnetPurchaseState,
  next: C3CoreMainnetPurchaseState,
): boolean {
  return STATE_TRANSITIONS[current].includes(next)
}

export function assertC3MainnetStateTransition(
  current: C3CoreMainnetPurchaseState,
  next: C3CoreMainnetPurchaseState,
): void {
  if (!canTransitionC3MainnetState(current, next)) {
    throw new Error(`Invalid C3 Mainnet state transition: ${current} -> ${next}`)
  }
}

export type C3PurchaseIntentIdGenerator = () => string

export function generateC3PurchaseIntentId(generator: C3PurchaseIntentIdGenerator = defaultIntentIdGenerator): string {
  const id = generator()
  if (!/^c3-core-mainnet-v1-[a-f0-9]{32}$/.test(id)) {
    throw new Error('C3 Mainnet intent ID generator returned an invalid identifier.')
  }
  return id
}

export function deriveC3PurchaseIntentId(
  _input: { walletAddress: string; totalUsdcBaseUnits: bigint; createdAtMs: number },
  generator: C3PurchaseIntentIdGenerator = defaultIntentIdGenerator,
): string {
  return generateC3PurchaseIntentId(generator)
}

export function nextC3MainnetPurchaseState(input: {
  confirmedLegs: number
  totalLegs: number
  failed: boolean
  uncertain?: boolean
  reconciliationRequired?: boolean
}): C3CoreMainnetPurchaseState {
  if (input.reconciliationRequired || input.uncertain) return 'reconciliation_required'
  if (input.failed && input.confirmedLegs > 0) return 'partially_completed'
  if (input.failed) return 'failed_on_chain'
  if (input.confirmedLegs >= input.totalLegs) return 'completed'
  return input.confirmedLegs > 0 ? 'partially_completed' : 'draft'
}

function defaultIntentIdGenerator(): string {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (!cryptoApi?.getRandomValues) throw new Error('C3 Mainnet requires a cryptographically secure random source.')
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${C3_CORE_MAINNET_VERSION}-${hex}`
}
