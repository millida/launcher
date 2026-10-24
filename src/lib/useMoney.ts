import { useEffect } from 'react'
import { create } from 'zustand'
import { api, hasMillidaAccount, openExt } from './api'
import { t, useI18n, useLocale } from '../i18n'
import { showToast } from '../state/ui'
import {
  balanceOf,
  canAfford,
  formatMoney,
  goodsQuote,
  isMoneyView,
  isPriceList,
  moneyShortfall,
  quoteText,
  scaleQuote,
  shortfallOf,
  shortfallText,
  topupUrl,
  type MoneyCurrency,
  type MoneyShortfall,
  type MoneyView,
  type PriceList,
  type Quote,
  type TopupAsk,
} from './money'

type MoneyState = { view: MoneyView | null; prices: PriceList | null; loading: boolean; failedAt: number; seq: number }

export const useMoneyStore = create<MoneyState>(() => ({ view: null, prices: null, loading: false, failedAt: 0, seq: 0 }))

const RETRY_AFTER_MS = 30_000

const fetchView = async (): Promise<MoneyView | null> => {
  if (!hasMillidaAccount()) return null
  const v = await api<unknown>('/me/money').catch(() => null)
  return isMoneyView(v) ? v : null
}

export async function loadMoney(): Promise<void> {
  const seq = useMoneyStore.getState().seq + 1
  useMoneyStore.setState({ loading: true, seq })
  const [view, prices] = await Promise.all([fetchView(), api<unknown>('/pricing').catch(() => null)])
  if (useMoneyStore.getState().seq !== seq) return
  const list = isPriceList(prices) ? prices : null
  useMoneyStore.setState({ view, prices: list, loading: false, failedAt: list ? 0 : Date.now() })
}

/// The balance is topped up on the site, outside the launcher, so every purchase screen re-reads it.
export async function refreshMoney(): Promise<MoneyView | null> {
  const seq = useMoneyStore.getState().seq
  const view = await fetchView()
  if (useMoneyStore.getState().seq !== seq) return useMoneyStore.getState().view
  if (view) useMoneyStore.setState({ view })
  return view ?? useMoneyStore.getState().view
}

useI18n.subscribe((s, was) => {
  if (s.locale !== was.locale && useMoneyStore.getState().prices) void loadMoney()
})

export function resetMoney(): void {
  useMoneyStore.setState((s) => ({ view: null, prices: null, loading: false, failedAt: 0, seq: s.seq + 1 }))
}

function ensureMoney(): void {
  const s = useMoneyStore.getState()
  if (!s.prices && !s.loading && Date.now() - s.failedAt > RETRY_AFTER_MS) void loadMoney()
}

export function useMoney(): MoneyState {
  useLocale()
  const state = useMoneyStore()
  useEffect(ensureMoney, [state.prices, state.loading])
  return state
}

const view = () => useMoneyStore.getState().view
const prices = () => useMoneyStore.getState().prices

export const accountCurrency = (): MoneyCurrency | null => view()?.displayCurrency ?? prices()?.displayCurrency ?? null

export const plusQuote = (tier: 'PLUS' | 'DIAMOND'): Quote | null => prices()?.plus.find((p) => p.tier === tier)?.quote ?? null

export const rubyQuote = (code: string): Quote | null =>
  prices()?.rubies.find((r) => r.code === code || (code.startsWith('month-') && r.code === 'month'))?.quote ?? null

export const hostingQuote = (code: string | null | undefined): Quote | null =>
  code ? (prices()?.hosting.find((h) => h.code === code)?.quote ?? null) : null

export const catalogQuote = (rubKopecks: number, line?: 'RUB'): Quote | null =>
  goodsQuote(rubKopecks, accountCurrency(), view()?.rubPerUsd ?? prices()?.rubPerUsd ?? null, line)

export const plusPrice = (tier: 'PLUS' | 'DIAMOND'): string | null => quoteText(plusQuote(tier))

/// The pack's own ruble price backs a missing price-list entry: the list can lag behind the packs.
/// Only for a ruble account, where the pack's kopecks are exactly what is charged.
export const rubyPackPrice = (code: string, packKopecks?: number): string | null =>
  quoteText(rubyQuote(code) ?? (packKopecks && accountCurrency() === 'RUB' ? catalogQuote(packKopecks) : null))

export const rubyPackWas = (code: string, packKopecks: number, wasKopecks: number): string | null =>
  quoteText(scaleQuote(rubyQuote(code), packKopecks, wasKopecks))

export const hostingPlanPrice = (code: string | null | undefined): string | null => quoteText(hostingQuote(code))

export const catalogPrice = (rubKopecks: number, line?: 'RUB'): string | null => quoteText(catalogQuote(rubKopecks, line))

export const worthPrice = (rubKopecks: number): string | null => catalogPrice(rubKopecks)

export const moneyText = (minor: number, currency: MoneyCurrency | null | undefined): string | null => {
  const cur = currency ?? accountCurrency()
  return cur ? formatMoney(minor, cur) : null
}

export function balanceText(): string | null {
  const b = balanceOf(view())
  return b ? formatMoney(b.minor, b.currency) : null
}

export const affords = (q: Quote | null | undefined): boolean | null => canAfford(q, view())

export const shortfallFor = (q: Quote | null | undefined): MoneyShortfall | null => shortfallOf(q, view())

export function openTopup(ask: TopupAsk | null = null): void {
  openExt(topupUrl(ask))
}

/// One reaction to a money refusal everywhere: the text in the interface language and a top-up
/// sized to the shortfall. Returns false for any other failure, which the caller explains itself.
export function showMoneyError(e: unknown): boolean {
  const s = moneyShortfall(e)
  if (!s) return false
  void refreshMoney()
  showShortfall(s)
  return true
}

export function showShortfall(s: MoneyShortfall): void {
  showToast(shortfallText(s), 'error', undefined, { label: t('Пополнить'), run: () => openTopup(s.topup) })
}
