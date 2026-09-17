import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { C3OverviewCard } from '@/components/c3/c3-overview-card'

export default function C3DetailsScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <C3OverviewCard compact={false} onBack={() => router.back()} onBuy={() => router.push('/account/buy')} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F7FB' },
  content: { paddingVertical: 20 },
})
