import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createDevnetPaymentReceipt,
  getDevnetExplorerUrl,
  mergeDevnetPaymentReceipt,
  parseDevnetPaymentReceipts,
  recordDevnetPaymentReceipt,
} from '../services/devnet-payment-receipts.ts'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const mobileDirectory = path.resolve(scriptDirectory, '..')
const validInput = {
  signature: '4'.repeat(64),
  amountUsdc: '5.000000',
  walletAddress: 'DEHxW5Lz1HB8MAykJ4wa4zgLeKqtf2g11MB63dYLVsej',
  treasuryAddress: 'FnkzNN99YHhoR6Lu5kfnYj5X4ULLqoKTyi5P5xpBJhAZ',
  confirmedAt: '2026-09-17T12:00:00.000Z',
}

const receipt = createDevnetPaymentReceipt(validInput)
assert.equal(receipt.status, 'confirmed')
assert.equal(receipt.cluster, 'devnet')
assert.equal(receipt.explorerUrl, getDevnetExplorerUrl(receipt.signature))

const duplicate = createDevnetPaymentReceipt({ ...validInput, amountUsdc: '10.000000' })
assert.equal(mergeDevnetPaymentReceipt([receipt], duplicate).length, 1, 'receipt signatures must deduplicate')
assert.equal(mergeDevnetPaymentReceipt([receipt], duplicate)[0].amountUsdc, '10.000000')
assert.deepEqual(parseDevnetPaymentReceipts('{'), [], 'malformed storage must fail closed')
assert.deepEqual(parseDevnetPaymentReceipts(JSON.stringify([{ ...receipt, status: 'pending' }])), [])
assert.deepEqual(parseDevnetPaymentReceipts(JSON.stringify([receipt, duplicate])).length, 1)

const storage = new Map()
const adapter = {
  getItem: async (key) => storage.get(key) ?? null,
  setItem: async (key, value) => storage.set(key, value),
}
await recordDevnetPaymentReceipt(adapter, receipt)
assert.equal(parseDevnetPaymentReceipts(storage.values().next().value).length, 1)

const canonicalFiles = [
  'components/account/account-feature.tsx',
  'components/c3/c3-overview-card.tsx',
  'locales/en.ts',
  'locales/es.ts',
  'locales/zh-CN.ts',
  'locales/pt-BR.ts',
  'app/(tabs)/account/buy.tsx',
]
const obsoleteUserFacingCopy = /JitoSOL|50\s*%\s*SOL|SOL\s*50\s*%|50\/30\/20|20\s*%\s*Jito/i
for (const relativePath of canonicalFiles) {
  const source = fs.readFileSync(path.join(mobileDirectory, relativePath), 'utf8')
  assert.equal(obsoleteUserFacingCopy.test(source), false, `obsolete C3 copy remains in ${relativePath}`)
}

const localeKeys = (source) => [...source.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]).sort()
const englishKeys = localeKeys(fs.readFileSync(path.join(mobileDirectory, 'locales/en.ts'), 'utf8'))
for (const locale of ['es', 'zh-CN', 'pt-BR']) {
  const keys = localeKeys(fs.readFileSync(path.join(mobileDirectory, `locales/${locale}.ts`), 'utf8'))
  assert.deepEqual(keys, englishKeys, `${locale} must have the complete English key set`)
}

console.log('C3 product truth, receipt persistence, deduplication, and localization checks passed.')
