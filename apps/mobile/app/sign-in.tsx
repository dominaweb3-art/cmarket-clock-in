import { router } from 'expo-router'
import { AppButton } from '@/components/app-button'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { AppText } from '@/components/app-text'
import { AppView } from '@/components/app-view'
import { AppConfig } from '@/constants/app-config'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { Image } from 'expo-image'
import { useState } from 'react'
import { showError } from '@/utils/show-error'
import { useI18n } from '@/components/i18n/i18n-provider'

export default function SignIn() {
  const { connect } = useMobileWallet()
  const { t } = useI18n()
  const [isSigningIn, setIsSigningIn] = useState(false)

  // Sign-in goes through the wallet, which can decline or fail the request.
  async function handleSignIn() {
    if (isSigningIn) {
      return
    }
    setIsSigningIn(true)
    try {
      await connect()
      // We only get here when sign-in succeeded, so it is safe to navigate.
      router.replace('/')
    } catch (error) {
      showError(t('auth.signInError'), error, t('errors.unknown'))
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <AppView
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'stretch',
      }}
    >
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'space-between',
        }}
      >
        {/* Dummy view to push the next view to the center. */}
        <View />
        <View style={{ alignItems: 'center', gap: 16 }}>
          <AppText type="title">{AppConfig.name}</AppText>
          <Image source={require('../assets/images/icon.png')} style={{ width: 128, height: 128 }} />
        </View>
        <View style={{ marginBottom: 16 }}>
          <AppButton
            variant="filled"
            style={{ marginHorizontal: 16 }}
            disabled={isSigningIn}
            onPress={() => void handleSignIn()}
          >
            {isSigningIn ? t('auth.connecting') : t('auth.connect')}
          </AppButton>
        </View>
      </SafeAreaView>
    </AppView>
  )
}
