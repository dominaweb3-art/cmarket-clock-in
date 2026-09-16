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
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled'
  | 'partially_completed'
  | 'completed'

const STATE_TRANSITIONS: Readonly<Record<C3CoreMainnetPurchaseState, readonly C3CoreMainnetPurchaseState[]>> = {
  draft: ['quoting', 'cancelled'],
  quoting: ['ready_for_review', 'failed', 'cancelled'],
  ready_for_review: ['awaiting_wallet', 'cancelled'],
  awaiting_wallet: ['submitted', 'failed', 'cancelled'],
  submitted: ['confirmed', 'failed'],
  confirmed: ['quoting', 'partially_completed', 'completed'],
  failed: ['quoting', 'cancelled', 'partially_completed'],
  cancelled: [],
  partially_completed: ['quoting', 'cancelled', 'completed'],
  completed: [],
}

export function isC3MainnetEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET === 'true'
}

export function assertC3MainnetExecution(configuredCluster: string): void {
  if (!isC3MainnetEnabled()) {
    throw new Error('C3 Mainnet is disabled by EXPO_PUBLIC_ENABLE_C3_MAINNET.')
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

export function deriveC3PurchaseIntentId(input: {
  walletAddress: string
  totalUsdcBaseUnits: bigint
  createdAtMs: number
}): string {
  const material = `${C3_CORE_MAINNET_VERSION}:${input.walletAddress}:${input.totalUsdcBaseUnits.toString()}:${input.createdAtMs}`
  let hash = 2166136261

  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return `${C3_CORE_MAINNET_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function nextC3MainnetPurchaseState(input: {
  confirmedLegs: number
  totalLegs: number
  failed: boolean
}): C3CoreMainnetPurchaseState {
  if (input.failed && input.confirmedLegs > 0) return 'partially_completed'
  if (input.failed) return 'failed'
  if (input.confirmedLegs >= input.totalLegs) return 'completed'
  return input.confirmedLegs > 0 ? 'partially_completed' : 'draft'
}
