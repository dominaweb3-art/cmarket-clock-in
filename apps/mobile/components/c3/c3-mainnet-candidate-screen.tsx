import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppText } from '@/components/app-text'
import { LanguageSelector } from '@/components/i18n/language-selector'
import { C3_CORE_MAINNET_POLICY } from '@/services/c3-core-mainnet-core'
import {
  assertCandidateExecutionDisabled,
  fetchCandidateQuotes,
  type CandidateQuote,
} from '@/services/c3-mainnet-candidate-quotes'

const PURCHASE_SIZES = [50, 100, 500] as const

function formatTokenAmount(value: string | undefined, decimals: number): string {
  if (!value) return 'Unavailable'
  const digits = value.padStart(decimals + 1, '0')
  const split = digits.length - decimals
  const whole = digits.slice(0, split)
  const fraction = digits.slice(split).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function quoteTimestamp(value: string | undefined): string {
  if (!value) return 'Not available'
  return new Date(value).toLocaleTimeString()
}

function QuoteCard({ quote }: { quote: CandidateQuote }) {
  const { leg } = quote
  return (
    <View style={styles.quoteCard}>
      <View style={styles.quoteHeader}>
        <View style={styles.quoteHeaderText}>
          <AppText style={styles.quoteLabel}>{leg.label}</AppText>
          <AppText style={styles.quoteInput}>
            {leg.inputAmountUsdc.toFixed(2)} USDC · {leg.allocationPercent}% allocation
          </AppText>
        </View>
        <View style={[styles.statusPill, quote.status !== 'verified' && styles.statusPillMuted]}>
          <AppText style={styles.statusText}>{quote.status === 'verified' ? 'LIVE' : 'UNAVAILABLE'}</AppText>
        </View>
      </View>

      {quote.status === 'verified' ? (
        <>
          <View style={styles.dataGrid}>
            <DataRow
              label="Expected output"
              value={`${formatTokenAmount(quote.expectedOutputBaseUnits, leg.outputDecimals)} ${leg.symbol}`}
            />
            <DataRow
              label="Minimum received"
              value={`${formatTokenAmount(quote.minimumOutputBaseUnits, leg.outputDecimals)} ${leg.symbol}`}
            />
            <DataRow label="Price impact" value={`${quote.priceImpactPct ?? '0'}%`} />
            <DataRow label="Slippage" value={`${C3_CORE_MAINNET_POLICY.maximumSlippageBps} bps max`} />
            <DataRow
              label="Route provider"
              value={quote.routeLabels.length ? quote.routeLabels.join(' → ') : 'Jupiter route'}
            />
            <DataRow
              label="Route program"
              value={
                quote.routePrograms.length
                  ? quote.routePrograms.join(', ')
                  : 'Not exposed by quote; build validation required'
              }
            />
            <DataRow label="Quoted at" value={quoteTimestamp(quote.observedAt)} />
            <DataRow label="Context slot" value={quote.contextSlot ? String(quote.contextSlot) : 'Not returned'} />
            <DataRow label="Destination" value="Current user wallet (not connected)" />
          </View>
          {leg.id === 'SOL' ? (
            <AppText style={styles.disclosure}>
              Jupiter quotes WSOL internally; the intended final user asset is native SOL.
            </AppText>
          ) : null}
        </>
      ) : (
        <AppText style={styles.errorText}>{quote.reason ?? 'No quote is available for this leg.'}</AppText>
      )}
    </View>
  )
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <AppText style={styles.dataLabel}>{label}</AppText>
      <AppText style={styles.dataValue}>{value}</AppText>
    </View>
  )
}

