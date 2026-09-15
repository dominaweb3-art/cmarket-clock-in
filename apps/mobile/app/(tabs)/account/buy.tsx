import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { useRouter } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Clipboard from '@react-native-clipboard/clipboard'

import { AppText } from '@/components/app-text'
import { useGetUsdcBalance } from '@/components/account/use-get-usdc-balance'
import { ellipsify } from '@/utils/ellipsify'
import { useCluster } from '@/components/cluster/cluster-provider'
import { AppConfig } from '@/constants/app-config'
import { useI18n } from '@/components/i18n/i18n-provider'

const MIN_PURCHASE_USDC = 5
const QUICK_AMOUNTS = [5, 10, 50]

const PURCHASE_ERROR_MARKERS = {
  cancelled: ['cancel', 'declin', 'denied', 'reject', 'not signed', 'user abort'],
  insufficientSol: [
    'insufficient funds for fee',
    'insufficient lamports',
    'insufficient sol',
    'fee payer',
    'no record of a prior credit',
  ],
  networkMismatch: ['chain mismatch', 'network mismatch', 'unsupported chain', 'wrong network'],
  rpc: [
    '429',
    '502',
    '503',
    'blockhash not found',
    'fetch failed',
    'network request failed',
    'rpc',
    'timed out',
    'timeout',
  ],
} as const

type ParsedTokenAccountData = {
  parsed?: {
    info?: {
      tokenAmount?: {
        uiAmount?: number | null
        uiAmountString?: string
      }
    }
  }
}

