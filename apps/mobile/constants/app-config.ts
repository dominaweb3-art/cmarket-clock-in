import { PublicKey } from '@solana/web3.js'
import { Cluster } from '@/components/cluster/cluster'
import { ClusterNetwork } from '@/components/cluster/cluster-network'

function configurationError(variableName: string, requirement: string): Error {
  return new Error(
    `[C Market configuration] ${variableName} ${requirement}. Copy the repository .env.example to apps/mobile/.env.`,
  )
}

function requiredValue(variableName: string, value: string | undefined): string {
  const normalizedValue = value?.trim()

  if (!normalizedValue) {
    throw configurationError(variableName, 'is required')
  }

  return normalizedValue
}

function devnetCluster(value: string): ClusterNetwork.Devnet {
  if (value.toLowerCase() !== ClusterNetwork.Devnet) {
    throw configurationError('EXPO_PUBLIC_SOLANA_CLUSTER', 'must be devnet for the current prototype')
  }

  return ClusterNetwork.Devnet
}

function httpUrl(variableName: string, value: string): string {
  try {
    const parsedUrl = new URL(value)

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol')
    }

    return value
  } catch {
    throw configurationError(variableName, 'must be a valid HTTP(S) URL')
  }
}

function httpsUrl(variableName: string, value: string): string {
  const validatedUrl = httpUrl(variableName, value)

  if (new URL(validatedUrl).protocol !== 'https:') {
    throw configurationError(variableName, 'must use HTTPS for wallet identity verification')
  }

  return validatedUrl
}

function publicKey(variableName: string, value: string): PublicKey {
  try {
    return new PublicKey(value)
  } catch {
    throw configurationError(variableName, 'must be a valid Solana public address')
  }
}

function tokenDecimals(variableName: string, value: string): number {
  if (!/^\d+$/.test(value)) {
    throw configurationError(variableName, 'must be an integer from 0 to 18')
  }

  const parsedValue = Number(value)

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 0 || parsedValue > 18) {
    throw configurationError(variableName, 'must be an integer from 0 to 18')
  }

  return parsedValue
}

const name = requiredValue('EXPO_PUBLIC_APP_NAME', process.env.EXPO_PUBLIC_APP_NAME)
const uri = httpsUrl(
  'EXPO_PUBLIC_APP_IDENTITY_URI',
  requiredValue('EXPO_PUBLIC_APP_IDENTITY_URI', process.env.EXPO_PUBLIC_APP_IDENTITY_URI),
)
const network = devnetCluster(requiredValue('EXPO_PUBLIC_SOLANA_CLUSTER', process.env.EXPO_PUBLIC_SOLANA_CLUSTER))
const endpoint = httpUrl(
  'EXPO_PUBLIC_SOLANA_RPC_URL',
  requiredValue('EXPO_PUBLIC_SOLANA_RPC_URL', process.env.EXPO_PUBLIC_SOLANA_RPC_URL),
)
const usdcMint = publicKey(
  'EXPO_PUBLIC_DEVNET_USDC_MINT',
  requiredValue('EXPO_PUBLIC_DEVNET_USDC_MINT', process.env.EXPO_PUBLIC_DEVNET_USDC_MINT),
)
const usdcDecimals = tokenDecimals(
  'EXPO_PUBLIC_USDC_DECIMALS',
  requiredValue('EXPO_PUBLIC_USDC_DECIMALS', process.env.EXPO_PUBLIC_USDC_DECIMALS),
)
const treasuryPublicKey = publicKey(
  'EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY',
  requiredValue('EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY', process.env.EXPO_PUBLIC_DEVNET_TREASURY_PUBLIC_KEY),
)

export class AppConfig {
  static readonly name = name
  static readonly uri = uri
  static readonly network = network
  static readonly endpoint = endpoint
  static readonly usdcMint = usdcMint
  static readonly usdcDecimals = usdcDecimals
  static readonly treasuryPublicKey = treasuryPublicKey
  static readonly identity = Object.freeze({ name, uri })
  static clusters: Cluster[] = [
    {
      id: `solana:${network}`,
      name: 'Devnet',
      endpoint,
      network,
    },
  ]
}
