import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { getExplorerTransactionUrl } from '../solana/format'
import type { Activity } from '../types'

type ActivityScreenProps = {
  activities: Activity[]
}

export function ActivityScreen({ activities }: ActivityScreenProps) {
  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>VERIFIABLE HISTORY</Text>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>
          Confirmed Devnet payments stay linked to their public transaction evidence.
        </Text>
      </View>

      {activities.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No purchases yet</Text>
          <Text style={styles.emptyText}>
            Your confirmed C Market Devnet activity will appear here.
          </Text>
        </View>
      ) : (
        activities.map((activity) => (
          <View key={activity.id} style={styles.activityCard}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.basket}>{activity.basketName}</Text>
                <Text style={styles.date}>
                  {new Date(activity.timestamp).toLocaleString()}
                </Text>
              </View>
              <Text style={styles.amount}>{activity.amountUsdc.toFixed(2)} USDC</Text>
            </View>

            <View style={styles.confirmedPill}>
              <Text style={styles.confirmedText}>CONFIRMED ON DEVNET</Text>
            </View>

            <Pressable
              onPress={() => void Linking.openURL(getExplorerTransactionUrl(activity.signature))}
              style={styles.explorerButton}
            >
              <Text style={styles.explorerButtonText}>View on Solana Explorer</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 18,
    padding: 20,
  },
  header: {
    gap: 8,
    paddingTop: 12,
  },
  eyebrow: {
    color: '#14B87A',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    color: '#102A43',
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    color: '#5C7690',
    fontSize: 15,
    lineHeight: 21,
  },
  emptyCard: {
    gap: 8,
    padding: 20,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7F3',
  },
  emptyTitle: {
    color: '#102A43',
    fontSize: 18,
    fontWeight: '900',
  },
  emptyText: {
    color: '#5C7690',
    fontSize: 14,
    lineHeight: 20,
  },
  activityCard: {
    gap: 14,
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE7F3',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  basket: {
    color: '#102A43',
    fontSize: 20,
    fontWeight: '900',
  },
  date: {
    marginTop: 4,
    color: '#6D8298',
    fontSize: 12,
  },
  amount: {
    color: '#087F5B',
    fontSize: 15,
    fontWeight: '900',
  },
  confirmedPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#E5F8F1',
  },
  confirmedText: {
    color: '#087F5B',
    fontSize: 10,
    fontWeight: '900',
  },
  explorerButton: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: '#EEF4FA',
  },
  explorerButtonText: {
    color: '#315A7D',
    fontSize: 13,
    fontWeight: '900',
  },
})
