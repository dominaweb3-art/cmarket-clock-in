import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Basket } from '../types'

type BasketCardProps = {
  basket: Basket
  onPress: () => void
}

export function BasketCard({ basket, onPress }: BasketCardProps) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.name}>{basket.name}</Text>
          <Text style={styles.tagline}>{basket.tagline}</Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </View>

      <View style={styles.composition}>
        {basket.composition.map((item) => (
          <View key={item.symbol} style={styles.compositionItem}>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={styles.symbol}>{item.symbol}</Text>
            <Text style={styles.weight}>{item.weight}%</Text>
          </View>
        ))}
      </View>

      <Text style={styles.description}>{basket.description}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: 16,
    padding: 20,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7F3',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    color: '#102A43',
    fontSize: 26,
    fontWeight: '900',
  },
  tagline: {
    marginTop: 4,
    color: '#5C7690',
    fontSize: 14,
  },
  arrow: {
    color: '#102A43',
    fontSize: 32,
    fontWeight: '300',
  },
  composition: {
    gap: 9,
  },
  compositionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  symbol: {
    flex: 1,
    color: '#315A7D',
    fontSize: 14,
    fontWeight: '700',
  },
  weight: {
    color: '#102A43',
    fontSize: 14,
    fontWeight: '900',
  },
  description: {
    color: '#5C7690',
    fontSize: 14,
    lineHeight: 20,
  },
})
