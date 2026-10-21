import { useCallback } from 'react'
import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'
import { translate, type Table, type Vars } from './core'
import { cachedFixes, fetchFixes } from './remote'
import {
  AVAILABLE_LOCALES,
  FALLBACK_LOCALE,
  LOCALES,
  availableLocale,
  isAvailableLocale,
  isLocale,
  localeFromSystem,
  localeInfo,
  marketOf,
  marketOffers,
  type Locale,
  type Market,
  type MarketFeature,
} from './locales'

export { AVAILABLE_LOCALES, LOCALES, isAvailableLocale, isLocale, localeInfo, marketOf, marketOffers }
export type { Locale, Market, MarketFeature, Vars }

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
  pl: () => import('./locales/pl.json'),
}

/// What lookups read: the built-in table with the site's fixes laid over it.
const tables: Partial<Record<Locale, Table>> = {}
const builtIn: Partial<Record<Locale, Table>> = {}
const fixes: Partial<Record<Locale, Table>> = {}
const loading: Partial<Record<Locale, Promise<void>>> = {}

function compose(code: Locale) {
  const base = builtIn[code] ?? {}
  const fix = fixes[code]
  tables[code] = fix && Object.keys(fix).length ? { ...base, ...fix } : base
  useI18n.setState((s) => ({ revision: s.revision + 1 }))
}

/// Saved fixes apply with the table; fresh ones are asked for a few seconds after start, off the first paint.
const FIXES_DELAY_MS = 4000

function followFixes(code: Locale) {
  const saved = cachedFixes(code)
  if (saved) fixes[code] = saved
  setTimeout(() => {
    void fetchFixes(code).then((fresh) => {
      if (fresh === null) return
      fixes[code] = fresh
      if (code === 'ru' || builtIn[code]) compose(code)
    })
  }, FIXES_DELAY_MS)
}

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
  if (tables[code]) return Promise.resolve()
  if (code === 'ru') {
    followFixes(code)
    compose(code)
    return Promise.resolve()
  }
  const pending = loading[code]
  if (pending) return pending
  followFixes(code)
  const run = LOADERS[code]()
    .then((mod) => {
      builtIn[code] = mod.default
      compose(code)
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

void activate(useI18n.getState().locale)
