import type { FlagCountry } from '../components/pxFlags'

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
  | 'uk'
  | 'sr'
  | 'sk'

export type Market = 'RU' | 'CIS' | 'INTL'

/// Things that exist only on the Russian market: Millida Trade (server donation
/// shops), the player market of millida.net, promos of partner servers that play
/// in Russian, and Russian-language content such as translated packs and the
/// Telegram channel. Paid packs (subscriptions, purchases, access keys) are sold
/// in rubles. CIS players read Russian packs and pay in rubles, so they get both
/// of those, and nothing else of the Russian market.
export type MarketFeature = 'trade' | 'market' | 'partners' | 'ru-content' | 'paid-packs'

export interface LocaleInfo {
  code: Locale
  native: string
  english: string
  intl: string
  /// Pixel flag; English shows the US flag and Telugu the Indian one, as the site does.
  flag: FlagCountry
  rtl: boolean
}

/// Russian and English lead, the rest follow by number of speakers; pickers show this order as is.
export const LOCALES: readonly LocaleInfo[] = [
  { code: 'ru', native: 'Русский', english: 'Russian', intl: 'ru-RU', flag: 'ru', rtl: false },
  { code: 'en', native: 'English', english: 'English', intl: 'en-US', flag: 'us', rtl: false },
  { code: 'zh', native: '简体中文', english: 'Chinese (Simplified)', intl: 'zh-CN', flag: 'cn', rtl: false },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', intl: 'hi-IN', flag: 'in', rtl: false },
  { code: 'es', native: 'Español', english: 'Spanish', intl: 'es-ES', flag: 'es', rtl: false },
  { code: 'ar', native: 'العربية', english: 'Arabic', intl: 'ar', flag: 'sa', rtl: true },
  { code: 'fr', native: 'Français', english: 'French', intl: 'fr-FR', flag: 'fr', rtl: false },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', intl: 'bn-BD', flag: 'bd', rtl: false },
  { code: 'pt-BR', native: 'Português (Brasil)', english: 'Portuguese (Brazil)', intl: 'pt-BR', flag: 'br', rtl: false },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', intl: 'id-ID', flag: 'id', rtl: false },
  { code: 'ur', native: 'اردو', english: 'Urdu', intl: 'ur-PK', flag: 'pk', rtl: true },
  { code: 'de', native: 'Deutsch', english: 'German', intl: 'de-DE', flag: 'de', rtl: false },
  { code: 'ja', native: '日本語', english: 'Japanese', intl: 'ja-JP', flag: 'jp', rtl: false },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', intl: 'vi-VN', flag: 'vn', rtl: false },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', intl: 'te-IN', flag: 'in', rtl: false },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', intl: 'tr-TR', flag: 'tr', rtl: false },
  { code: 'ko', native: '한국어', english: 'Korean', intl: 'ko-KR', flag: 'kr', rtl: false },
  { code: 'pl', native: 'Polski', english: 'Polish', intl: 'pl-PL', flag: 'pl', rtl: false },
  { code: 'uk', native: 'Українська', english: 'Ukrainian', intl: 'uk-UA', flag: 'ua', rtl: false },
  { code: 'sr', native: 'Srpski', english: 'Serbian', intl: 'sr-Latn-RS', flag: 'rs', rtl: false },
  { code: 'sk', native: 'Slovenčina', english: 'Slovak', intl: 'sk-SK', flag: 'sk', rtl: false },
]

export const SOURCE_LOCALE: Locale = 'ru'
export const FALLBACK_LOCALE: Locale = 'en'

const CODES = new Set<string>(LOCALES.map((l) => l.code))

/// Players from these systems read Russian far better than English, and the
/// launcher has no Belarusian or Kazakh table of its own.
const RUSSIAN_READERS = new Set(['ru', 'be', 'kk'])

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && CODES.has(v)

/// Only these tables are offered for now. The others stay in the code and turn
/// on by adding their code here, without touching the pickers.
/// The translated tables wait for review behind this single switch.
export const EXTRA_LOCALES_PUBLIC = true

export const EXTRA_LOCALES: readonly Locale[] = ['pt-BR', 'es', 'de', 'tr', 'pl', 'zh', 'hi', 'ar', 'fr', 'bn', 'id', 'ur', 'ja', 'vi', 'te', 'ko', 'uk', 'sr', 'sk']

const AVAILABLE = new Set<Locale>(['ru', 'en', ...(EXTRA_LOCALES_PUBLIC ? EXTRA_LOCALES : [])])

export const isAvailableLocale = (v: unknown): v is Locale => isLocale(v) && AVAILABLE.has(v)

export const AVAILABLE_LOCALES: readonly LocaleInfo[] = LOCALES.filter((l) => AVAILABLE.has(l.code))

export const localeInfo = (code: Locale): LocaleInfo => LOCALES.find((l) => l.code === code) ?? LOCALES.find((l) => l.code === FALLBACK_LOCALE)!

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

const CIS_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['uk'])

export const marketOf = (code: Locale): Market => (code === 'ru' ? 'RU' : CIS_LOCALES.has(code) ? 'CIS' : 'INTL')

const RU_ONLY: ReadonlySet<MarketFeature> = new Set(['trade', 'market', 'partners', 'ru-content', 'paid-packs'])

const CIS_OFFERS: ReadonlySet<MarketFeature> = new Set(['ru-content', 'paid-packs'])

export const marketOffers = (market: Market, feature: MarketFeature): boolean =>
  market === 'RU' || !RU_ONLY.has(feature) || (market === 'CIS' && CIS_OFFERS.has(feature))