export default function C3MainnetCandidateScreen() {
  const [purchaseSize, setPurchaseSize] = useState<(typeof PURCHASE_SIZES)[number]>(50)
  const [quotes, setQuotes] = useState<CandidateQuote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [executionMessage, setExecutionMessage] = useState('')
  const requestId = useRef(0)

  const loadQuotes = useCallback(async (size: (typeof PURCHASE_SIZES)[number]) => {
    const id = requestId.current + 1
    requestId.current = id
    setLoading(true)
    setError('')
    try {
      const nextQuotes = await fetchCandidateQuotes(size)
      if (requestId.current === id) setQuotes(nextQuotes)
    } catch (cause) {
      if (requestId.current === id) {
        setQuotes([])
        setError(cause instanceof Error ? cause.message : 'Quote refresh failed.')
      }
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const refresh = setTimeout(() => {
      void loadQuotes(purchaseSize)
    }, 0)
    return () => clearTimeout(refresh)
  }, [loadQuotes, purchaseSize])

  const handleExecutionAttempt = () => {
    try {
      assertCandidateExecutionDisabled()
    } catch (cause) {
      setExecutionMessage(cause instanceof Error ? cause.message : 'Execution is disabled in this candidate build.')
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadQuotes(purchaseSize)} />}
      >
        <View style={styles.header}>
          <View>
            <AppText style={styles.eyebrow}>C MARKET</AppText>
            <AppText style={styles.title}>C3 Core Mainnet candidate</AppText>
            <AppText style={styles.subtitle}>Read-only index preview</AppText>
          </View>
          <View style={styles.networkPill}>
            <AppText style={styles.networkText}>MAINNET</AppText>
            <AppText style={styles.networkSubtext}>CANDIDATE</AppText>
          </View>
        </View>

        <LanguageSelector />

        <View style={styles.noticeCard}>
          <AppText style={styles.noticeTitle}>Read-only Mainnet candidate.</AppText>
          <AppText style={styles.noticeText}>No transaction will be signed or submitted.</AppText>
          <AppText style={styles.noticeText}>Quotes can change before execution.</AppText>
          <AppText style={styles.noticeText}>
            cbBTC and Portal ETH carry issuer, bridge, redemption, and depeg risks.
          </AppText>
          <AppText style={styles.noticeText}>The stable CLOCK IN submission remains on Devnet.</AppText>
        </View>

        <View style={styles.card}>
          <AppText style={styles.sectionTitle}>C3 Core target allocation</AppText>
          <AppText style={styles.sectionText}>
            A fixed strategic allocation: cbBTC 40% · Portal ETH 30% · native SOL 30%.
          </AppText>
          <AppText style={styles.sectionText}>Choose a read-only quote size in USDC.</AppText>
          <View style={styles.sizeRow}>
            {PURCHASE_SIZES.map((size) => (
              <Pressable
                key={size}
                accessibilityRole="button"
                accessibilityState={{ selected: purchaseSize === size }}
                onPress={() => setPurchaseSize(size)}
                style={[styles.sizeButton, purchaseSize === size && styles.sizeButtonSelected]}
              >
                <AppText style={[styles.sizeButtonText, purchaseSize === size && styles.sizeButtonTextSelected]}>
                  {size} USDC
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>

        {error ? <AppText style={styles.errorText}>{error}</AppText> : null}
        {loading && !quotes.length ? (
          <AppText style={styles.loadingText}>Refreshing three Jupiter quotes sequentially…</AppText>
        ) : null}
        {quotes.map((quote) => (
          <QuoteCard key={quote.leg.id} quote={quote} />
        ))}

        <View style={styles.executionCard}>
          <AppText style={styles.executionTitle}>Execution is disabled in this candidate build.</AppText>
          <AppText style={styles.executionText}>
            This screen never connects a wallet, requests Mobile Wallet Adapter authorization, creates a transaction, or
            submits a transaction.
          </AppText>
          <Pressable accessibilityRole="button" onPress={handleExecutionAttempt} style={styles.executionButton}>
            <AppText style={styles.executionButtonText}>Attempt execution</AppText>
          </Pressable>
          {executionMessage ? <AppText style={styles.executionMessage}>{executionMessage}</AppText> : null}
        </View>

        <AppText style={styles.footer}>
          Quote expiration: Jupiter quote responses provide a context slot, not a durable execution guarantee. Refresh
          immediately before any separately reviewed future execution.
        </AppText>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F7FB' },
  content: { gap: 14, padding: 18, paddingBottom: 34 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: '#087F5B', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  title: { color: '#172D48', fontSize: 25, lineHeight: 30, fontWeight: '900', maxWidth: 260 },
  subtitle: { color: '#667991', fontSize: 14, marginTop: 4 },
  networkPill: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FFF1D7',
  },
  networkText: { color: '#995F00', fontSize: 10, fontWeight: '900' },
  networkSubtext: { color: '#995F00', fontSize: 9, fontWeight: '700', marginTop: 2 },
  noticeCard: {
    gap: 5,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#FFF8E8',
    borderWidth: 1,
    borderColor: '#F2D28D',
  },
  noticeTitle: { color: '#754A00', fontSize: 16, fontWeight: '900' },
  noticeText: { color: '#805E26', fontSize: 13, lineHeight: 19 },
  card: {
    gap: 10,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    shadowColor: '#18324E',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  sectionTitle: { color: '#172D48', fontSize: 17, fontWeight: '900' },
  sectionText: { color: '#526A84', fontSize: 13, lineHeight: 19 },
  sizeRow: { flexDirection: 'row', gap: 8 },
  sizeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#EDF2F7',
    borderWidth: 1,
    borderColor: '#DCE5EE',
  },
  sizeButtonSelected: { backgroundColor: '#087F5B', borderColor: '#087F5B' },
  sizeButtonText: { color: '#526A84', fontSize: 13, fontWeight: '800' },
  sizeButtonTextSelected: { color: '#FFFFFF' },
  quoteCard: {
    gap: 10,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE6EF',
  },
  quoteHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  quoteHeaderText: { flex: 1, gap: 3 },
  quoteLabel: { color: '#172D48', fontSize: 15, fontWeight: '900' },
  quoteInput: { color: '#718198', fontSize: 12 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: '#DDF4EC' },
  statusPillMuted: { backgroundColor: '#FDE7E7' },
  statusText: { color: '#087F5B', fontSize: 9, fontWeight: '900' },
  dataGrid: { gap: 6 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  dataLabel: { flex: 1, color: '#718198', fontSize: 12 },
  dataValue: { flex: 1.4, color: '#233D5B', fontSize: 12, fontWeight: '800', textAlign: 'right' },
  disclosure: { color: '#805E26', fontSize: 12, lineHeight: 18 },
  loadingText: { color: '#526A84', fontSize: 13, textAlign: 'center' },
  errorText: { color: '#B42318', fontSize: 13, lineHeight: 19 },
  executionCard: {
    gap: 8,
    padding: 15,
    borderRadius: 18,
    backgroundColor: '#F0F2F5',
    borderWidth: 1,
    borderColor: '#CAD3DE',
  },
  executionTitle: { color: '#334155', fontSize: 16, fontWeight: '900' },
  executionText: { color: '#526A84', fontSize: 13, lineHeight: 19 },
  executionButton: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#64748B' },
  executionButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  executionMessage: { color: '#334155', fontSize: 13, fontWeight: '800' },
  footer: { color: '#718198', fontSize: 11, lineHeight: 17, textAlign: 'center' },
})
