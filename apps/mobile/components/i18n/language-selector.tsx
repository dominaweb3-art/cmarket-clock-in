import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { AppText } from '@/components/app-text'
import { useI18n } from '@/components/i18n/i18n-provider'
import { LOCALE_OPTIONS } from '@/locales'

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n()

  return (
    <View style={styles.container} accessibilityLabel={t('language.label')}>
      <AppText style={styles.label}>{t('language.label')}</AppText>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
        {LOCALE_OPTIONS.map((option) => {
          const selected = option.locale === locale

          return (
            <Pressable
              key={option.locale}
              accessibilityLabel={t('language.select', { language: option.label })}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setLocale(option.locale)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <AppText style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</AppText>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  label: {
    color: '#58718F',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  options: {
    gap: 8,
    paddingRight: 8,
  },
  option: {
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8E0EA',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
  },
  optionSelected: {
    borderColor: '#087F5B',
    backgroundColor: '#E5F6EF',
  },
  optionText: {
    color: '#425B76',
    fontSize: 13,
    fontWeight: '700',
  },
  optionTextSelected: {
    color: '#087F5B',
  },
})
