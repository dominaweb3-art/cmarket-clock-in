import type { Basket } from '../types'

export const BASKETS: Basket[] = [
  {
    id: 'c3',
    name: 'C3',
    tagline: 'A simple three-asset basket',
    description:
      'A transparent Devnet prototype basket designed to make on-chain allocation easier to understand.',
    status: 'live',
    composition: [
      { symbol: 'SOL', weight: 50, color: '#14F195' },
      { symbol: 'USDC', weight: 30, color: '#2775CA' },
      { symbol: 'JitoSOL', weight: 20, color: '#8B5CF6' },
    ],
  },
  {
    id: 'c10',
    name: 'C10',
    tagline: 'A broader market basket',
    description:
      'A planned market-cap methodology for a larger basket. The production methodology is not enabled in this prototype.',
    status: 'planned',
    composition: [
      { symbol: 'Top assets', weight: 100, color: '#14F195' },
    ],
  },
]
