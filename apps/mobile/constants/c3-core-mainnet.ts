import { PublicKey } from '@solana/web3.js'

import {
  C3_CORE_MAINNET_ASSETS,
  C3_CORE_MAINNET_DECIMALS,
  C3_CORE_MAINNET_POLICY,
  C3_CORE_MAINNET_WEIGHTS,
  isC3MainnetEnabled,
} from '../services/c3-core-mainnet-core.ts'

export const C3_CORE_MAINNET_PROGRAMS = Object.freeze({
  system: '11111111111111111111111111111111',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  jupiterSwapV6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
})

export const C3_CORE_MAINNET_CONFIG = Object.freeze({
  cluster: 'mainnet-beta' as const,
  enabled: isC3MainnetEnabled(),
  assets: C3_CORE_MAINNET_ASSETS,
  decimals: C3_CORE_MAINNET_DECIMALS,
  weights: C3_CORE_MAINNET_WEIGHTS,
  policy: C3_CORE_MAINNET_POLICY,
  programs: C3_CORE_MAINNET_PROGRAMS,
  inputMint: new PublicKey(C3_CORE_MAINNET_ASSETS.input),
  cbBTCMint: new PublicKey(C3_CORE_MAINNET_ASSETS.cbBTC),
  portalETHMint: new PublicKey(C3_CORE_MAINNET_ASSETS.portalETH),
  wrappedSolMint: new PublicKey(C3_CORE_MAINNET_ASSETS.wSOL),
})

export type C3CoreMainnetConfig = typeof C3_CORE_MAINNET_CONFIG
