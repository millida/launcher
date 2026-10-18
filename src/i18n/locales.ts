export type Locale =
  | 'en'
  | 'zh'
  | 'hi'
  | 'es'
  | 'ar'
  | 'fr'
  | 'bn'
  | 'pt-BR'
  | 'id'
  | 'ur'
  | 'ru'
  | 'de'
  | 'ja'
  | 'vi'
  | 'te'
  | 'tr'
  | 'ko'
  | 'pl'

export type Currency = 'RUB' | 'USD'

export type Market = 'RU' | 'INTL'

/// Things that exist only on the Russian market: Millida Trade (server donation
/// shops), the player market of millida.net, promos of partner servers that play
/// in Russian, and Russian-language content such as translated packs and the
/// Telegram channel. Paid packs (subscriptions, purchases, access keys) are sold
/// in rubles only.
export type MarketFeature = 'trade' | 'market' | 'partners' | 'ru-content' | 'paid-packs'

export interface LocaleInfo {
  code: Locale
  native: string
  intl: string
  rtl: boolean
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en', native: 'English', intl: 'en-US', rtl: false },
  { code: 'zh', native: '简体中文', intl: 'zh-CN', rtl: false },
  { code: 'hi', native: 'हिन्दी', intl: 'hi-IN', rtl: false },
  { code: 'es', native: 'Español', intl: 'es-ES', rtl: false },
  { code: 'ar', native: 'العربية', intl: 'ar', rtl: true },
  { code: 'fr', native: 'Français', intl: 'fr-FR', rtl: false },
  { code: 'bn', native: 'বাংলা', intl: 'bn-BD', rtl: false },
  { code: 'pt-BR', native: 'Português (Brasil)', intl: 'pt-BR', rtl: false },
  { code: 'id', native: 'Bahasa Indonesia', intl: 'id-ID', rtl: false },
  { code: 'ur', native: 'اردو', intl: 'ur-PK', rtl: true },
  { code: 'ru', native: 'Русский', intl: 'ru-RU', rtl: false },
  { code: 'de', native: 'Deutsch', intl: 'de-DE', rtl: false },
  { code: 'ja', native: '日本語', intl: 'ja-JP', rtl: false },
  { code: 'vi', native: 'Tiếng Việt', intl: 'vi-VN', rtl: false },
  { code: 'te', native: 'తెలుగు', intl: 'te-IN', rtl: false },
  { code: 'tr', native: 'Türkçe', intl: 'tr-TR', rtl: false },
  { code: 'ko', native: '한국어', intl: 'ko-KR', rtl: false },
  { code: 'pl', native: 'Polski', intl: 'pl-PL', rtl: false },
]

export const SOURCE_LOCALE: Locale = 'ru'
export const FALLBACK_LOCALE: Locale = 'en'

const CODES = new Set<string>(LOCALES.map((l) => l.code))

/// Players from these systems read Russian far better than English, and the
/// launcher has no Ukrainian, Belarusian or Kazakh table of its own.
const RUSSIAN_READERS = new Set(['ru', 'uk', 'be', 'kk'])

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && CODES.has(v)

/// Only these tables are offered for now. The others stay in the code and turn
/// on by adding their code here, without touching the pickers.
/// The translated tables wait for review behind this single switch.
export const EXTRA_LOCALES_PUBLIC = true

export const EXTRA_LOCALES: readonly Locale[] = ['pt-BR', 'es', 'de', 'tr', 'pl']

const AVAILABLE = new Set<Locale>(['ru', 'en', ...(EXTRA_LOCALES_PUBLIC ? EXTRA_LOCALES : [])])

export const isAvailableLocale = (v: unknown): v is Locale => isLocale(v) && AVAILABLE.has(v)

export const AVAILABLE_LOCALES: readonly LocaleInfo[] = LOCALES.filter((l) => AVAILABLE.has(l.code))

export const localeInfo = (code: Locale): LocaleInfo => LOCALES.find((l) => l.code === code) ?? LOCALES[0]!

export function localeFromSystem(tags: readonly string[]): Locale {
  for (const raw of tags) {
    const tag = String(raw || '').toLowerCase()
    if (!tag) continue
    const base = tag.split(/[-_]/)[0] ?? ''
    if (RUSSIAN_READERS.has(base)) return 'ru'
    if (base === 'pt') return 'pt-BR'
    if (base === 'in') return 'id'
    if (isLocale(base)) return base
  }
  return FALLBACK_LOCALE
}

export const availableLocale = (code: Locale): Locale => (AVAILABLE.has(code) ? code : FALLBACK_LOCALE)

export const marketOf = (code: Locale): Market => (code === 'ru' ? 'RU' : 'INTL')

export const marketCurrency = (code: Locale): Currency => (marketOf(code) === 'RU' ? 'RUB' : 'USD')

const RU_ONLY: ReadonlySet<MarketFeature> = new Set(['trade', 'market', 'partners', 'ru-content', 'paid-packs'])

export const marketOffers = (market: Market, feature: MarketFeature): boolean => market === 'RU' || !RU_ONLY.has(feature)
