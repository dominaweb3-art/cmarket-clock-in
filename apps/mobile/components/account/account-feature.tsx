import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { useRouter } from 'expo-router'
import { PublicKey } from '@solana/web3.js'
import { useCallback, useMemo, useState } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppText } from '@/components/app-text'
import { AccountUiBalance } from '@/components/account/account-ui-balance'
import { AccountUiUsdcBalance } from './account-ui-usdc-balance'
import { useGetBalanceInvalidate } from '@/components/account/use-get-balance'
import { WalletUiButtonConnect } from '@/components/solana/wallet-ui-button-connect'
import { ellipsify } from '@/utils/ellipsify'
import { LanguageSelector } from '@/components/i18n/language-selector'
import { useI18n } from '@/components/i18n/i18n-provider'
import { TranslationKey } from '@/locales'
import { AppConfig } from '@/constants/app-config'

type IndexKey = 'C3' | 'C5' | 'C10' | 'C20' | 'C50'

type Asset = {
  symbol: string
  name: string
  percent: number
  color: string
}

type IndexConfig = {
  label: IndexKey
  titleKey: TranslationKey
  descriptionKey: TranslationKey
  active: boolean
  assets: Asset[]
}

const DEFAULT_PUBLIC_KEY = new PublicKey('11111111111111111111111111111111')

const INDEX_KEYS: IndexKey[] = ['C3', 'C5', 'C10', 'C20', 'C50']

const INDEX_CONFIGS: Record<IndexKey, IndexConfig> = {
  C3: {
    label: 'C3',
    titleKey: 'account.c3Title',
    descriptionKey: 'account.c3Description',
    active: true,
    assets: [
      {
        symbol: 'SOL',
        name: 'Solana',
        percent: 50,
        color: '#9945FF',
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        percent: 30,
        color: '#2775CA',
      },
      {
        symbol: 'JitoSOL',
        name: 'Liquid staking',
        percent: 20,
        color: '#61D6A4',
      },
    ],
  },

  C5: {
    label: 'C5',
    titleKey: 'account.c5Title',
    descriptionKey: 'account.comingSoonDescription',
    active: false,
    assets: [],
  },

  C10: {
    label: 'C10',
    titleKey: 'account.c10Title',
    descriptionKey: 'account.comingSoonDescription',
    active: false,
    assets: [],
  },

  C20: {
    label: 'C20',
    titleKey: 'account.c20Title',
    descriptionKey: 'account.comingSoonDescription',
    active: false,
    assets: [],
  },

  C50: {
    label: 'C50',
    titleKey: 'account.c50Title',
    descriptionKey: 'account.comingSoonDescription',
    active: false,
    assets: [],
  },
}

