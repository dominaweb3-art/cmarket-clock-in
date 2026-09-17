import type { TranslationKey } from '@/locales'

export const C3_CORE_TARGETS = [
  { symbol: 'BTC', percent: 40, color: '#F7931A', labelKey: 'c3.assetBitcoin' },
  { symbol: 'ETH', percent: 30, color: '#627EEA', labelKey: 'c3.assetEthereum' },
  { symbol: 'SOL', percent: 30, color: '#9945FF', labelKey: 'c3.assetSolana' },
] as const satisfies ReadonlyArray<{
  symbol: string
  percent: number
  color: string
  labelKey: TranslationKey
}>

export const C3_CORE_TOTAL_PERCENT = C3_CORE_TARGETS.reduce((total, target) => total + target.percent, 0)
