import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import Clipboard from '@react-native-clipboard/clipboard'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppText } from '@/components/app-text'
import { useI18n } from '@/components/i18n/i18n-provider'
import { loadDevnetPaymentReceipts } from '@/services/devnet-payment-receipt-storage'
import type { DevnetPaymentReceipt } from '@/services/devnet-payment-receipts'
import { ellipsify } from '@/utils/ellipsify'

export default function ActivityScreen() {
  const router = useRouter()
  const { account } = useMobileWallet()
  const { locale, t } = useI18n()
  const [receipts, setReceipts] = useState<DevnetPaymentReceipt[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [expandedSignature, setExpandedSignature] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const stored = await loadDevnetPaymentReceipts()
      const walletAddress = account?.address?.toString()
      setReceipts(walletAddress ? stored.filter((receipt) => receipt.walletAddress === walletAddress) : [])
    } finally {
      setRefreshing(false)
    }
  }, [account?.address])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const copySignature = (signature: string) => {
    Clipboard.setString(signature)
    Alert.alert(t('activity.signatureCopiedTitle'), t('activity.signatureCopiedMessage'))
  }

  const openExplorer = (receipt: DevnetPaymentReceipt) => {
    Linking.openURL(receipt.explorerUrl).catch(() => {
      Alert.alert(t('activity.explorerErrorTitle'), t('activity.explorerErrorMessage'))
    })
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#087F5B" />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('activity.back')} onPress={() => router.back()}>
            <AppText style={styles.back}>‹</AppText>
          </Pressable>
          <AppText style={styles.title}>{t('activity.title')}</AppText>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.introCard}>
          <AppText style={styles.introTitle}>{t('activity.introTitle')}</AppText>
          <AppText style={styles.introDescription}>{t('activity.introDescription')}</AppText>
        </View>

        {receipts.length === 0 ? (
          <View style={styles.emptyCard}>
            <AppText style={styles.emptyTitle}>{t('activity.emptyTitle')}</AppText>
            <AppText style={styles.emptyDescription}>{t('activity.emptyDescription')}</AppText>
          </View>
        ) : (
          <View style={styles.list}>
            {receipts.map((receipt) => {
              const expanded = expandedSignature === receipt.signature
              const confirmedAt = new Date(receipt.confirmedAt).toLocaleString(locale)

              return (
                <View key={receipt.signature} style={styles.receiptCard}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    onPress={() => setExpandedSignature(expanded ? null : receipt.signature)}
                  >
                    <View style={styles.receiptHeader}>
                      <View style={styles.statusDot} />
                      <View style={styles.receiptHeading}>
                        <AppText style={styles.receiptTitle}>{t('activity.payment')}</AppText>
                        <AppText style={styles.receiptSignature}>{ellipsify(receipt.signature, 10)}</AppText>
                      </View>
                      <AppText style={styles.receiptAmount}>{receipt.amountUsdc} USDC</AppText>
                    </View>
                  </Pressable>

                  {expanded ? (
                    <View style={styles.details}>
                      <Detail label={t('activity.status')} value={t('activity.confirmed')} />
                      <Detail label={t('activity.network')} value="Solana Devnet" />
                      <Detail label={t('activity.wallet')} value={ellipsify(receipt.walletAddress, 8)} />
                      <Detail label={t('activity.treasury')} value={ellipsify(receipt.treasuryAddress, 8)} />
                      <Detail label={t('activity.time')} value={confirmedAt} />
                      <AppText style={styles.truthfulNote}>{t('activity.truthfulNote')}</AppText>
                      <View style={styles.actions}>
                        <Pressable style={styles.actionButton} onPress={() => copySignature(receipt.signature)}>
                          <AppText style={styles.actionText}>{t('activity.copySignature')}</AppText>
                        </Pressable>
                        <Pressable style={styles.actionButton} onPress={() => openExplorer(receipt)}>
                          <AppText style={styles.actionText}>{t('activity.openExplorer')}</AppText>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <AppText style={styles.detailLabel}>{label}</AppText>
      <AppText style={styles.detailValue}>{value}</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F7FB' },
  content: { padding: 20, paddingBottom: 36, gap: 16 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: '#172D48', fontSize: 40, fontWeight: '300' },
  title: { flex: 1, color: '#172D48', fontSize: 25, fontWeight: '800', textAlign: 'center' },
  headerSpacer: { width: 28 },
  introCard: {
    padding: 18,
    gap: 6,
    borderRadius: 20,
    backgroundColor: '#E9FAF4',
    borderWidth: 1,
    borderColor: '#C8F0E2',
  },
  introTitle: { color: '#16543F', fontSize: 16, fontWeight: '800' },
  introDescription: { color: '#487967', fontSize: 13, lineHeight: 19 },
  emptyCard: { padding: 24, gap: 8, alignItems: 'center', borderRadius: 20, backgroundColor: '#FFFFFF' },
  emptyTitle: { color: '#172D48', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyDescription: { color: '#667991', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  list: { gap: 12 },
  receiptCard: {
    padding: 16,
    gap: 14,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7F2',
  },
  receiptHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#18B981' },
  receiptHeading: { flex: 1, gap: 3 },
  receiptTitle: { color: '#172D48', fontSize: 15, fontWeight: '800' },
  receiptSignature: { color: '#58718F', fontSize: 12, fontFamily: 'SpaceMono' },
  receiptAmount: { color: '#087F5B', fontSize: 15, fontWeight: '800' },
  details: { gap: 10, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#E6ECF3' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { color: '#667991', fontSize: 12 },
  detailValue: { flex: 1, color: '#172D48', fontSize: 12, fontWeight: '700', textAlign: 'right' },
  truthfulNote: { color: '#526A84', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: '#EAF3FF' },
  actionText: { color: '#1761A0', fontSize: 12, fontWeight: '800' },
})
