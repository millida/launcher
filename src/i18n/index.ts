import { useCallback } from 'react'
import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'
import { translate, type Table, type Vars } from './core'
import { useCurrencyOverride } from './currencyOverride'
import {
  AVAILABLE_LOCALES,
  FALLBACK_LOCALE,
  LOCALES,
  availableLocale,
  isAvailableLocale,
  isLocale,
  localeFromSystem,
  localeInfo,
  marketCurrency,
  marketOf,
  marketOffers,
  type Currency,
  type Locale,
  type Market,
  type MarketFeature,
} from './locales'

export { AVAILABLE_LOCALES, LOCALES, isAvailableLocale, isLocale, localeInfo, marketCurrency, marketOf, marketOffers }
export type { Currency, Locale, Market, MarketFeature, Vars }

const STORE_KEY = 'm-lang'

type Loader = () => Promise<{ default: Table }>

/// Spelled out instead of import.meta.glob so the same module also loads under
/// bun test, where glob imports do not exist. Each table is its own chunk.
const LOADERS: Record<Exclude<Locale, 'ru'>, Loader> = {
  en: () => import('./locales/en.json'),
  zh: () => import('./locales/zh.json'),
  hi: () => import('./locales/hi.json'),
  es: () => import('./locales/es.json'),
  ar: () => import('./locales/ar.json'),
  fr: () => import('./locales/fr.json'),
  bn: () => import('./locales/bn.json'),
  'pt-BR': () => import('./locales/pt-BR.json'),
  id: () => import('./locales/id.json'),
  ur: () => import('./locales/ur.json'),
  de: () => import('./locales/de.json'),
  ja: () => import('./locales/ja.json'),
  vi: () => import('./locales/vi.json'),
  te: () => import('./locales/te.json'),
  tr: () => import('./locales/tr.json'),
  ko: () => import('./locales/ko.json'),
}

const tables: Partial<Record<Locale, Table>> = {}
const loading: Partial<Record<Locale, Promise<void>>> = {}

interface I18nState {
  locale: Locale
  revision: number
}

function systemTags(): string[] {
  if (typeof navigator === 'undefined') return []
  const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]
  return list.filter(Boolean)
}

function initialLocale(): Locale {
  const stored = readPref(STORE_KEY, '')
  return isAvailableLocale(stored) ? stored : availableLocale(localeFromSystem(systemTags()))
}

export const useI18n = create<I18nState>(() => ({ locale: initialLocale(), revision: 0 }))

function ensureTable(code: Locale): Promise<void> {
  if (code === 'ru' || tables[code]) return Promise.resolve()
  const pending = loading[code]
  if (pending) return pending
  const run = LOADERS[code]()
    .then((mod) => {
      tables[code] = mod.default
      useI18n.setState((s) => ({ revision: s.revision + 1 }))
    })
    .catch((e: unknown) => {
      console.error('[i18n] dictionary failed to load', code, e)
    })
    .finally(() => {
      delete loading[code]
    })
  loading[code] = run
  return run
}

function applyDocument(code: Locale) {
  const root = typeof document === 'undefined' ? undefined : document.documentElement
  if (!root) return
  root.lang = code
  root.dir = localeInfo(code).rtl ? 'rtl' : 'ltr'
}

function activate(code: Locale): Promise<void> {
  applyDocument(code)
  return Promise.all([ensureTable(code), ensureTable(FALLBACK_LOCALE)]).then(() => undefined)
}

export function setLocale(code: Locale): Promise<void> {
  if (!isAvailableLocale(code)) return Promise.resolve()
  writePref(STORE_KEY, code)
  useI18n.setState({ locale: code })
  return activate(code)
}

export const hasChosenLocale = (): boolean => isAvailableLocale(readPref(STORE_KEY, ''))

/// The durable prefs file lands after the first render; a language picked in an
/// earlier run has to win over the guess made from the system before it arrived.
export function syncLocaleFromPrefs() {
  const stored = readPref(STORE_KEY, '')
  if (isAvailableLocale(stored) && stored !== useI18n.getState().locale) useI18n.setState({ locale: stored })
  void activate(useI18n.getState().locale)
}

export const getLocale = (): Locale => useI18n.getState().locale

/// The one place that decides what a player's market is; screens ask this, never the language.
export const getMarket = (): Market => marketOf(getLocale())

export function useMarket(): Market {
  return useI18n((s) => marketOf(s.locale))
}

export function useMarketOffers(feature: MarketFeature): boolean {
  return useI18n((s) => marketOffers(marketOf(s.locale), feature))
}

export function t(key: string, vars?: Vars): string {
  const code = useI18n.getState().locale
  return translate(code, key, vars, tables[code], tables[FALLBACK_LOCALE])
}

export function useLocale(): Locale {
  return useI18n((s) => s.locale)
}

export function useT(): (key: string, vars?: Vars) => string {
  const code = useI18n((s) => s.locale)
  const revision = useI18n((s) => s.revision)
  return useCallback((key: string, vars?: Vars) => translate(code, key, vars, tables[code], tables[FALLBACK_LOCALE]), [code, revision])
}

export const intlTag = (code: Locale = getLocale()): string => localeInfo(code).intl

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlTag(), options).format(value)
}

export const formatFixed = (value: number, digits: number): string =>
  formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlTag(), options).format(value)
}

export const currentCurrency = (): Currency => useCurrencyOverride.getState().forced ?? marketCurrency(getLocale())

export function formatPrice(amount: number, currency: Currency = currentCurrency()): string {
  const whole = Number.isInteger(amount)
  return new Intl.NumberFormat(intlTag(), {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount)
}

/// The API sends money in minor units: kopecks for RUB, cents for USD.
export const formatMinorPrice = (minor: number, currency: Currency = currentCurrency()): string => formatPrice(minor / 100, currency)

/// A price is shown only in the market's own currency. When the API has no
/// amount for it the caller gets null and must hide the price or the offer:
/// converting by a guessed rate would quote a sum nobody can actually pay.
/// Goods priced only in rubles (author packs): a foreign account is charged their dollar list
/// price from the dollar wallet, so a dollar surface shows that, not a converted ruble sum.
export function rubleGoodsPrice(kopecks: number, rubText: (kopecks: number) => string): string {
  if (currentCurrency() === 'RUB') return rubText(kopecks)
  return formatMinorPrice(digitalUsdCents(kopecks), 'USD')
}

/// Dollar list price of goods priced in rubles only, at the PLUS ratio the server charges abroad
/// (trade-api core/pricing/price-book.ts digitalUsdCents), not at the exchange rate.
export function digitalUsdCents(rubKopecks: number): number {
  const cents = (rubKopecks * 499) / 29900
  const step = cents >= 1000 ? 100 : 10
  return Math.max(99, Math.round(cents / step) * step - 1)
}

export function marketPrice(minorByCurrency: Partial<Record<Currency, number>>): string | null {
  const currency = currentCurrency()
  const minor = minorByCurrency[currency]
  return typeof minor === 'number' && Number.isFinite(minor) ? formatMinorPrice(minor, currency) : null
}

void activate(useI18n.getState().locale)
