import { Connection } from '@solana/web3.js'

import { evaluateC3VaultConfig } from '../constants/c3-vault-config.ts'
import { probeC3VaultReadiness } from '../services/c3-vault-readiness.ts'

const endpoint = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const config = evaluateC3VaultConfig({
  vaultAddress: process.env.EXPO_PUBLIC_C3_SYMMETRY_VAULT_ADDRESS,
  shareMint: process.env.EXPO_PUBLIC_C3_SHARE_MINT,
})
const readiness = await probeC3VaultReadiness(new Connection(endpoint, 'finalized'), config)

console.log(
  JSON.stringify(
    {
      cluster: config.cluster,
      configuration: config.status,
      status: readiness.status,
      programVerified: readiness.programVerified,
      vaultVerified: readiness.vaultVerified,
      shareMintVerified: readiness.shareMintVerified,
      purchaseEnabled: config.purchaseEnabled,
      saleEnabled: config.saleEnabled,
      checkedAt: readiness.checkedAt,
    },
    null,
    2,
  ),
)

if (!readiness.programVerified) {
  process.exitCode = 1
}
