import { getLocale, type Locale } from '../../i18n'

const TRANSLATED = ['en', 'de', 'pl', 'tr', 'pt-BR', 'es', 'uk'] as const satisfies readonly Locale[]

export type CatalogLang = (typeof TRANSLATED)[number]

const isTranslated = (locale: Locale): locale is CatalogLang => (TRANSLATED as readonly Locale[]).includes(locale)

/// The catalogue is written in Russian and translated into the public interface languages; any other interface reads English.
export const catalogLang = (locale: Locale = getLocale()): CatalogLang | null => (locale === 'ru' ? null : isTranslated(locale) ? locale : 'en')

/// Russian addresses stay byte-for-byte as before, so their server and disk caches keep working.
export function withCatalogLang(path: string, locale: Locale = getLocale()): string {
  const lang = catalogLang(locale)
  if (!lang) return path
  const sep = !path.includes('?') ? '?' : path.endsWith('?') || path.endsWith('&') ? '' : '&'
  return path + sep + 'lang=' + lang
}
