export type Basket = {
  id: string
  name: string
  tagline: string
  description: string
  composition: Array<{
    symbol: string
    weight: number
    color: string
  }>
}

export type Activity = {
  id: string
  basketId: string
  basketName: string
  amountUsdc: number
  signature: string
  timestamp: string
  cluster: 'devnet'
  status: 'confirmed'
}