export function AccountFeature() {
  const router = useRouter()
  const { account } = useMobileWallet()
  const { t } = useI18n()

  const [refreshing, setRefreshing] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<IndexKey>('C3')
  const accountAddress = account?.address

  const walletAddress = useMemo(() => {
    if (!accountAddress) {
      return undefined
    }

    try {
      return new PublicKey(accountAddress)
    } catch {
      return undefined
    }
  }, [accountAddress])

  const balanceAddress = walletAddress ?? DEFAULT_PUBLIC_KEY
  const selectedConfig = INDEX_CONFIGS[selectedIndex]

  const invalidateBalance = useGetBalanceInvalidate({
    address: balanceAddress,
  })

  const onRefresh = useCallback(async () => {
    setRefreshing(true)

    try {
      await invalidateBalance()
    } finally {
      setRefreshing(false)
    }
  }, [invalidateBalance])

  const showComingSoon = (index: IndexKey) => {
    Alert.alert(t('account.comingSoonTitle', { index }), t('account.comingSoonMessage'))
  }

  const showPurchaseInfo = () => {
    if (!selectedConfig.active) {
      showComingSoon(selectedConfig.label)
      return
    }

    router.push('/account/buy')
  }

  const showWithdrawInfo = () => {
    Alert.alert(t('account.withdrawTitle'), t('account.withdrawMessage'))
  }

  return (
    <SafeAreaView style={styles.screen}>
      {account && walletAddress ? (
        <>
          <ScrollView
            style={styles.scroll}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#087F5B" />
            }
            contentContainerStyle={styles.content}
          >
            <View style={styles.header}>
              <AppText style={styles.brand}>{AppConfig.name}</AppText>

              <View style={styles.headerActions}>
                <View style={styles.networkPill}>
                  <View style={styles.onlineDot} />
                  <AppText style={styles.networkText}>{t('account.onDevnet')}</AppText>
                </View>

                <View style={styles.walletPill}>
                  <View style={styles.walletAvatar} />
                  <AppText style={styles.walletText}>{ellipsify(walletAddress.toBase58(), 5)}</AppText>
                </View>
              </View>
            </View>

            <LanguageSelector />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.selectorContent}
            >
              {INDEX_KEYS.map((indexKey) => {
                const index = INDEX_CONFIGS[indexKey]

                return (
                  <Pressable
                    key={indexKey}
                    onPress={() => {
                      if (index.active) {
                        setSelectedIndex(indexKey)
                      } else {
                        showComingSoon(indexKey)
                      }
                    }}
                    style={[
                      styles.indexPill,
                      selectedIndex === indexKey && styles.indexPillSelected,
                      !index.active && styles.indexPillDisabled,
                    ]}
                  >
                    <AppText style={[styles.indexPillText, selectedIndex === indexKey && styles.indexPillTextSelected]}>
                      {indexKey}
                    </AppText>

                    <AppText style={styles.indexPillCaption}>
                      {index.active ? t('account.active') : t('account.upcoming')}
                    </AppText>
                  </Pressable>
                )
              })}
            </ScrollView>

            <View style={styles.positionCard}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderText}>
                  <AppText style={styles.cardEyebrow}>{selectedConfig.label}</AppText>

                  <AppText style={styles.cardTitle}>{t(selectedConfig.titleKey)}</AppText>

                  <AppText style={styles.cardDescription}>{t(selectedConfig.descriptionKey)}</AppText>
                </View>

                <View style={styles.devnetBadge}>
                  <AppText style={styles.devnetText}>DEVNET</AppText>
                </View>
              </View>

              <AppText style={styles.sectionLabel}>{t('account.connectedBalance')}</AppText>

              <View style={styles.balanceValue}>
                <AccountUiBalance address={walletAddress} />
                <AccountUiUsdcBalance address={walletAddress} />
              </View>

              <AppText style={styles.balanceNote}>{t('account.balanceNote')}</AppText>
            </View>

            <View style={styles.exposureCard}>
              <View style={styles.sectionHeader}>
                <AppText style={styles.sectionTitle}>{t('account.targetComposition')}</AppText>

                <AppText style={styles.linkText}>{t('account.viewAll')}</AppText>
              </View>

              <View style={styles.exposureRow}>
                {selectedConfig.assets.map((asset) => (
                  <View key={asset.symbol} style={styles.exposureItem}>
                    <View style={[styles.assetIcon, { backgroundColor: asset.color }]}>
                      <AppText style={styles.assetIconText}>{asset.symbol.charAt(0)}</AppText>
                    </View>

                    <AppText style={styles.assetSymbol}>{asset.symbol}</AppText>

                    <AppText style={styles.assetPercent}>{asset.percent}%</AppText>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoIcon}>
                <AppText style={styles.infoIconText}>↗</AppText>
              </View>

              <View style={styles.infoText}>
                <AppText style={styles.infoTitle}>{t('account.positionTitle')}</AppText>

                <AppText style={styles.infoDescription}>{t('account.positionDescription')}</AppText>
              </View>
            </View>

            <View style={styles.actionRow}>
              <Pressable style={styles.primaryButton} onPress={showPurchaseInfo}>
                <AppText style={styles.primaryButtonText}>
                  {t('account.buyIndex', { index: selectedConfig.label })}
                </AppText>
              </Pressable>

              <Pressable style={styles.secondaryButton} onPress={showWithdrawInfo}>
                <AppText style={styles.secondaryButtonText}>{t('account.withdraw')}</AppText>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.bottomNav}>
            <View style={styles.navItem}>
              <AppText style={styles.navIconActive}>⌂</AppText>
              <AppText style={styles.navTextActive}>{t('nav.home')}</AppText>
            </View>

            <View style={styles.navItem}>
              <AppText style={styles.navIcon}>▥</AppText>
              <AppText style={styles.navText}>{t('nav.markets')}</AppText>
            </View>

            <View style={styles.navItem}>
              <AppText style={styles.navIcon}>＋</AppText>
              <AppText style={styles.navText}>{t('nav.buy')}</AppText>
            </View>

            <View style={styles.navItem}>
              <AppText style={styles.navIcon}>▤</AppText>
              <AppText style={styles.navText}>{t('nav.activity')}</AppText>
            </View>

            <View style={styles.navItem}>
              <AppText style={styles.navIcon}>•••</AppText>
              <AppText style={styles.navText}>{t('nav.more')}</AppText>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.connect}>
          <AppText style={styles.connectTitle}>{t('account.connectTitle')}</AppText>

          <AppText style={styles.connectDescription}>{t('account.connectDescription')}</AppText>

          <WalletUiButtonConnect />
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5F7FB',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  brand: {
    color: '#172D48',
    fontSize: 26,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  networkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#E3F7EF',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0B9B69',
  },
  networkText: {
    color: '#17684D',
    fontSize: 10,
    fontWeight: '700',
  },
  walletPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E8F0FF',
  },
  walletAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#80B7FF',
  },
  walletText: {
    color: '#24476F',
    fontSize: 10,
    fontWeight: '700',
  },
  selectorContent: {
    gap: 8,
    paddingVertical: 2,
  },
  indexPill: {
    minWidth: 64,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E8EDF3',
  },
  indexPillSelected: {
    backgroundColor: '#172D48',
  },
  indexPillDisabled: {
    opacity: 0.5,
  },
  indexPillText: {
    color: '#203B5A',
    fontSize: 14,
    fontWeight: '800',
  },
  indexPillTextSelected: {
    color: '#FFFFFF',
  },
  indexPillCaption: {
    marginTop: 2,
    color: '#708198',
    fontSize: 8,
  },
  positionCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    shadowColor: '#18324E',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardHeaderText: {
    flex: 1,
    gap: 5,
  },
  cardEyebrow: {
    color: '#6D7D91',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  cardTitle: {
    color: '#172D48',
    fontSize: 23,
    lineHeight: 27,
    fontWeight: '800',
  },
  cardDescription: {
    color: '#667991',
    fontSize: 12,
    lineHeight: 17,
  },
  devnetBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E3F7EF',
  },
  devnetText: {
    color: '#087F5B',
    fontSize: 9,
    fontWeight: '800',
  },
  sectionLabel: {
    color: '#526A84',
    fontSize: 13,
    fontWeight: '700',
  },
  balanceValue: {
    marginTop: -4,
  },
  balanceNote: {
    marginTop: 8,
    color: '#73849A',
    fontSize: 11,
  },
  exposureCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    shadowColor: '#18324E',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    gap: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#172D48',
    fontSize: 16,
    fontWeight: '800',
  },
  linkText: {
    color: '#356184',
    fontSize: 11,
    fontWeight: '700',
  },
  exposureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  exposureItem: {
    alignItems: 'center',
    gap: 5,
  },
  assetIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  assetIconText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  assetSymbol: {
    color: '#233D5B',
    fontSize: 11,
    fontWeight: '800',
  },
  assetPercent: {
    color: '#718198',
    fontSize: 10,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#E9FAF4',
    borderWidth: 1,
    borderColor: '#C8F0E2',
  },
  infoIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#C8F1E3',
  },
  infoIconText: {
    color: '#087F5B',
    fontSize: 24,
    fontWeight: '800',
  },
  infoText: {
    flex: 1,
    gap: 4,
  },
  infoTitle: {
    color: '#16543F',
    fontSize: 13,
    fontWeight: '800',
  },
  infoDescription: {
    color: '#487967',
    fontSize: 11,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#087F5B',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#DDF4EC',
  },
  secondaryButtonText: {
    color: '#087F5B',
    fontSize: 13,
    fontWeight: '800',
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5EAF0',
  },
  navItem: {
    alignItems: 'center',
    gap: 2,
  },
  navIconActive: {
    color: '#087F5B',
    fontSize: 21,
    fontWeight: '800',
  },
  navIcon: {
    color: '#7A899A',
    fontSize: 20,
  },
  navTextActive: {
    color: '#087F5B',
    fontSize: 10,
    fontWeight: '800',
  },
  navText: {
    color: '#7A899A',
    fontSize: 10,
  },
  connect: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  connectTitle: {
    color: '#172D48',
    fontSize: 24,
    fontWeight: '800',
  },
  connectDescription: {
    color: '#718198',
    textAlign: 'center',
    fontSize: 14,
  },
})
