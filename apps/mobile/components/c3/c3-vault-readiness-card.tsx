import { Pressable, StyleSheet, View } from 'react-native'

import { AppText } from '@/components/app-text'
import { useI18n } from '@/components/i18n/i18n-provider'
import { TranslationKey } from '@/locales'

import { useC3VaultReadiness } from './use-c3-vault-readiness'

const STATUS_COPY: Record<
  string,
  { title: TranslationKey; detail: TranslationKey; tone: 'good' | 'warning' | 'error' }
> = {
  deployment_required: {
    title: 'c3Vault.deploymentRequiredTitle',
    detail: 'c3Vault.deploymentRequiredDescription',
    tone: 'warning',
  },
  configuration_invalid: {
    title: 'c3Vault.configurationInvalidTitle',
    detail: 'c3Vault.configurationInvalidDescription',
    tone: 'error',
  },
  program_unavailable: {
    title: 'c3Vault.programUnavailableTitle',
    detail: 'c3Vault.programUnavailableDescription',
    tone: 'error',
  },
  vault_invalid: {
    title: 'c3Vault.vaultInvalidTitle',
    detail: 'c3Vault.vaultInvalidDescription',
    tone: 'error',
  },
  ready_read_only: {
    title: 'c3Vault.readyTitle',
    detail: 'c3Vault.readyDescription',
    tone: 'good',
  },
  rpc_error: {
    title: 'c3Vault.rpcErrorTitle',
    detail: 'c3Vault.rpcErrorDescription',
    tone: 'error',
  },
}

export function C3VaultReadinessCard() {
  const { t } = useI18n()
  const { checking, readiness, refresh } = useC3VaultReadiness()
  const copy = readiness ? STATUS_COPY[readiness.status] : undefined
  const tone = copy?.tone ?? 'warning'

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText style={styles.eyebrow}>{t('c3Vault.eyebrow')}</AppText>
          <AppText style={styles.title}>{t('c3Vault.title')}</AppText>
        </View>
        <View style={[styles.badge, styles[`${tone}Badge`]]}>
          <AppText style={[styles.badgeText, styles[`${tone}Text`]]}>
            {checking ? t('c3Vault.checking') : t('c3Vault.readOnly')}
          </AppText>
        </View>
      </View>

      <AppText style={styles.description}>{t('c3Vault.description')}</AppText>

      <View style={[styles.statusBox, styles[`${tone}Box`]]}>
        <AppText style={styles.statusTitle}>
          {checking ? t('c3Vault.checkingTitle') : copy ? t(copy.title) : t('c3Vault.rpcErrorTitle')}
        </AppText>
        <AppText style={styles.statusDescription}>
          {checking ? t('c3Vault.checkingDescription') : copy ? t(copy.detail) : t('c3Vault.rpcErrorDescription')}
        </AppText>
      </View>

      <View style={styles.evidence}>
        <EvidenceRow label={t('c3Vault.program')} verified={readiness?.programVerified} />
        <EvidenceRow label={t('c3Vault.vault')} verified={readiness?.vaultVerified} />
        <EvidenceRow label={t('c3Vault.shareMint')} verified={readiness?.shareMintVerified} />
      </View>

      <AppText style={styles.safety}>{t('c3Vault.safety')}</AppText>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: checking, disabled: checking }}
        disabled={checking}
        onPress={() => void refresh()}
        style={[styles.refreshButton, checking && styles.refreshButtonDisabled]}
      >
        <AppText style={styles.refreshText}>{checking ? t('c3Vault.checking') : t('c3Vault.refresh')}</AppText>
      </Pressable>
    </View>
  )
}

function EvidenceRow({ label, verified }: Readonly<{ label: string; verified?: boolean }>) {
  return (
    <View style={styles.evidenceRow}>
      <AppText style={styles.evidenceLabel}>{label}</AppText>
      <AppText style={[styles.evidenceValue, verified ? styles.verified : styles.notVerified]}>
        {verified ? '✓' : '—'}
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, padding: 18, gap: 14, borderRadius: 22, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerText: { flex: 1, gap: 4 },
  eyebrow: { color: '#6D7D91', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#172D48', fontSize: 20, lineHeight: 25, fontWeight: '800' },
  description: { color: '#526A84', fontSize: 13, lineHeight: 20 },
  badge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999 },
  badgeText: { fontSize: 9, fontWeight: '800' },
  goodBadge: { backgroundColor: '#E3F7EF' },
  warningBadge: { backgroundColor: '#FFF4D6' },
  errorBadge: { backgroundColor: '#FFE7E5' },
  goodText: { color: '#087F5B' },
  warningText: { color: '#8A5A00' },
  errorText: { color: '#A22A22' },
  statusBox: { padding: 14, gap: 5, borderRadius: 16, borderWidth: 1 },
  goodBox: { backgroundColor: '#E9FAF4', borderColor: '#C8F0E2' },
  warningBox: { backgroundColor: '#FFF8E8', borderColor: '#F2DFA9' },
  errorBox: { backgroundColor: '#FFF0EF', borderColor: '#F3C7C3' },
  statusTitle: { color: '#172D48', fontSize: 14, fontWeight: '800' },
  statusDescription: { color: '#526A84', fontSize: 12, lineHeight: 18 },
  evidence: { gap: 8 },
  evidenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  evidenceLabel: { color: '#526A84', fontSize: 12, fontWeight: '700' },
  evidenceValue: { width: 24, textAlign: 'center', fontSize: 14, fontWeight: '900' },
  verified: { color: '#087F5B' },
  notVerified: { color: '#9AA7B5' },
  safety: { color: '#7A899A', fontSize: 11, lineHeight: 17 },
  refreshButton: { alignItems: 'center', paddingVertical: 12, borderRadius: 999, backgroundColor: '#DDF4EC' },
  refreshButtonDisabled: { opacity: 0.55 },
  refreshText: { color: '#087F5B', fontSize: 13, fontWeight: '800' },
})
