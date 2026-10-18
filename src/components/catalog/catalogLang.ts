import { getLocale, type Locale } from '../../i18n'

export type CatalogLang = 'en'

/// The catalogue is written in Russian and translated only into English; every other interface reads English too.
export const catalogLang = (locale: Locale = getLocale()): CatalogLang | null => (locale === 'ru' ? null : 'en')

/// Russian addresses stay byte-for-byte as before, so their server and disk caches keep working.
export function withCatalogLang(path: string, locale: Locale = getLocale()): string {
  const lang = catalogLang(locale)
  if (!lang) return path
  const sep = !path.includes('?') ? '?' : path.endsWith('?') || path.endsWith('&') ? '' : '&'
  return path + sep + 'lang=' + lang
}
