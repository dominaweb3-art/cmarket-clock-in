/** Disabled, unmounted pilot presentation. Not a stable Devnet route or wallet entrypoint. */
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native'

import { getPilotCopy, type PilotCopyKey, type PilotLocale } from './copy'

type Page = 'dashboard' | 'buy' | 'sell' | 'status' | 'activity'
const PAGES: readonly Page[] = ['dashboard', 'buy', 'sell', 'status', 'activity']
const LOCALES: readonly { id: PilotLocale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'zh-CN', name: '简体中文' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
]

export function C3OwnerPilotPreview() {
  const [locale, setLocale] = useState<PilotLocale>('en')
  const [page, setPage] = useState<Page>('dashboard')
  const t = (key: PilotCopyKey) => getPilotCopy(locale, key)
  const line = (key: PilotCopyKey) => <Text style={styles.body}>{t(key)}</Text>
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('title')}</Text>
      <View style={styles.selector} accessibilityRole="radiogroup">
        {LOCALES.map(({ id, name }) => (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: locale === id }}
            onPress={() => setLocale(id)}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{name}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.warning} accessibilityRole="alert">
        <Text style={styles.warningTitle}>{t('blocked')}</Text>
        {line('blockedDetail')}
      </View>
      <View style={styles.selector}>
        {PAGES.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: page === item }}
            onPress={() => setPage(item)}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{t(item)}</Text>
          </Pressable>
        ))}
      </View>
      {page === 'dashboard' && (
        <View style={styles.card}>
          {line('position')}
          {line('shareBalance')}
          {line('usdcBalance')}
          {line('navUnavailable')}
          {line('target')}
          {line('pilotRisk')}
        </View>
      )}
      {page === 'buy' && (
        <View style={styles.card}>
          {line('fixedAmount')}
          {line('target')}
          {line('networkCosts')}
          {line('fee')}
          {line('twoApprovals')}
          {line('pilotRisk')}
          <Text style={styles.disabledButton} accessibilityRole="button" accessibilityState={{ disabled: true }}>
            {t('approve')}
          </Text>
        </View>
      )}
      {page === 'sell' && (
        <View style={styles.card}>
          {line('shareAmount')}
          {line('sellDisclosure')}
          {line('sellStages')}
          {line('manualReview')}
          <Text style={styles.disabledButton} accessibilityRole="button" accessibilityState={{ disabled: true }}>
            {t('approve')}
          </Text>
        </View>
      )}
      {page === 'status' && (
        <View style={styles.card}>
          {line('statusUnknown')}
          {line('manualReview')}
          {line('explorer')}
        </View>
      )}
      {page === 'activity' && (
        <View style={styles.card}>
          {line('noActivity')}
          {line('explorer')}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#081b18' },
  content: { padding: 20, gap: 18 },
  title: { color: '#f4fff8', fontSize: 26, fontWeight: '700' },
  selector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderColor: '#75d9ad', borderWidth: 1, padding: 9, borderRadius: 10 },
  chipText: { color: '#e0ffe9', fontSize: 14 },
  warning: { borderColor: '#f0b35f', borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  warningTitle: { color: '#ffce7a', fontWeight: '700', fontSize: 18 },
  card: { backgroundColor: '#15322a', padding: 18, borderRadius: 16, gap: 12 },
  body: { color: '#f2fbf5', fontSize: 15, lineHeight: 22 },
  disabledButton: {
    backgroundColor: '#55635c',
    color: '#fff',
    padding: 14,
    borderRadius: 12,
    textAlign: 'center',
    fontWeight: '700',
  },
})
