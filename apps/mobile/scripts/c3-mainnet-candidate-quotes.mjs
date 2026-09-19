#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

import { fetchCandidateQuotes } from '../services/c3-mainnet-candidate-quotes.ts'

const generatedResultsDirectory = path.resolve(new URL('../dist/generated-results/', import.meta.url).pathname)
const resultPath = path.join(generatedResultsDirectory, 'c3-mainnet-candidate-quotes.json')
const observedAt = new Date().toISOString()
const purchases = []

console.log('C3 Mainnet candidate quotes (read-only)')
console.log(`Observed at: ${observedAt}`)
console.log('Wallet authorization/signing/submission: not performed')

for (const totalUsdc of [50, 100, 500]) {
  const quotes = await fetchCandidateQuotes(totalUsdc)
  const result = {
    totalUsdc,
    quotes: quotes.map((quote) => ({
      leg: quote.leg.id,
      allocationPercent: quote.leg.allocationPercent,
      inputAmountBaseUnits: quote.leg.inputAmountBaseUnits,
      outputMint: quote.leg.outputMint,
      status: quote.status,
      expectedOutputBaseUnits: quote.expectedOutputBaseUnits ?? null,
      minimumOutputBaseUnits: quote.minimumOutputBaseUnits ?? null,
      priceImpactPct: quote.priceImpactPct ?? null,
      routeLabels: quote.routeLabels,
      routePrograms: quote.routePrograms,
      contextSlot: quote.contextSlot ?? null,
      observedAt: quote.observedAt,
      reason: quote.reason ?? null,
    })),
  }
  purchases.push(result)
  console.log(`${totalUsdc} USDC: ${result.quotes.map((quote) => `${quote.leg}=${quote.status}`).join(', ')}`)
}

await fs.mkdir(generatedResultsDirectory, { recursive: true })
await fs.writeFile(
  resultPath,
  `${JSON.stringify({ observedAt, cluster: 'mainnet-beta', endpoint: 'https://api.jup.ag/swap/v2/quote', purchases }, null, 2)}\n`,
)
console.log(`Machine-readable result: ${path.relative(process.cwd(), resultPath)}`)
