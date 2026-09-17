import { Link, Stack } from 'expo-router'
import { StyleSheet } from 'react-native'

import { AppText } from '@/components/app-text'

import { AppView } from '@/components/app-view'
import { useI18n } from '@/components/i18n/i18n-provider'

export default function NotFoundScreen() {
  const { t } = useI18n()

  return (
    <>
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <AppView style={styles.container}>
        <AppText type="title" style={{ textAlign: 'center' }}>
          {t('notFound.message')}
        </AppText>
        <Link href="/" style={styles.link}>
          <AppText type="link">{t('notFound.home')}</AppText>
        </Link>
      </AppView>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
})
