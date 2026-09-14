import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MobileWalletProvider } from '@wallet-ui/react-native-web3js'

import { ActivityScreen } from './src/screens/ActivityScreen'
import { BuyScreen } from './src/screens/BuyScreen'
import { HomeScreen } from './src/screens/HomeScreen'
import { APP_IDENTITY, DEVNET_RPC_URL } from './src/config'
import type { Activity, Basket } from './src/types'

type Screen = 'home' | 'activity' | 'buy'

export default function App() {
  return (
    <MobileWalletProvider
      chain="solana:devnet"
      endpoint={DEVNET_RPC_URL}
      identity={APP_IDENTITY}
    >
      <AppContent />
    </MobileWalletProvider>
  )
}

function AppContent() {
  const [screen, setScreen] = useState<Screen>('home')
  const [selectedBasket, setSelectedBasket] = useState<Basket | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])

  const openBasket = (basket: Basket) => {
    setSelectedBasket(basket)
    setScreen('buy')
  }

  const addActivity = (activity: Activity) => {
    setActivities((current) => [activity, ...current])
    setScreen('activity')
  }

  return (
    <View style={styles.app}>
      <View style={styles.body}>
        {screen === 'home' ? <HomeScreen onSelectBasket={openBasket} /> : null}

        {screen === 'activity' ? <ActivityScreen activities={activities} /> : null}

        {screen === 'buy' && selectedBasket ? (
          <BuyScreen
            basket={selectedBasket}
            onBack={() => setScreen('home')}
            onPurchased={addActivity}
          />
        ) : null}
      </View>

      {screen !== 'buy' ? (
        <View style={styles.tabBar}>
          <TabButton
            label="Baskets"
            active={screen === 'home'}
            onPress={() => setScreen('home')}
          />
          <TabButton
            label="Activity"
            active={screen === 'activity'}
            onPress={() => setScreen('activity')}
          />
        </View>
      ) : null}
    </View>
  )
}

type TabButtonProps = {
  label: string
  active: boolean
  onPress: () => void
}

function TabButton({ label, active, onPress }: TabButtonProps) {
  return (
    <Pressable onPress={onPress} style={styles.tabButton}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: '#F4F8FC',
  },
  body: {
    flex: 1,
  },
  tabBar: {
    minHeight: 76,
    paddingHorizontal: 26,
    paddingBottom: 17,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E1EAF3',
  },
  tabButton: {
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  tabLabel: {
    color: '#7B91A5',
    fontSize: 14,
    fontWeight: '800',
  },
  tabLabelActive: {
    color: '#087F5B',
  },
})
