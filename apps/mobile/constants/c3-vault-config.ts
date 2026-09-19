import { PublicKey } from '@solana/web3.js'

export const C3_SYMMETRY_V3_PROGRAM_ID = 'BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate' as const

export const C3_VAULT_ALLOCATION_BPS = Object.freeze({
  bitcoin: 4_000,
  ethereum: 3_000,
  solana: 3_000,
})

export const C3_VAULT_TOTAL_BPS = Object.values(C3_VAULT_ALLOCATION_BPS).reduce((total, weight) => total + weight, 0)

export type C3VaultConfigStatus = 'deployment_required' | 'configured_read_only' | 'invalid'

export type C3VaultConfig = Readonly<{
  schemaVersion: 1
  cluster: 'devnet'
  programId: string
  vaultAddress?: string
  shareMint?: string
  status: C3VaultConfigStatus
  errors: readonly string[]
  purchaseEnabled: false
  saleEnabled: false
}>

type C3VaultEnvironment = Readonly<{
  vaultAddress?: string
  shareMint?: string
}>

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function isPublicKey(value: string): boolean {
  try {
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}

export function evaluateC3VaultConfig(environment: C3VaultEnvironment): C3VaultConfig {
  const vaultAddress = normalizeOptional(environment.vaultAddress)
  const shareMint = normalizeOptional(environment.shareMint)
  const errors: string[] = []

  if (C3_VAULT_TOTAL_BPS !== 10_000) {
    errors.push('C3 target allocation must total exactly 10,000 basis points.')
  }

  if (Boolean(vaultAddress) !== Boolean(shareMint)) {
    errors.push('The Symmetry vault address and C3 share mint must be configured together.')
  }

  if (vaultAddress && !isPublicKey(vaultAddress)) {
    errors.push('The configured Symmetry vault address is not a valid Solana public key.')
  }

  if (shareMint && !isPublicKey(shareMint)) {
    errors.push('The configured C3 share mint is not a valid Solana public key.')
  }

  const status: C3VaultConfigStatus = errors.length
    ? 'invalid'
    : vaultAddress && shareMint
      ? 'configured_read_only'
      : 'deployment_required'

  return Object.freeze({
    schemaVersion: 1,
    cluster: 'devnet',
    programId: C3_SYMMETRY_V3_PROGRAM_ID,
    vaultAddress,
    shareMint,
    status,
    errors: Object.freeze(errors),
    purchaseEnabled: false,
    saleEnabled: false,
  })
}

export const C3_VAULT_CONFIG = evaluateC3VaultConfig({
  vaultAddress: process.env.EXPO_PUBLIC_C3_SYMMETRY_VAULT_ADDRESS,
  shareMint: process.env.EXPO_PUBLIC_C3_SHARE_MINT,
})
