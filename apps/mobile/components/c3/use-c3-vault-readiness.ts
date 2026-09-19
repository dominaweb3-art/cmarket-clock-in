import { Connection } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { AppConfig } from '@/constants/app-config'
import { C3_VAULT_CONFIG } from '@/constants/c3-vault-config'
import { C3VaultReadiness, probeC3VaultReadiness } from '@/services/c3-vault-readiness'

export function useC3VaultReadiness() {
  const connection = useMemo(() => new Connection(AppConfig.endpoint, 'finalized'), [])
  const query = useQuery<C3VaultReadiness>({
    queryKey: ['c3-vault-readiness', AppConfig.endpoint, C3_VAULT_CONFIG.vaultAddress, C3_VAULT_CONFIG.shareMint],
    queryFn: () => probeC3VaultReadiness(connection, C3_VAULT_CONFIG),
    staleTime: 30_000,
  })

  return { checking: query.isFetching, readiness: query.data, refresh: query.refetch }
}
