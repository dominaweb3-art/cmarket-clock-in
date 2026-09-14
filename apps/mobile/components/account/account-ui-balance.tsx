import { PublicKey } from '@solana/web3.js'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { AppText } from '@/components/app-text'
import { useGetBalance } from '@/components/account/use-get-balance'
import { lamportsToSol } from '@/utils/lamports-to-sol'

export function AccountUiBalance({ address }: { address: PublicKey }) {
  const query = useGetBalance({ address })

  if (query.data === undefined) {
    if (query.isError) {
      return (
        <View style={styles.container}>
          <AppText style={styles.errorText}>No se pudo cargar el saldo</AppText>
        </View>
      )
    }

    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color="#087F5B" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <AppText style={styles.balanceText}>{lamportsToSol(query.data)} SOL</AppText>

      {query.isError ? <AppText style={styles.refreshError}>Actualización fallida</AppText> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
  loading: {
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  balanceText: {
    color: '#172D48',
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '800',
  },
  errorText: {
    color: '#B42318',
    fontSize: 16,
    fontWeight: '700',
  },
  refreshError: {
    marginTop: 2,
    color: '#B42318',
    fontSize: 11,
  },
})
