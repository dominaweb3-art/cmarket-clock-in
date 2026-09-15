import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { DEFAULT_LOCALE, isLocale, Locale, translate, TranslationKey, TranslationParams } from '@/locales'

const LANGUAGE_STORAGE_KEY = 'cmarket.language'

type Translate = (key: TranslationKey, params?: TranslationParams) => string

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    let active = true

    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((storedLocale) => {
        if (active && storedLocale && isLocale(storedLocale)) {
          setLocaleState(storedLocale)
        }
      })
      .catch(() => {
        // English remains the permanent fallback if persisted preferences cannot be read.
      })

    return () => {
      active = false
    }
  }, [])

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
    void AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale).catch(() => {
      // The current session still changes language even if persistence is unavailable.
    })
  }, [])

  const t = useCallback<Translate>((key, params) => translate(locale, key, params), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)

  if (!value) {
    throw new Error('useI18n must be wrapped in an <I18nProvider />')
  }

  return value
}
