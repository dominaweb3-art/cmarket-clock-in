import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  C3CoreMainnetLegId,
  C3CoreMainnetPurchaseState,
  deriveC3PurchaseIntentId,
  nextC3MainnetPurchaseState,
} from '@/services/c3-core-mainnet-core'

const STORAGE_KEY = 'cmarket.c3-core-mainnet.purchase-intents.v1'

export type C3CoreMainnetLegRecord = Readonly<{
  id: C3CoreMainnetLegId
  allocationUsdcBaseUnits: string
  state: 'pending' | 'awaiting_approval' | 'submitted' | 'confirmed' | 'failed' | 'cancelled'
  signature?: string
  confirmedOutputBaseUnits?: string
  updatedAt: number
  errorCode?: string
}>

export type C3CoreMainnetPurchaseIntent = Readonly<{
  id: string
  walletAddress: string
  totalUsdcBaseUnits: string
  state: C3CoreMainnetPurchaseState
  basketVersion: string
  createdAt: number
  updatedAt: number
  legs: Readonly<Record<C3CoreMainnetLegId, C3CoreMainnetLegRecord>>
}>

function parseStore(raw: string | null): C3CoreMainnetPurchaseIntent[] {
  if (!raw) return []

  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter(isPurchaseIntent)
  } catch {
    return []
  }
}

function isPurchaseIntent(value: unknown): value is C3CoreMainnetPurchaseIntent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<C3CoreMainnetPurchaseIntent>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.walletAddress === 'string' &&
    typeof candidate.totalUsdcBaseUnits === 'string' &&
    typeof candidate.state === 'string' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    Boolean(candidate.legs)
  )
}

export class C3CoreMainnetStore {
  async list(): Promise<C3CoreMainnetPurchaseIntent[]> {
    return parseStore(await AsyncStorage.getItem(STORAGE_KEY))
  }

  async get(id: string): Promise<C3CoreMainnetPurchaseIntent | undefined> {
    return (await this.list()).find((intent) => intent.id === id)
  }

  async save(intent: C3CoreMainnetPurchaseIntent): Promise<void> {
    const intents = await this.list()
    const next = intents.filter((candidate) => candidate.id !== intent.id)
    next.unshift(intent)
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 20)))
  }

  async create(input: {
    walletAddress: string
    totalUsdcBaseUnits: bigint
    legs: Readonly<Record<C3CoreMainnetLegId, bigint>>
    now?: number
  }): Promise<C3CoreMainnetPurchaseIntent> {
    const now = input.now ?? Date.now()
    const intent: C3CoreMainnetPurchaseIntent = {
      id: deriveC3PurchaseIntentId({
        walletAddress: input.walletAddress,
        totalUsdcBaseUnits: input.totalUsdcBaseUnits,
        createdAtMs: now,
      }),
      walletAddress: input.walletAddress,
      totalUsdcBaseUnits: input.totalUsdcBaseUnits.toString(),
      state: 'draft',
      basketVersion: 'c3-core-mainnet-v1',
      createdAt: now,
      updatedAt: now,
      legs: {
        cbBTC: {
          id: 'cbBTC',
          allocationUsdcBaseUnits: input.legs.cbBTC.toString(),
          state: 'pending',
          updatedAt: now,
        },
        portalETH: {
          id: 'portalETH',
          allocationUsdcBaseUnits: input.legs.portalETH.toString(),
          state: 'pending',
          updatedAt: now,
        },
        SOL: {
          id: 'SOL',
          allocationUsdcBaseUnits: input.legs.SOL.toString(),
          state: 'pending',
          updatedAt: now,
        },
      },
    }
    await this.save(intent)
    return intent
  }
}

export function deriveStateFromLegs(intent: C3CoreMainnetPurchaseIntent): C3CoreMainnetPurchaseState {
  const legs = Object.values(intent.legs)
  return nextC3MainnetPurchaseState({
    confirmedLegs: legs.filter((leg) => leg.state === 'confirmed').length,
    totalLegs: legs.length,
    failed: legs.some((leg) => leg.state === 'failed' || leg.state === 'cancelled'),
  })
}
