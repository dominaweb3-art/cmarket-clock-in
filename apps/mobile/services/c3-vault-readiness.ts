import { PublicKey } from '@solana/web3.js'
import type { AccountInfo, Commitment } from '@solana/web3.js'

import type { C3VaultConfig } from '../constants/c3-vault-config.ts'

const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
const MINIMUM_MINT_ACCOUNT_SIZE = 82
const MINT_INITIALIZED_OFFSET = 45

export type C3VaultReadinessStatus =
  | 'deployment_required'
  | 'configuration_invalid'
  | 'program_unavailable'
  | 'vault_invalid'
  | 'ready_read_only'
  | 'rpc_error'

export type C3VaultReadiness = Readonly<{
  status: C3VaultReadinessStatus
  programVerified: boolean
  vaultVerified: boolean
  shareMintVerified: boolean
  checkedAt: string
  detail?: string
}>

export type C3AccountReader = Readonly<{
  getAccountInfo: (publicKey: PublicKey, commitment?: Commitment) => Promise<AccountInfo<Buffer> | null>
}>

function result(
  status: C3VaultReadinessStatus,
  values: Omit<C3VaultReadiness, 'status' | 'checkedAt'>,
): C3VaultReadiness {
  return Object.freeze({ status, checkedAt: new Date().toISOString(), ...values })
}

function isSupportedMintAccount(account: AccountInfo<Buffer>): boolean {
  const isTokenProgram = account.owner.equals(SPL_TOKEN_PROGRAM_ID) || account.owner.equals(TOKEN_2022_PROGRAM_ID)
  return (
    isTokenProgram &&
    account.data.byteLength >= MINIMUM_MINT_ACCOUNT_SIZE &&
    account.data[MINT_INITIALIZED_OFFSET] === 1
  )
}

export async function probeC3VaultReadiness(reader: C3AccountReader, config: C3VaultConfig): Promise<C3VaultReadiness> {
  const base = { programVerified: false, vaultVerified: false, shareMintVerified: false }

  if (config.status === 'invalid') {
    return result('configuration_invalid', { ...base, detail: config.errors.join(' ') })
  }

  try {
    const programId = new PublicKey(config.programId)
    const programAccount = await reader.getAccountInfo(programId, 'finalized')

    if (!programAccount?.executable) {
      return result('program_unavailable', base)
    }

    const programVerified = true

    if (config.status === 'deployment_required' || !config.vaultAddress || !config.shareMint) {
      return result('deployment_required', { ...base, programVerified })
    }

    const vaultAddress = new PublicKey(config.vaultAddress)
    const shareMint = new PublicKey(config.shareMint)
    const [vaultAccount, shareMintAccount] = await Promise.all([
      reader.getAccountInfo(vaultAddress, 'finalized'),
      reader.getAccountInfo(shareMint, 'finalized'),
    ])
    const vaultVerified = Boolean(vaultAccount?.owner.equals(programId))
    const shareMintVerified = Boolean(shareMintAccount && isSupportedMintAccount(shareMintAccount))

    if (!vaultVerified || !shareMintVerified) {
      return result('vault_invalid', { programVerified, vaultVerified, shareMintVerified })
    }

    return result('ready_read_only', { programVerified, vaultVerified, shareMintVerified })
  } catch (error) {
    return result('rpc_error', {
      ...base,
      detail: error instanceof Error ? error.message : 'Unknown RPC error',
    })
  }
}
