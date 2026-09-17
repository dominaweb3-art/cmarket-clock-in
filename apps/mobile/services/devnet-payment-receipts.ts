import { PublicKey } from '@solana/web3.js'

export const DEVNET_RECEIPTS_SCHEMA_VERSION = 1 as const
export const DEVNET_RECEIPTS_STORAGE_KEY = 'cmarket.devnet-payment-receipts.v1'
export const DEVNET_CLUSTER = 'devnet' as const

export type DevnetPaymentReceipt = Readonly<{
  schemaVersion: typeof DEVNET_RECEIPTS_SCHEMA_VERSION
  signature: string
  status: 'confirmed'
  amountUsdc: string
  cluster: typeof DEVNET_CLUSTER
  walletAddress: string
  treasuryAddress: string
  confirmedAt: string
  explorerUrl: string
}>

export type ReceiptStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}>

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{32,100}$/

export function getDevnetExplorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
}

export function createDevnetPaymentReceipt(input: {
  signature: string
  amountUsdc: string
  walletAddress: string
  treasuryAddress: string
  confirmedAt?: string
}): DevnetPaymentReceipt {
  const confirmedAt = input.confirmedAt ?? new Date().toISOString()
  const receipt: DevnetPaymentReceipt = {
    schemaVersion: DEVNET_RECEIPTS_SCHEMA_VERSION,
    signature: input.signature,
    status: 'confirmed',
    amountUsdc: input.amountUsdc,
    cluster: DEVNET_CLUSTER,
    walletAddress: input.walletAddress,
    treasuryAddress: input.treasuryAddress,
    confirmedAt,
    explorerUrl: getDevnetExplorerUrl(input.signature),
  }

  const validated = validateDevnetPaymentReceipt(receipt)
  if (!validated) throw new Error('Cannot create an invalid Devnet payment receipt.')
  return validated
}

export function validateDevnetPaymentReceipt(value: unknown): DevnetPaymentReceipt | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DevnetPaymentReceipt>

  if (
    candidate.schemaVersion !== DEVNET_RECEIPTS_SCHEMA_VERSION ||
    candidate.status !== 'confirmed' ||
    candidate.cluster !== DEVNET_CLUSTER ||
    typeof candidate.signature !== 'string' ||
    !BASE58_SIGNATURE.test(candidate.signature) ||
    typeof candidate.amountUsdc !== 'string' ||
    !/^\d+(?:\.\d{1,6})?$/.test(candidate.amountUsdc) ||
    Number(candidate.amountUsdc) <= 0 ||
    !Number.isFinite(Number(candidate.amountUsdc)) ||
    typeof candidate.walletAddress !== 'string' ||
    typeof candidate.treasuryAddress !== 'string' ||
    typeof candidate.confirmedAt !== 'string' ||
    Number.isNaN(Date.parse(candidate.confirmedAt)) ||
    typeof candidate.explorerUrl !== 'string' ||
    candidate.explorerUrl !== getDevnetExplorerUrl(candidate.signature)
  ) {
    return null
  }

  try {
    new PublicKey(candidate.walletAddress)
    new PublicKey(candidate.treasuryAddress)
  } catch {
    return null
  }

  return candidate as DevnetPaymentReceipt
}

export function parseDevnetPaymentReceipts(serialized: string | null): DevnetPaymentReceipt[] {
  if (!serialized) return []

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return []

    const unique = new Map<string, DevnetPaymentReceipt>()
    for (const item of parsed) {
      const receipt = validateDevnetPaymentReceipt(item)
      if (receipt) unique.set(receipt.signature, receipt)
    }

    return [...unique.values()].sort((left, right) => right.confirmedAt.localeCompare(left.confirmedAt))
  } catch {
    return []
  }
}

export function mergeDevnetPaymentReceipt(
  existing: readonly DevnetPaymentReceipt[],
  receipt: DevnetPaymentReceipt,
): DevnetPaymentReceipt[] {
  return [...new Map([...existing, receipt].map((item) => [item.signature, item])).values()].sort((left, right) =>
    right.confirmedAt.localeCompare(left.confirmedAt),
  )
}

export async function loadDevnetPaymentReceipts(storage: ReceiptStorage): Promise<DevnetPaymentReceipt[]> {
  return parseDevnetPaymentReceipts(await storage.getItem(DEVNET_RECEIPTS_STORAGE_KEY))
}

export async function recordDevnetPaymentReceipt(
  storage: ReceiptStorage,
  receipt: DevnetPaymentReceipt,
): Promise<DevnetPaymentReceipt[]> {
  const merged = mergeDevnetPaymentReceipt(await loadDevnetPaymentReceipts(storage), receipt)
  await storage.setItem(DEVNET_RECEIPTS_STORAGE_KEY, JSON.stringify(merged))
  return merged
}
