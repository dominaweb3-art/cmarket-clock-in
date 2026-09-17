import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { BaseButton } from '@/components/solana/base-button'
import React, { useState } from 'react'
import { showError } from '@/utils/show-error'
import { useI18n } from '@/components/i18n/i18n-provider'

export function WalletUiButtonConnect({ label }: { label?: string }) {
  const { connect } = useMobileWallet()
  const { t } = useI18n()
  const [isConnecting, setIsConnecting] = useState(false)

  // The wallet can decline or fail the authorization request. Catch it here so it
  // never surfaces as an unhandled rejection, and let the user know what happened.
  async function handleConnect() {
    if (isConnecting) {
      return
    }
    setIsConnecting(true)
    try {
      await connect()
    } catch (error) {
      showError(t('auth.walletConnectError'), error, t('errors.unknown'))
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <BaseButton
      disabled={isConnecting}
      label={isConnecting ? t('auth.connecting') : (label ?? t('auth.connect'))}
      onPress={() => void handleConnect()}
    />
  )
}
