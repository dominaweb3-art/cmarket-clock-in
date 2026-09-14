import { Connection, PublicKey } from '@solana/web3.js'
import { useCallback, useEffect, useState } from 'react'

const DEVNET_RPC_URL = 'https://api.devnet.solana.com'

export const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

export function useGetUsdcBalance({ address }: { address?: PublicKey }) {
  const addressText = address?.toBase58()

  const [balance, setBalance] = useState<number | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    if (!addressText) {
      setBalance(undefined)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const connection = new Connection(DEVNET_RPC_URL, 'confirmed')

      const response = await connection.getParsedTokenAccountsByOwner(new PublicKey(addressText), {
        mint: DEVNET_USDC_MINT,
      })

      const total = response.value.reduce((sum, item) => {
        const uiAmount = item.account.data.parsed.info.tokenAmount.uiAmount

        return sum + (typeof uiAmount === 'number' ? uiAmount : 0)
      }, 0)

      setBalance(total)
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('No se pudo consultar el saldo USDC'))
    } finally {
      setIsLoading(false)
    }
  }, [addressText])

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refresh()
    }, 0)

    return () => clearTimeout(timeout)
  }, [refresh])

  return {
    balance,
    isLoading,
    error,
    refresh,
  }
}
