import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { BasketCard } from '../components/BasketCard'
import { WalletBar } from '../components/WalletBar'
import { BASKETS } from '../data/baskets'
import type { Basket } from '../types'

type HomeScreenProps = {
  onSelectBasket: (basket: Basket) => void
}

export function HomeScreen({ onSelectBasket }: HomeScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>C MARKET</Text>
        <Text style={styles.title}>One simple way to explore on-chain baskets.</Text>
        <Text style={styles.subtitle}>
          Review the composition, approve with your mobile wallet, and verify every
          Devnet transaction.
        </Text>
      </View>

      <WalletBar />

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Explore baskets</Text>
          <Text style={styles.sectionSubtitle}>Built for Solana Mobile</Text>
        </View>
        <View style={styles.devnetBadge}>
          <Text style={styles.devnetBadgeText}>DEVNET</Text>
        </View>
      </View>

      {BASKETS.map((basket) => (
        <BasketCard
          key={basket.id}
          basket={basket}
          onPress={() => {
            if (basket.status === 'live') onSelectBasket(basket)
          }}
        />
      ))}

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Prototype notice</Text>
        <Text style={styles.noticeText}>
          This hackathon prototype uses test assets on Solana Devnet. It does not
          promise returns and is not ready for mainnet funds.
        </Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    gap: 10,
    paddingTop: 12,
  },
  eyebrow: {
    color: '#14B87A',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    color: '#102A43',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
  },
  subtitle: {
    color: '#5C7690',
    fontSize: 16,
    lineHeight: 23,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sectionTitle: {
    color: '#102A43',
    fontSize: 22,
    fontWeight: '900',
  },
  sectionSubtitle: {
    marginTop: 3,
    color: '#6D8298',
    fontSize: 14,
  },
  devnetBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#E5F8F1',
  },
  devnetBadgeText: {
    color: '#087F5B',
    fontSize: 11,
    fontWeight: '900',
  },
  notice: {
    gap: 6,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#FFF7E5',
  },
  noticeTitle: {
    color: '#9A6700',
    fontSize: 14,
    fontWeight: '900',
  },
  noticeText: {
    color: '#7D5B0A',
    fontSize: 13,
    lineHeight: 19,
  },
})
