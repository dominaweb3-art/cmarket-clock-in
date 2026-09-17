import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { C3_MAINNET_BUILD_CAPABILITY } from '../constants/c3-mainnet-build-capability.ts'
import { C3_CORE_MAINNET_CONFIG } from '../constants/c3-core-mainnet.ts'
import { assertC3MainnetExecution, isC3MainnetEnabled } from '../services/c3-core-mainnet-core.ts'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(C3_MAINNET_BUILD_CAPABILITY === false, 'Devnet build capability must be immutable false')
assert(C3_CORE_MAINNET_CONFIG.enabled === false, 'Mainnet config must remain disabled')
assert(isC3MainnetEnabled() === false, 'runtime capability must remain disabled')

for (const value of ['true', 'TRUE', '1', 'yes']) {
  process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET = value
  assert(isC3MainnetEnabled() === false, `runtime environment bypass accepted: ${value}`)
  try {
    assertC3MainnetExecution('mainnet-beta')
    throw new Error(`cluster guard accepted runtime bypass: ${value}`)
  } catch (error) {
    assert(error instanceof Error && error.message.includes('disabled'), 'unexpected capability bypass error')
  }
}
delete process.env.EXPO_PUBLIC_ENABLE_C3_MAINNET

try {
  assertC3MainnetExecution('mainnet-beta')
  throw new Error('constructor/route capability override was accepted')
} catch (error) {
  assert(error instanceof Error && error.message.includes('disabled'), 'direct execution bypass was accepted')
}

const scriptDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)))
const appRoute = resolve(scriptDirectory, '..', 'app', '(tabs)', 'account', 'c3-mainnet.tsx')
assert(!existsSync(appRoute), 'Mainnet execution route remains in the Expo Router tree')
const accountLayout = readFileSync(resolve(scriptDirectory, '..', 'app', '(tabs)', 'account', '_layout.tsx'), 'utf8')
assert(!accountLayout.includes('c3-mainnet'), 'Mainnet route remains registered in account navigation')

console.log('C3 Mainnet build capability and route bypass tests passed.')
