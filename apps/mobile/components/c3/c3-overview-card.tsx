import { Pressable, StyleSheet, View } from 'react-native'

import { AppText } from '@/components/app-text'
import { C3_CORE_TARGETS, C3_CORE_TOTAL_PERCENT } from '@/constants/c3-core'
import { useI18n } from '@/components/i18n/i18n-provider'

type C3OverviewCardProps = Readonly<{
  compact?: boolean
  onBuy?: () => void
  onDetails?: () => void
  onBack?: () => void
}>

export function C3OverviewCard({ compact = false, onBuy, onDetails, onBack }: C3OverviewCardProps) {
  const { t } = useI18n()

  return (
    <View style={[styles.card, !compact && styles.detailCard]}>
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <AppText style={styles.eyebrow}>C3 CORE</AppText>
          <AppText style={styles.title}>{t('c3.overviewTitle')}</AppText>
          <AppText style={styles.description}>{t('c3.overviewDescription')}</AppText>
        </View>
        <View style={styles.devnetBadge}>
          <AppText style={styles.devnetText}>DEVNET</AppText>
        </View>
      </View>

      <View style={styles.methodologyBox}>
        <AppText style={styles.methodologyTitle}>{t('c3.targetMethodology')}</AppText>
        <AppText style={styles.methodologyDescription}>{t('c3.methodologyDescription')}</AppText>
      </View>

      <View style={styles.targetList} accessibilityLabel={t('c3.allocationLabel')}>
        {C3_CORE_TARGETS.map((target) => (
          <View key={target.symbol} style={styles.targetRow}>
            <View style={[styles.targetDot, { backgroundColor: target.color }]} />
            <AppText style={styles.targetName}>{t(target.labelKey)}</AppText>
            <View
              style={styles.targetTrack}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: target.percent }}
            >
              <View style={[styles.targetFill, { width: `${target.percent}%`, backgroundColor: target.color }]} />
            </View>
            <AppText style={styles.targetPercent}>{target.percent}%</AppText>
          </View>
        ))}
      </View>

      <View style={styles.statusBox}>
        <AppText style={styles.statusTitle}>{t('c3.statusTitle')}</AppText>
        <AppText style={styles.statusDescription}>{t('c3.statusDescription')}</AppText>
      </View>

      {!compact ? (
        <View style={styles.detailBox}>
          <AppText style={styles.detailTitle}>{t('c3.detailsPurpose')}</AppText>
          <AppText style={styles.detailText}>{t('c3.detailsPurposeDescription')}</AppText>
          <AppText style={styles.detailTitle}>{t('c3.detailsLimitation')}</AppText>
          <AppText style={styles.detailText}>{t('c3.detailsLimitationDescription')}</AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        {onBack ? (
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.secondaryButton}>
            <AppText style={styles.secondaryButtonText}>{t('c3.back')}</AppText>
          </Pressable>
        ) : null}
        {onDetails ? (
          <Pressable accessibilityRole="button" onPress={onDetails} style={styles.secondaryButton}>
            <AppText style={styles.secondaryButtonText}>{t('c3.viewDetails')}</AppText>
          </Pressable>
        ) : null}
        {onBuy ? (
          <Pressable accessibilityRole="button" onPress={onBuy} style={styles.primaryButton}>
            <AppText style={styles.primaryButtonText}>{t('c3.buy')}</AppText>
          </Pressable>
        ) : null}
      </View>

      <AppText style={styles.totalNote}>{t('c3.totalNote', { total: C3_CORE_TOTAL_PERCENT })}</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 14,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    shadowColor: '#18324E',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  detailCard: { margin: 20 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headingText: { flex: 1, gap: 5 },
  eyebrow: { color: '#6D7D91', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#172D48', fontSize: 22, lineHeight: 27, fontWeight: '800' },
  description: { color: '#667991', fontSize: 13, lineHeight: 19 },
  devnetBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: '#E3F7EF' },
  devnetText: { color: '#087F5B', fontSize: 9, fontWeight: '800' },
  methodologyBox: { padding: 14, gap: 4, borderRadius: 16, backgroundColor: '#F3F7FC' },
  methodologyTitle: { color: '#172D48', fontSize: 14, fontWeight: '800' },
  methodologyDescription: { color: '#526A84', fontSize: 12, lineHeight: 18 },
  targetList: { gap: 12 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetDot: { width: 10, height: 10, borderRadius: 5 },
  targetName: { width: 76, color: '#233D5B', fontSize: 12, fontWeight: '800' },
  targetTrack: { flex: 1, height: 8, overflow: 'hidden', borderRadius: 4, backgroundColor: '#E7EDF4' },
  targetFill: { height: '100%', borderRadius: 4 },
  targetPercent: { width: 34, color: '#718198', fontSize: 12, fontWeight: '800', textAlign: 'right' },
  statusBox: {
    padding: 14,
    gap: 4,
    borderRadius: 16,
    backgroundColor: '#E9FAF4',
    borderWidth: 1,
    borderColor: '#C8F0E2',
  },
  statusTitle: { color: '#16543F', fontSize: 13, fontWeight: '800' },
  statusDescription: { color: '#487967', fontSize: 12, lineHeight: 18 },
  detailBox: { gap: 6 },
  detailTitle: { color: '#172D48', fontSize: 14, fontWeight: '800' },
  detailText: { color: '#526A84', fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10 },
  primaryButton: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 999, backgroundColor: '#087F5B' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#DDF4EC',
  },
  secondaryButtonText: { color: '#087F5B', fontSize: 13, fontWeight: '800' },
  totalNote: { color: '#7A899A', fontSize: 11, textAlign: 'center' },
})