function formatUsdc(value: number) {
  if (!Number.isFinite(value)) return '$0'

  return Number.isInteger(value) ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`
}

function purchaseErrorKey(cause: unknown) {
  const errorName = cause instanceof Error ? cause.name : ''
  const errorMessage =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === 'object' && 'message' in cause
        ? String(cause.message)
        : typeof cause === 'string'
          ? cause
          : ''
  const normalizedError = `${errorName} ${errorMessage}`.toLowerCase()
  const includesMarker = (markers: readonly string[]) => markers.some((marker) => normalizedError.includes(marker))

  if (includesMarker(PURCHASE_ERROR_MARKERS.cancelled)) return 'buy.cancelled' as const
  if (includesMarker(PURCHASE_ERROR_MARKERS.insufficientSol)) return 'buy.insufficientSol' as const
  if (includesMarker(PURCHASE_ERROR_MARKERS.networkMismatch)) return 'buy.networkMismatch' as const
  if (includesMarker(PURCHASE_ERROR_MARKERS.rpc)) return 'buy.rpcError' as const

  return 'buy.sendFailed' as const
}

export default function BuyScreen() {
  const router = useRouter()
  const { account, signTransactions } = useMobileWallet()
  const { getExplorerUrl } = useCluster()
  const { t } = useI18n()

  const [amount, setAmount] = useState('5')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signature, setSignature] = useState('')
  const submissionLockRef = useRef(false)

  const connection = useMemo(() => new Connection(AppConfig.endpoint, 'confirmed'), [])

  const numericAmount = Number(amount.replace(',', '.'))
  const walletAddress = account?.address?.toString()

  const walletPublicKey = useMemo(() => {
    if (!walletAddress) return undefined

    try {
      return new PublicKey(walletAddress)
    } catch {
      return undefined
    }
  }, [walletAddress])

  const usdcQuery = useGetUsdcBalance({
    address: walletPublicKey,
  })

  const usdcDisplay = !walletPublicKey
    ? t('buy.connectWallet')
    : usdcQuery.isLoading
      ? t('buy.loadingBalance')
      : usdcQuery.error
        ? t('buy.balanceUnavailable')
        : `${(usdcQuery.balance ?? 0).toFixed(2)} USDC`

  const handleAmountChange = (value: string) => {
    const cleanValue = value.replace(',', '.').replace(/[^0-9.]/g, '')

    setAmount(cleanValue)
    setError('')
  }

  const handlePurchase = async () => {
    if (submissionLockRef.current) {
      return
    }

    setError('')

    if (!account || !walletPublicKey) {
      setError(t('buy.walletRequired'))
      return
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError(t('buy.invalidAmount'))
      return
    }

    if (numericAmount < MIN_PURCHASE_USDC) {
      setError(t('buy.minimumError'))
      return
    }

    if (usdcQuery.isLoading) {
      setError(t('buy.waitForBalance'))
      return
    }

    const availableUsdc = usdcQuery.balance

    if (usdcQuery.error || availableUsdc === undefined) {
      setError(t('buy.verifyBalanceError'))
      return
    }

    if (numericAmount > availableUsdc) {
      setError(
        t('buy.insufficientBalance', {
          available: formatUsdc(availableUsdc),
          needed: formatUsdc(numericAmount),
        }),
      )
      return
    }

    submissionLockRef.current = true
    setIsSubmitting(true)

    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
        mint: AppConfig.usdcMint,
      })

      const sourceTokenAccount = tokenAccounts.value.find((item) => {
        const data = item.account.data as unknown as ParsedTokenAccountData
        const tokenAmount = data.parsed?.info?.tokenAmount

        const accountBalance = Number(tokenAmount?.uiAmountString ?? tokenAmount?.uiAmount ?? 0)

        return accountBalance >= numericAmount
      })

      if (!sourceTokenAccount) {
        setError(t('buy.tokenAccountError'))
        return
      }

      const destinationTokenAccount = await getAssociatedTokenAddress(AppConfig.usdcMint, AppConfig.treasuryPublicKey)

      const transaction = new Transaction()

      const destinationExists = await connection.getAccountInfo(destinationTokenAccount)

      if (!destinationExists) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            walletPublicKey,
            destinationTokenAccount,
            AppConfig.treasuryPublicKey,
            AppConfig.usdcMint,
          ),
        )
      }

      const amountInBaseUnits = Math.round(numericAmount * 10 ** AppConfig.usdcDecimals)

      transaction.add(
        createTransferCheckedInstruction(
          sourceTokenAccount.pubkey,
          AppConfig.usdcMint,
          destinationTokenAccount,
          walletPublicKey,
          amountInBaseUnits,
          AppConfig.usdcDecimals,
        ),
      )

      const latestBlockhash = await connection.getLatestBlockhash('confirmed')

      transaction.feePayer = walletPublicKey
      transaction.recentBlockhash = latestBlockhash.blockhash

      const signedTransaction = await signTransactions(transaction)

      const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      })

      await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      )

      setSignature(signature)
      await usdcQuery.refresh()

      Alert.alert(
        t('buy.paymentSentTitle'),
        t('buy.paymentSentMessage', { amount: formatUsdc(numericAmount), signature }),
      )
    } catch (cause) {
      setError(t(purchaseErrorKey(cause)))
    } finally {
      submissionLockRef.current = false
      setIsSubmitting(false)
    }
  }

  const copySignature = () => {
    Clipboard.setString(signature)
    Alert.alert(t('buy.signatureCopiedTitle'), t('buy.signatureCopiedMessage'))
  }

  const openExplorer = () => {
    Linking.openURL(getExplorerUrl(`tx/${signature}`)).catch(() => {
      Alert.alert(t('buy.explorerErrorTitle'), t('buy.explorerErrorMessage'))
    })
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <AppText style={styles.backText}>‹</AppText>
            </Pressable>

            <AppText style={styles.headerTitle}>{t('buy.title')}</AppText>

            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <AppText style={styles.sectionTitle}>{t('buy.amount')}</AppText>
              <AppText style={styles.minimum}>{t('buy.minimum')}</AppText>
            </View>

            <View style={styles.amountInput}>
              <AppText style={styles.currency}>$</AppText>

              <TextInput
                value={amount}
                onChangeText={handleAmountChange}
                keyboardType="decimal-pad"
                placeholder="5"
                placeholderTextColor="#8A9AB0"
                style={styles.input}
                selectionColor="#087F5B"
              />
            </View>

            <View style={styles.quickAmounts}>
              {QUICK_AMOUNTS.map((quickAmount) => {
                const selected = numericAmount === quickAmount

                return (
                  <Pressable
                    key={quickAmount}
                    onPress={() => {
                      setAmount(String(quickAmount))
                      setError('')
                    }}
                    style={[styles.quickButton, selected && styles.quickButtonSelected]}
                  >
                    <AppText style={[styles.quickButtonText, selected && styles.quickButtonTextSelected]}>
                      ${quickAmount}
                    </AppText>
                  </Pressable>
                )
              })}
            </View>

            {error ? <AppText style={styles.error}>{error}</AppText> : null}
          </View>

          <View style={styles.card}>
            <View style={styles.paymentHeader}>
              <View style={styles.usdcIcon}>
                <AppText style={styles.usdcIconText}>$</AppText>
              </View>

              <AppText style={styles.paymentTitle}>{t('buy.payWithUsdc')}</AppText>

              <Pressable onPress={() => Alert.alert('USDC', t('buy.usdcPaymentAsset'))}>
                <AppText style={styles.changeText}>{t('buy.change')}</AppText>
              </Pressable>
            </View>

            <View style={styles.walletRow}>
              <View style={styles.walletAvatar} />

              <View style={styles.walletInfo}>
                <AppText style={styles.walletAddress}>
                  {walletAddress ? ellipsify(walletAddress, 6) : t('buy.walletNotConnected')}
                </AppText>

                <View style={styles.connectedRow}>
                  <View style={styles.connectedDot} />

                  <AppText style={styles.connectedText}>
                    {account ? t('buy.walletConnected') : t('buy.connectWallet')}
                  </AppText>
                </View>
              </View>

              <AppText style={styles.chevron}>›</AppText>
            </View>

            <View style={styles.availableBalanceRow}>
              <AppText style={styles.availableBalanceLabel}>{t('buy.availableUsdc')}</AppText>

              <AppText style={[styles.availableBalanceValue, usdcQuery.error && styles.availableBalanceError]}>
                {usdcDisplay}
              </AppText>
            </View>
          </View>

          <View style={styles.card}>
            <AppText style={styles.summaryTitle}>{t('buy.summary')}</AppText>

            <View style={styles.summaryRow}>
              <AppText style={styles.summaryLabel}>{t('buy.amountToPay')}</AppText>

              <AppText style={styles.summaryValue}>{formatUsdc(numericAmount)} USDC</AppText>
            </View>

            <View style={styles.summaryRow}>
              <AppText style={styles.summaryLabel}>{t('buy.c3Status')}</AppText>

              <AppText style={styles.summaryValue}>{t('buy.devnetPrototype')}</AppText>
            </View>

            <View style={styles.summaryRow}>
              <AppText style={styles.summaryLabel}>{t('buy.estimatedFee')}</AppText>

              <AppText style={styles.summaryValue}>{t('buy.estimatedFeeValue')}</AppText>
            </View>

            <View style={styles.infoBox}>
              <View style={styles.infoIcon}>
                <AppText style={styles.infoIconText}>✓</AppText>
              </View>

              <AppText style={styles.infoText}>{t('buy.prototypeDisclosure')}</AppText>
            </View>
          </View>

          <Pressable
            onPress={() => void handlePurchase()}
            disabled={!account || usdcQuery.isLoading || isSubmitting}
            style={[styles.buyButton, (!account || usdcQuery.isLoading || isSubmitting) && styles.disabledButton]}
          >
            <AppText style={styles.buyButtonText}>{isSubmitting ? t('buy.processing') : t('buy.buy')}</AppText>
          </Pressable>

          {signature ? (
            <View style={styles.receiptCard}>
              <AppText style={styles.receiptTitle}>{t('buy.paymentConfirmed')}</AppText>
              <AppText style={styles.receiptSignature}>{ellipsify(signature, 10)}</AppText>
              <View style={styles.receiptActions}>
                <Pressable onPress={copySignature} style={styles.receiptButton}>
                  <AppText style={styles.receiptButtonText}>{t('buy.copySignature')}</AppText>
                </Pressable>
                <Pressable onPress={openExplorer} style={styles.receiptButton}>
                  <AppText style={styles.receiptButtonText}>{t('buy.openExplorer')}</AppText>
                </Pressable>
              </View>
            </View>
          ) : null}

          <Pressable onPress={() => router.back()} style={styles.compositionButton}>
            <AppText style={styles.compositionButtonText}>{t('buy.viewComposition')}</AppText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  content: {
    padding: 20,
    paddingBottom: 36,
    gap: 16,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    color: '#172D48',
    fontSize: 40,
    fontWeight: '300',
  },
  headerTitle: {
    flex: 1,
    color: '#172D48',
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  card: {
    padding: 20,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    shadowColor: '#172D48',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  sectionHeader: {
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#172D48',
    fontSize: 20,
    fontWeight: '800',
  },
  minimum: {
    color: '#58718F',
    fontSize: 16,
  },
  amountInput: {
    minHeight: 76,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D9E3EF',
    borderRadius: 16,
  },
  currency: {
    color: '#172D48',
    fontSize: 40,
    fontWeight: '800',
  },
  input: {
    flex: 1,
    padding: 0,
    color: '#172D48',
    fontSize: 40,
    fontWeight: '800',
  },
  quickAmounts: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  quickButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#EEF2F7',
  },
  quickButtonSelected: {
    backgroundColor: '#087F5B',
  },
  quickButtonText: {
    color: '#172D48',
    fontSize: 17,
    fontWeight: '700',
  },
  quickButtonTextSelected: {
    color: '#FFFFFF',
  },
  error: {
    marginTop: 12,
    color: '#B42318',
    fontSize: 14,
    fontWeight: '700',
  },
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  usdcIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#2879D0',
  },
  usdcIconText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  paymentTitle: {
    flex: 1,
    color: '#172D48',
    fontSize: 18,
    fontWeight: '800',
  },
  changeText: {
    color: '#456685',
    fontSize: 15,
    fontWeight: '700',
  },
  walletRow: {
    marginTop: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#F5F8FC',
    borderWidth: 1,
    borderColor: '#E2EAF3',
  },
  walletAvatar: {
    width: 42,
    height: 42,
    marginRight: 12,
    borderRadius: 21,
    backgroundColor: '#7DAEF5',
  },
  walletInfo: {
    flex: 1,
    gap: 5,
  },
  walletAddress: {
    color: '#172D48',
    fontSize: 17,
    fontWeight: '700',
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectedDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#18B981',
  },
  connectedText: {
    color: '#087F5B',
    fontSize: 13,
  },
  chevron: {
    color: '#172D48',
    fontSize: 30,
  },
  availableBalanceRow: {
    marginTop: 14,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E2EAF3',
  },
  availableBalanceLabel: {
    color: '#456685',
    fontSize: 14,
    fontWeight: '700',
  },
  availableBalanceValue: {
    color: '#2879D0',
    fontSize: 16,
    fontWeight: '800',
  },
  availableBalanceError: {
    color: '#B42318',
  },
  summaryTitle: {
    marginBottom: 10,
    color: '#172D48',
    fontSize: 19,
    fontWeight: '800',
  },
  summaryRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECF3',
  },
  summaryLabel: {
    flex: 1,
    color: '#456685',
    fontSize: 15,
  },
  summaryValue: {
    color: '#172D48',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'right',
  },
  infoBox: {
    marginTop: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#E1F7F0',
  },
  infoIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#C4EFE1',
  },
  infoIconText: {
    color: '#087F5B',
    fontSize: 22,
    fontWeight: '800',
  },
  infoText: {
    flex: 1,
    color: '#276D59',
    fontSize: 14,
    lineHeight: 20,
  },
  buyButton: {
    alignItems: 'center',
    paddingVertical: 17,
    borderRadius: 18,
    backgroundColor: '#087F5B',
  },
  disabledButton: {
    opacity: 0.5,
  },
  receiptCard: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#EAF3FF',
    borderWidth: 1,
    borderColor: '#C9DDF7',
  },
  receiptTitle: {
    color: '#172D48',
    fontSize: 16,
    fontWeight: '800',
  },
  receiptSignature: {
    marginTop: 8,
    color: '#456685',
    fontSize: 13,
    fontFamily: 'SpaceMono',
  },
  receiptActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  receiptButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  receiptButtonText: {
    color: '#1761A0',
    fontSize: 13,
    fontWeight: '800',
  },
  buyButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  compositionButton: {
    alignItems: 'center',
    paddingVertical: 17,
    borderRadius: 18,
    backgroundColor: '#DDF4ED',
  },
  compositionButtonText: {
    color: '#087F5B',
    fontSize: 17,
    fontWeight: '800',
  },
})
