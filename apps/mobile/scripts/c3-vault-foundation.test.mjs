import assert from 'node:assert/strict'

import { PublicKey } from '@solana/web3.js'

import { C3_SYMMETRY_V3_PROGRAM_ID, C3_VAULT_TOTAL_BPS, evaluateC3VaultConfig } from '../constants/c3-vault-config.ts'
import { probeC3VaultReadiness } from '../services/c3-vault-readiness.ts'

const PROGRAM_ID = new PublicKey(C3_SYMMETRY_V3_PROGRAM_ID)
const VAULT_ADDRESS = new PublicKey('11111111111111111111111111111111')
const SHARE_MINT = new PublicKey('SysvarRent111111111111111111111111111111111')
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')

function account(owner, executable = false, dataSize = 82) {
  return {
    data: Buffer.alloc(dataSize),
    executable,
    lamports: 1,
    owner,
    rentEpoch: 0,
  }
}

function mintAccount(dataSize = 82) {
  const mint = account(TOKEN_PROGRAM, false, dataSize)
  if (dataSize > 45) mint.data[45] = 1
  return mint
}

function reader(entries) {
  return {
    getAccountInfo: async (publicKey) => entries.get(publicKey.toBase58()) ?? null,
  }
}

assert.equal(C3_VAULT_TOTAL_BPS, 10_000, 'C3 allocation must total exactly 100%')

const missing = evaluateC3VaultConfig({})
assert.equal(missing.status, 'deployment_required')
assert.equal(missing.purchaseEnabled, false)
assert.equal(missing.saleEnabled, false)

const partial = evaluateC3VaultConfig({ vaultAddress: VAULT_ADDRESS.toBase58() })
assert.equal(partial.status, 'invalid', 'partial configuration must fail closed')

const malformed = evaluateC3VaultConfig({ vaultAddress: 'invalid', shareMint: 'also-invalid' })
assert.equal(malformed.status, 'invalid', 'malformed public keys must fail closed')

const configured = evaluateC3VaultConfig({
  vaultAddress: VAULT_ADDRESS.toBase58(),
  shareMint: SHARE_MINT.toBase58(),
})
assert.equal(configured.status, 'configured_read_only')
assert.equal(configured.purchaseEnabled, false)
assert.equal(configured.saleEnabled, false)

const programOnly = await probeC3VaultReadiness(
  reader(new Map([[PROGRAM_ID.toBase58(), account(LOADER, true)]])),
  missing,
)
assert.equal(programOnly.status, 'deployment_required')
assert.equal(programOnly.programVerified, true)

const verified = await probeC3VaultReadiness(
  reader(
    new Map([
      [PROGRAM_ID.toBase58(), account(LOADER, true)],
      [VAULT_ADDRESS.toBase58(), account(PROGRAM_ID)],
      [SHARE_MINT.toBase58(), mintAccount()],
    ]),
  ),
  configured,
)
assert.equal(verified.status, 'ready_read_only')
assert.equal(verified.vaultVerified, true)
assert.equal(verified.shareMintVerified, true)

const substitutedVault = await probeC3VaultReadiness(
  reader(
    new Map([
      [PROGRAM_ID.toBase58(), account(LOADER, true)],
      [VAULT_ADDRESS.toBase58(), account(TOKEN_PROGRAM)],
      [SHARE_MINT.toBase58(), mintAccount()],
    ]),
  ),
  configured,
)
assert.equal(substitutedVault.status, 'vault_invalid', 'a vault with a substituted owner must fail closed')

const invalidMint = await probeC3VaultReadiness(
  reader(
    new Map([
      [PROGRAM_ID.toBase58(), account(LOADER, true)],
      [VAULT_ADDRESS.toBase58(), account(PROGRAM_ID)],
      [SHARE_MINT.toBase58(), mintAccount(20)],
    ]),
  ),
  configured,
)
assert.equal(invalidMint.status, 'vault_invalid', 'a truncated share mint must fail closed')

const uninitializedMint = await probeC3VaultReadiness(
  reader(
    new Map([
      [PROGRAM_ID.toBase58(), account(LOADER, true)],
      [VAULT_ADDRESS.toBase58(), account(PROGRAM_ID)],
      [SHARE_MINT.toBase58(), account(TOKEN_PROGRAM)],
    ]),
  ),
  configured,
)
assert.equal(uninitializedMint.status, 'vault_invalid', 'an uninitialized share mint must fail closed')

console.log('C3 Symmetry Devnet foundation checks passed.')
