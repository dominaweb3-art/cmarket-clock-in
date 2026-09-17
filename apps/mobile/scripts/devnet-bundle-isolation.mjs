import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const bundleRoot = resolve(new URL('../dist/release-check', import.meta.url).pathname)

if (!existsSync(bundleRoot)) {
  throw new Error(`Android export not found at ${bundleRoot}. Run npm run android:export first.`)
}

const forbiddenProductionMarkers = [
  'https://api.mainnet.solana.com',
  'https://api.jup.ag/swap/v2/build',
  'https://api.jup.ag/swap/v1/program-id-to-label',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
]

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else files.push(path)
  }
  return files
}

const hits = []
for (const file of await walk(bundleRoot)) {
  const content = await readFile(file, 'utf8')
  for (const marker of forbiddenProductionMarkers) {
    if (content.includes(marker)) hits.push({ file, marker })
  }
}

if (hits.length > 0) {
  throw new Error(
    `Devnet bundle contains guarded Mainnet markers: ${hits.map((hit) => `${hit.file}:${hit.marker}`).join(', ')}`,
  )
}

console.log(`Devnet Android export is isolated: scanned ${await walk(bundleRoot).then((files) => files.length)} files.`)
