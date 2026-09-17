import { en, TranslationKey } from '@/locales/en'
import { es } from '@/locales/es'
import { ptBR } from '@/locales/pt-BR'
import { zhCN } from '@/locales/zh-CN'

export const DEFAULT_LOCALE = 'en' as const

export const LOCALE_OPTIONS = [
  { locale: 'en', label: 'English' },
  { locale: 'es', label: 'Español' },
  { locale: 'zh-CN', label: '简体中文' },
  { locale: 'pt-BR', label: 'Português (Brasil)' },
] as const

export type Locale = (typeof LOCALE_OPTIONS)[number]['locale']
export type TranslationParams = Record<string, string | number>

const translations: Record<Locale, Record<TranslationKey, string>> = {
  en,
  es,
  'zh-CN': zhCN,
  'pt-BR': ptBR,
}

export function isLocale(value: string): value is Locale {
  return LOCALE_OPTIONS.some((option) => option.locale === value)
}

export function translate(locale: Locale, key: TranslationKey, params: TranslationParams = {}): string {
  const template = translations[locale]?.[key] ?? en[key]

  return template.replace(/\{(\w+)\}/g, (placeholder, paramName: string) => {
    const value = params[paramName]

    return value === undefined ? placeholder : String(value)
  })
}

export type { TranslationKey }
