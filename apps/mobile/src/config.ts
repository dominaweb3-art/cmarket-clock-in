const env = process.env as Record<string, string | undefined>

export const DEVNET_RPC_URL =
  env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

export const DEVNET_USDC_MINT =
  env.EXPO_PUBLIC_DEVNET_USDC_MINT ?? ''

export const DEVNET_TREASURY_PUBLIC_KEY =
  env.EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY ?? ''

export const APP_IDENTITY = {
  name: 'C Market',
  uri: 'https://github.com/dominaweb3-art/cmarket-clock-in',
}

export const MIN_PURCHASE_USDC = 5
export const USDC_DECIMALS = 6
