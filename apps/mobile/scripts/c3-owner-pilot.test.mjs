import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'

import { getPilotCopy, pilotCopy } from '../pilot/copy.ts'

const root = new URL('../', import.meta.url)
function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (['node_modules', '.expo', 'dist', 'android'].includes(name)) return []
    const item = new URL(name, directory)
    return statSync(item).isDirectory() ? files(new URL(`${name}/`, directory)) : [item]
  })
}

test('all pilot screens have four complete localized dictionaries', () => {
  const keys = Object.keys(pilotCopy.en).sort()
  assert.deepEqual(Object.keys(pilotCopy).sort(), ['en', 'es', 'pt-BR', 'zh-CN'])
  for (const [locale, copy] of Object.entries(pilotCopy)) {
    assert.deepEqual(Object.keys(copy).sort(), keys, locale)
    for (const key of keys) assert.ok(getPilotCopy(locale, key).trim().length > 0)
  }
})

test('owner pilot preview is not imported by stable mobile code or Expo Router', () => {
  const stable = files(root).filter(
    (file) =>
      /\.(?:js|jsx|ts|tsx|mjs)$/.test(file.pathname) &&
      !file.pathname.includes('/pilot/') &&
      !file.pathname.includes('/scripts/'),
  )
  for (const file of stable) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /(?:from|import|require)\s*\(?\s*['"][^'"]*pilot\/c3-owner-pilot/)
  }
  const preview = readFileSync(new URL('../pilot/c3-owner-pilot.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(preview, /\b(?:transact|signAndSendTransactions|sendRawTransaction)\s*\(/)
  assert.match(preview, /accessibilityState=\{\{ disabled: true \}\}/)
})
