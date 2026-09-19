import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import { useCallback } from 'react'
import { View } from 'react-native'
import 'react-native-reanimated'

import { AppTheme } from '@/components/app-theme'
import { I18nProvider } from '@/components/i18n/i18n-provider'

void SplashScreen.preventAutoHideAsync()

export default function CandidateRootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  })

  const onLayoutRootView = useCallback(async () => {
    if (loaded) {
      await SplashScreen.hideAsync()
    }
  }, [loaded])

  if (!loaded) {
    return null
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AppTheme>
        <I18nProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="+not-found" />
          </Stack>
        </I18nProvider>
      </AppTheme>
    </View>
  )
}
