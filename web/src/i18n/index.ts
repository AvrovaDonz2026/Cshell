import { createI18n } from 'vue-i18n'
import en from './locales/en'
import zh from './locales/zh'
import ru from './locales/ru'

export const availableLocales = ['en', 'zh', 'ru'] as const
export type AppLocale = (typeof availableLocales)[number]

const STORAGE_KEY = 'cshell_locale'

function initialLocale(): AppLocale {
  if (typeof localStorage === 'undefined') return 'en'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (availableLocales.includes(stored as AppLocale)) return stored as AppLocale
  return 'en'
}

const locale = initialLocale()
if (typeof document !== 'undefined') document.documentElement.lang = locale

export const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: 'en',
  messages: { en, zh, ru },
})

export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale)
  }
}
