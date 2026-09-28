import en from '../renderer/i18n/locales/en.json'
import zh from '../renderer/i18n/locales/zh.json'
import zhTW from '../renderer/i18n/locales/zh-TW.json'
import fr from '../renderer/i18n/locales/fr.json'
import ja from '../renderer/i18n/locales/ja.json'
import ru from '../renderer/i18n/locales/ru.json'
import vi from '../renderer/i18n/locales/vi.json'
import type { Locale } from './bridge'

export const resources = { en, zh, 'zh-TW': zhTW, fr, ja, ru, vi }
export function toIntlLocale(locale: string): string {
  if (locale === 'zh' || locale === 'zhCN') return 'zh-CN'
  if (locale === 'zhTW') return 'zh-TW'
  try {
    return Intl.getCanonicalLocales(locale)[0] || 'en'
  } catch {
    return 'en'
  }
}
export function translate(locale: Locale, key: string): string {
  return (
    (resources[locale]?.translation as Record<string, string>)?.[key] ??
    (en.translation as Record<string, string>)[key] ??
    key
  )
}
