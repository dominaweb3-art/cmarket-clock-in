import { useMemo, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

import {
  DEVNET_TREASURY_PUBLIC_KEY,
  DEVNET_USDC_MINT,
  MIN_PURCHASE_USDC,
  USDC_DECIMALS,
} from '../config'
import { formatUsdc, getExplorerTransactionUrl } from '../solana/format'
import type { Activity, Basket } from '../types'

type BuyScreenProps = {
  basket: Basket
  onBack: () => void
  onPurchased: (activity: Activity) => void
}

export function BuyScreen({ basket, onBack, onPurchased }: BuyScreenProps) {
  const { account, connection, signAndSendTransactions } = useMobileWallet()
  const [amount, setAmount] = useState(String(MIN_PURCHASE_USDC))
  const [availableUsdc, setAvailableUsdc] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const walletPublicKey = useMemo(() => {
    if (!account?.address) return null
    return account.address
  }, [account?.address])

  const numericAmount = Number(amount.replace(',', '.'))

  const loadBalance = async () => {
    if (!walletPublicKey || !DEVNET_USDC_MINT) return

    try {
      const mint = new PublicKey(DEVNET_USDC_MINT)
      const accounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, { mint })
      const total = accounts.value.reduce((sum, item) => {
        const data = item.account.data as {
          parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } }
        }
        return sum + Number(data.parsed?.info?.tokenAmount?.uiAmount ?? 0)
      }, 0)

      setAvailableUsdc(total)
    } catch {
      setAvailableUsdc(null)
    }
  }

  const handlePurchase = async () => {
    setError('')

    if (!walletPublicKey) {
      setError('Connect your wallet before continuing.')
      return
    }

    if (!Number.isFinite(numericAmount) || numericAmount < MIN_PURCHASE_USDC) {
      setError('Enter a valid amount of at least 5 USDC.')
      return
    }

    if (!DEVNET_USDC_MINT || !DEVNET_TREASURY_PUBLIC_KEY) {
      setError('Devnet configuration is incomplete. Set the public mint and treasury values.')
      return
    }

    setIsLoading(true)

    try {
      const mint = new PublicKey(DEVNET_USDC_MINT)
      const treasury = new PublicKey(DEVNET_TREASURY_PUBLIC_KEY)
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, { mint })

      const source = tokenAccounts.value.find((item) => {
        const data = item.account.data as {
          parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } }
        }
        return Number(data.parsed?.info?.tokenAmount?.uiAmount ?? 0) >= numericAmount
      })

      if (!source) {
        setError('No Devnet USDC token account has enough balance.')
        return
      }

      const destination = getAssociatedTokenAddressSync(mint, treasury)
      const instructions = []

      const destinationInfo = await connection.getAccountInfo(destination)
      if (!destinationInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            walletPublicKey,
            destination,
            treasury,
            mint,
          ),
        )
      }

      instructions.push(
        createTransferCheckedInstruction(
          source.pubkey,
          mint,
          destination,
          walletPublicKey,
          Math.round(numericAmount * 10 ** USDC_DECIMALS),
          USDC_DECIMALS,
        ),
      )

      const {
        context: { slot: minContextSlot },
        value: latestBlockhash,
      } = await connection.getLatestBlockhashAndContext()

      const message = new TransactionMessage({
        payerKey: walletPublicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToLegacyMessage()

      const transaction = new VersionedTransaction(message)
      const result = await signAndSendTransactions(transaction, minContextSlot)
      const signature = Array.isArray(result) ? result[0] : result

      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        'confirmed',
      )

      const activity: Activity = {
        id: signature,
        basketId: basket.id,
        basketName: basket.name,
        amountUsdc: numericAmount,
        signature,
        timestamp: new Date().toISOString(),
        cluster: 'devnet',
        status: 'confirmed',
      }

      onPurchased(activity)

      Alert.alert(
        'Purchase confirmed',
        'Your Devnet USDC payment was confirmed. The basket allocation module is not enabled in this prototype.',
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown wallet or RPC error.'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.eyebrow}>PURCHASE REVIEW</Text>
        <Text style={styles.title}>Buy {basket.name}</Text>
        <Text style={styles.subtitle}>{basket.description}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Amount</Text>
          <Text style={styles.minimum}>Minimum: 5 USDC</Text>
        </View>

        <View style={styles.amountBox}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            value={amount}
            onChangeText={(value) => {
              setAmount(value.replace(',', '.').replace(/[^0-9.]/g, ''))
              setError('')
            }}
            keyboardType="decimal-pad"
            style={styles.amountInput}
            placeholder="5"
            placeholderTextColor="#9BAEC0"
          />
          <Text style={styles.token}>USDC</Text>
        </View>

        <Pressable onPress={() => void loadBalance()} style={styles.balanceButton}>
          <Text style={styles.balanceButtonText}>
            {availableUsdc === null
              ? 'Check Devnet balance'
              : 'Available: ' + formatUsdc(availableUsdc) + ' USDC'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Basket composition</Text>
        {basket.composition.map((item) => (
          <View key={item.symbol} style={styles.compositionRow}>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={styles.symbol}>{item.symbol}</Text>
            <Text style={styles.weight}>{item.weight}%</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Transaction summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.label}>You pay</Text>
          <Text style={styles.value}>{formatUsdc(numericAmount)} USDC</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.label}>Network</Text>
          <Text style={styles.value}>Solana Devnet</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.label}>Destination</Text>
          <Text style={styles.value}>Configured Devnet treasury</Text>
        </View>
        <Text style={styles.warning}>
          This prototype records and verifies the Devnet payment. It does not yet
          execute a production-grade basket allocation.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        onPress={() => void handlePurchase()}
        disabled={isLoading}
        style={[styles.primaryButton, isLoading && styles.disabledButton]}
      >
        <Text style={styles.primaryButtonText}>
          {isLoading ? 'Waiting for wallet…' : 'Approve Devnet purchase'}
        </Text>
      </Pressable>

      <Text style={styles.helper}>
        The wallet will show the transaction for your review. Never share a seed phrase
        or private key with this app.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 40,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backText: {
    color: '#315A7D',
    fontSize: 16,
    fontWeight: '800',
  },
  header: {
    gap: 8,
  },
  eyebrow: {
    color: '#14B87A',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    color: '#102A43',
    fontSize: 32,
    fontWeight: '900',
  },
  subtitle: {
    color: '#5C7690',
    fontSize: 15,
    lineHeight: 21,
  },
  card: {
    gap: 14,
    padding: 19,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7F3',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: '#5C7690',
    fontSize: 14,
    fontWeight: '700',
  },
  minimum: {
    color: '#6D8298',
    fontSize: 12,
  },
  amountBox: {
    minHeight: 72,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#C9D8E7',
  },
  currency: {
    color: '#102A43',
    fontSize: 34,
    fontWeight: '900',
  },
  amountInput: {
    flex: 1,
    paddingHorizontal: 9,
    color: '#102A43',
    fontSize: 34,
    fontWeight: '900',
  },
  token: {
    color: '#315A7D',
    fontSize: 14,
    fontWeight: '900',
  },
  balanceButton: {
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#EEF4FA',
  },
  balanceButtonText: {
    color: '#315A7D',
    fontSize: 13,
    fontWeight: '800',
  },
  cardTitle: {
    color: '#102A43',
    fontSize: 18,
    fontWeight: '900',
  },
  compositionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  symbol: {
    flex: 1,
    color: '#315A7D',
    fontSize: 15,
    fontWeight: '700',
  },
  weight: {
    color: '#102A43',
    fontSize: 15,
    fontWeight: '900',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EEF5',
  },
  value: {
    flex: 1,
    color: '#102A43',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'right',
  },
  warning: {
    padding: 13,
    color: '#7D5B0A',
    fontSize: 13,
    lineHeight: 19,
    borderRadius: 14,
    backgroundColor: '#FFF7E5',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 17,
    borderRadius: 16,
    backgroundColor: '#087F5B',
  },
  disabledButton: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  helper: {
    color: '#6D8298',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
})
