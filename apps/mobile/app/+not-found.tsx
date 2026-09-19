import { Link } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StyleSheet, View } from 'react-native'

import { AppText } from '@/components/app-text'

export default function CandidateNotFound() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <AppText style={styles.title}>Candidate route not found</AppText>
        <AppText style={styles.description}>The read-only C3 candidate does not expose execution routes.</AppText>
        <Link href="/" style={styles.link}>
          Return to C3 candidate
        </Link>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F7FB' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  title: { color: '#172D48', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  description: { color: '#526A84', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  link: { color: '#087F5B', fontSize: 16, fontWeight: '800' },
})
