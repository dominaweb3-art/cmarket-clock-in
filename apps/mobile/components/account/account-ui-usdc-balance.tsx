import { PublicKey } from '@solana/web3.js'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { AppText } from '@/components/app-text'
import { useGetUsdcBalance } from '@/components/account/use-get-usdc-balance'
import { useI18n } from '@/components/i18n/i18n-provider'

export function AccountUiUsdcBalance({ address }: { address: PublicKey }) {
  const query = useGetUsdcBalance({ address })
  const { t } = useI18n()

  if (query.balance === undefined) {
    if (query.isLoading) {
      return <ActivityIndicator size="small" color="#2879D0" />
    }

    if (query.error) {
      return <AppText style={styles.error}>{t('balance.usdcLoadError')}</AppText>
    }
  }

  return (
    <View style={styles.container}>
      <AppText style={styles.label}>{t('balance.available')}</AppText>

      <AppText style={styles.balance}>{(query.balance ?? 0).toFixed(2)} USDC</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
  },
  label: {
    color: '#58718F',
    fontSize: 12,
    fontWeight: '700',
  },
  balance: {
    color: '#2879D0',
    fontSize: 18,
    fontWeight: '800',
  },
  error: {
    marginTop: 6,
    color: '#B42318',
    fontSize: 12,
  },
})
