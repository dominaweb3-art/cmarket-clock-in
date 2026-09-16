import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { Connection } from '@solana/web3.js'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppText } from '@/components/app-text'
import { LanguageSelector } from '@/components/i18n/language-selector'
import { useI18n } from '@/components/i18n/i18n-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { C3_CORE_MAINNET_CONFIG } from '@/constants/c3-core-mainnet'
import { assertC3MainnetExecution } from '@/services/c3-core-mainnet-core'
import { C3CoreMainnetEngine, C3CoreMainnetReview } from '@/services/c3-core-mainnet-engine'
import { C3CoreMainnetPurchaseIntent } from '@/services/c3-core-mainnet-state'

export default function C3MainnetScreen() {
  const router = useRouter()
  const { t } = useI18n()
  const { account, signAndSendTransactions } = useMobileWallet()
  const { selectedCluster } = useCluster()
  const [amount, setAmount] = useState('50')
  const [purchase, setPurchase] = useState<C3CoreMainnetPurchaseIntent>()
  const [review, setReview] = useState<C3CoreMainnetReview>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const guard = useMemo(() => {
    try {
      assertC3MainnetExecution(selectedCluster.network)
      return true
    } catch {
      return false
    }
  }, [selectedCluster.network])

  const engine = useMemo(() => {
    if (!guard || !account) return undefined
    return new C3CoreMainnetEngine({
      walletAddress: account.address.toBase58(),
      configuredCluster: selectedCluster.network,
      connection: new Connection(C3_CORE_MAINNET_CONFIG.policy.rpcEndpoint, 'confirmed'),
      sendTransaction: (transaction, minContextSlot) => signAndSendTransactions(transaction, minContextSlot),
    })
  }, [account, guard, selectedCluster.network, signAndSendTransactions])

  if (!guard) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.disabledState}>
          <AppText style={styles.title}>{t('c3Mainnet.disabledTitle')}</AppText>
          <AppText style={styles.description}>{t('c3Mainnet.disabledDescription')}</AppText>
          <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
            <AppText style={styles.secondaryButtonText}>{t('c3Mainnet.back')}</AppText>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const prepareReview = async () => {
    if (!engine) {
      setError(t('c3Mainnet.walletRequired'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const nextPurchase = purchase ?? (await engine.createPurchase(amount.replace(',', '.')))
      const nextReview = await engine.quoteNextLeg(nextPurchase.id)
      setPurchase((await engine.getPurchase(nextPurchase.id)) ?? nextPurchase)
      setReview(nextReview)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('c3Mainnet.quoteError'))
    } finally {
      setBusy(false)
    }
  }

  const approveLeg = async () => {
    if (!engine || !purchase) return
    setBusy(true)
    setError('')
    try {
      const nextPurchase = await engine.approveAndConfirmNextLeg(purchase.id)
      setPurchase(nextPurchase)
      setReview(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('c3Mainnet.executionError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <LanguageSelector />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <AppText style={styles.backText}>‹</AppText>
          </Pressable>
          <AppText style={styles.title}>{t('c3Mainnet.title')}</AppText>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.warningCard}>
          <AppText style={styles.warningTitle}>{t('c3Mainnet.network')}</AppText>
          <AppText style={styles.warningText}>{t('c3Mainnet.disclosure')}</AppText>
        </View>

        {!purchase ? (
          <View style={styles.card}>
            <AppText style={styles.sectionTitle}>{t('c3Mainnet.amount')}</AppText>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              style={styles.input}
              accessibilityLabel={t('c3Mainnet.amount')}
            />
            <AppText style={styles.minimum}>{t('c3Mainnet.minimum')}</AppText>
            <AllocationSummary />
            <Pressable disabled={busy} onPress={() => void prepareReview()} style={styles.primaryButton}>
              <AppText style={styles.primaryButtonText}>
                {busy ? t('c3Mainnet.loading') : t('c3Mainnet.review')}
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {review ? (
          <View style={styles.card}>
            <AppText style={styles.sectionTitle}>{t('c3Mainnet.reviewTitle')}</AppText>
            <AppText style={styles.legTitle}>{review.leg}</AppText>
            <ReviewRow
              label={t('c3Mainnet.input')}
              value={`${formatUsdcBaseUnits(review.inputAmountBaseUnits)} USDC`}
            />
            <ReviewRow
              label={t('c3Mainnet.estimatedOutput')}
              value={formatAssetBaseUnits(review.leg, review.expectedOutputBaseUnits)}
            />
            <ReviewRow
              label={t('c3Mainnet.minimumOutput')}
              value={formatAssetBaseUnits(review.leg, review.minimumOutputBaseUnits)}
            />
            <ReviewRow label={t('c3Mainnet.priceImpact')} value={review.priceImpactPct ?? 'n/a'} />
            <ReviewRow label={t('c3Mainnet.slippage')} value={`${review.slippageBps} bps`} />
            <ReviewRow label={t('c3Mainnet.fees')} value={review.fee} />
            <ReviewRow
              label={t('c3Mainnet.tokenAccountSetup')}
              value={review.estimatedTokenAccountCreation ? t('c3Mainnet.required') : t('c3Mainnet.notRequired')}
            />
            <ReviewRow
              label={t('c3Mainnet.route')}
              value={
                review.route
                  .map((item) => item.label)
                  .filter(Boolean)
                  .join(', ') || t('c3Mainnet.routeUnavailable')
              }
            />
            <AppText style={styles.disclosure}>{t('c3Mainnet.approvalDisclosure')}</AppText>
            <Pressable disabled={busy} onPress={() => void approveLeg()} style={styles.primaryButton}>
              <AppText style={styles.primaryButtonText}>
                {busy ? t('c3Mainnet.processing') : t('c3Mainnet.approve')}
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {purchase ? (
          <View style={styles.card}>
            <AppText style={styles.sectionTitle}>{t('c3Mainnet.progress')}</AppText>
            {(['cbBTC', 'portalETH', 'SOL'] as const).map((leg) => (
              <View key={leg}>
                <ReviewRow label={leg} value={purchase.legs[leg].state} />
                {purchase.legs[leg].signature ? (
                  <Pressable
                    onPress={() =>
                      void Linking.openURL(`https://explorer.solana.com/tx/${purchase.legs[leg].signature}`)
                    }
                    accessibilityRole="link"
                  >
                    <AppText style={styles.explorerLink}>{t('c3Mainnet.openExplorer')}</AppText>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {!review && purchase.state !== 'completed' ? (
              <Pressable disabled={busy} onPress={() => void prepareReview()} style={styles.primaryButton}>
                <AppText style={styles.primaryButtonText}>
                  {busy ? t('c3Mainnet.loading') : t('c3Mainnet.nextLeg')}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {error ? <AppText style={styles.error}>{error}</AppText> : null}
        <AppText style={styles.footer}>{t('c3Mainnet.noRebalance')}</AppText>
      </ScrollView>
    </SafeAreaView>
  )
}

function AllocationSummary() {
  const { t } = useI18n()
  return (
    <View style={styles.allocation}>
      <ReviewRow label={t('c3Mainnet.cbBTC')} value="40%" />
      <ReviewRow label={t('c3Mainnet.portalETH')} value="30%" />
      <ReviewRow label={t('c3Mainnet.sol')} value="30%" />
    </View>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText style={styles.rowLabel}>{label}</AppText>
      <AppText style={styles.rowValue}>{value}</AppText>
    </View>
  )
}

function formatUsdcBaseUnits(value: string) {
  return (Number(value) / 10 ** C3_CORE_MAINNET_CONFIG.decimals.USDC).toFixed(2)
}

function formatAssetBaseUnits(leg: C3CoreMainnetReview['leg'], value: string) {
  const decimals =
    leg === 'cbBTC'
      ? C3_CORE_MAINNET_CONFIG.decimals.cbBTC
      : leg === 'portalETH'
        ? C3_CORE_MAINNET_CONFIG.decimals.portalETH
        : C3_CORE_MAINNET_CONFIG.decimals.SOL
  return `${(Number(value) / 10 ** decimals).toFixed(Math.min(decimals, 8))} ${leg === 'portalETH' ? 'Portal ETH' : leg}`
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F7FB' },
  content: { padding: 18, paddingBottom: 32, gap: 14 },
  disabledState: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#172D48', fontSize: 40, fontWeight: '300' },
  headerSpacer: { width: 40 },
  title: { flex: 1, color: '#172D48', fontSize: 25, fontWeight: '800', textAlign: 'center' },
  description: { color: '#526A84', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  card: { padding: 18, borderRadius: 22, backgroundColor: '#FFFFFF', gap: 12, elevation: 2 },
  warningCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#FFF6E5',
    borderWidth: 1,
    borderColor: '#F2D28C',
    gap: 6,
  },
  warningTitle: { color: '#7A4B00', fontSize: 13, fontWeight: '800' },
  warningText: { color: '#7A4B00', fontSize: 13, lineHeight: 19 },
  sectionTitle: { color: '#172D48', fontSize: 19, fontWeight: '800' },
  legTitle: { color: '#087F5B', fontSize: 18, fontWeight: '800' },
  input: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#D9E3EF',
    borderRadius: 14,
    color: '#172D48',
    fontSize: 24,
    fontWeight: '800',
  },
  minimum: { color: '#58718F', fontSize: 13 },
  allocation: { gap: 2 },
  row: {
    paddingVertical: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECF3',
  },
  rowLabel: { flex: 1, color: '#526A84', fontSize: 14 },
  rowValue: { color: '#172D48', fontSize: 14, fontWeight: '800', textAlign: 'right' },
  disclosure: { color: '#526A84', fontSize: 13, lineHeight: 19 },
  primaryButton: { alignItems: 'center', paddingVertical: 15, borderRadius: 16, backgroundColor: '#087F5B' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', paddingVertical: 14, borderRadius: 16, backgroundColor: '#E8EDF3' },
  secondaryButtonText: { color: '#172D48', fontSize: 16, fontWeight: '800' },
  error: { color: '#B42318', fontSize: 14, fontWeight: '700' },
  footer: { color: '#73849A', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  explorerLink: { marginTop: 2, color: '#1761A0', fontSize: 12, fontWeight: '700', textAlign: 'right' },
})
