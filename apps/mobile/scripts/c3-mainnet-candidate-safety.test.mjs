import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { C3_CORE_MAINNET_ASSETS } from '../services/c3-core-mainnet-core.ts'
import {
  C3_CANDIDATE_EXECUTION_ENABLED,
  createCandidateLegs,
  createCandidateQuoteUrl,
  validateCandidateQuote,
} from '../services/c3-mainnet-candidate-quotes.ts'

assert.equal(C3_CANDIDATE_EXECUTION_ENABLED, false)
assert.deepEqual(
  createCandidateLegs(50).map((leg) => [leg.id, leg.inputAmountBaseUnits]),
  [
    ['cbBTC', '20000000'],
    ['portalETH', '15000000'],
    ['SOL', '15000000'],
  ],
)

const legs = createCandidateLegs(100)
assert.equal(new URL(createCandidateQuoteUrl(legs[0])).searchParams.get('inputMint'), C3_CORE_MAINNET_ASSETS.input)
assert.equal(new URL(createCandidateQuoteUrl(legs[0])).searchParams.get('outputMint'), C3_CORE_MAINNET_ASSETS.cbBTC)
assert.equal(new URL(createCandidateQuoteUrl(legs[2])).searchParams.get('outputMint'), C3_CORE_MAINNET_ASSETS.wSOL)

const validQuote = validateCandidateQuote(
  {
    inputMint: C3_CORE_MAINNET_ASSETS.input,
    outputMint: legs[0].outputMint,
    inAmount: legs[0].inputAmountBaseUnits,
    outAmount: '12345',
    otherAmountThreshold: '12000',
    swapMode: 'ExactIn',
    slippageBps: 100,
    priceImpactPct: '0.01',
    contextSlot: 1,
    routePlan: [{ swapInfo: { label: 'Test route' } }],
  },
  legs[0],
  '2026-09-18T00:00:00.000Z',
)
assert.equal(validQuote.status, 'verified')

const wrongMint = validateCandidateQuote(
  {
    inputMint: C3_CORE_MAINNET_ASSETS.input,
    outputMint: C3_CORE_MAINNET_ASSETS.portalETH,
    inAmount: legs[0].inputAmountBaseUnits,
    outAmount: '12345',
    otherAmountThreshold: '12000',
    swapMode: 'ExactIn',
    slippageBps: 100,
    routePlan: [{ swapInfo: { label: 'Hostile route' } }],
  },
  legs[0],
  '2026-09-18T00:00:00.000Z',
)
assert.equal(wrongMint.status, 'invalid')

const appDirectory = path.resolve(new URL('.', import.meta.url).pathname, '..', 'app')
const sourceFiles = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(entryPath)
    else if (/\.(tsx?|mjs)$/.test(entry.name)) sourceFiles.push(entryPath)
  }
}
collect(appDirectory)
const routeSource = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
for (const forbidden of ['useMobileWallet', 'signAndSendTransactions', 'sendRawTransaction', 'sendTransaction']) {
  assert.equal(
    routeSource.includes(forbidden),
    false,
    `candidate route contains forbidden wallet operation: ${forbidden}`,
  )
}
assert.equal(
  sourceFiles.some((file) => file.endsWith('/buy.tsx')),
  false,
)
assert.equal(
  sourceFiles.some((file) => file.endsWith('/sign-in.tsx')),
  false,
)

console.log('C3 Mainnet candidate route, allocation, quote validation, and wallet-bypass tests passed.')
