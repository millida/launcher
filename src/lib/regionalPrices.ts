import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from './api'
import { formatMinorPrice, marketPrice, type Currency } from '../i18n'
import { useCurrencyOverride } from '../i18n/currencyOverride'

export type DualPrice = { RUB?: number; USD: number | null }

export interface PriceList {
  region: 'RU' | 'INTL'
  country: string | null
  proven: boolean
  forceCurrency: 'USD' | null
  rubPerUsd: number
  plus: { tier: 'PLUS' | 'DIAMOND'; price: DualPrice }[]
  hosting: { code: string; ramMb: number; price: DualPrice }[]
  rubies: { code: string; price: DualPrice }[]
  skins: { RUB?: Record<string, number>; USD: Record<string, number> }
}

type State = { list: PriceList | null; loading: boolean; seq: number }

export const useRegionalPriceStore = create<State>(() => ({ list: null, loading: false, seq: 0 }))

/// The account's region decides prices, so they come from the API rather than from the language.
export async function loadRegionalPrices(): Promise<void> {
  const seq = useRegionalPriceStore.getState().seq + 1
  useRegionalPriceStore.setState({ loading: true, seq })
  try {
    const list = await api<PriceList>('/pricing')
    if (useRegionalPriceStore.getState().seq !== seq) return
    useRegionalPriceStore.setState({ list, loading: false })
    useCurrencyOverride.setState({ forced: list.forceCurrency, rubPerUsd: list.rubPerUsd })
  } catch {
    if (useRegionalPriceStore.getState().seq === seq) useRegionalPriceStore.setState({ loading: false })
  }
}

export function resetRegionalPrices(): void {
  useRegionalPriceStore.setState((s) => ({ list: null, loading: false, seq: s.seq + 1 }))
  useCurrencyOverride.setState({ forced: null, rubPerUsd: null })
}

export function useRegionalPrices(): PriceList | null {
  const list = useRegionalPriceStore((s) => s.list)
  const loading = useRegionalPriceStore((s) => s.loading)
  useCurrencyOverride((s) => s.forced)
  useEffect(() => {
    if (!list && !loading) void loadRegionalPrices()
  }, [list, loading])
  return list
}

const pick = (price: DualPrice | undefined, rubKopecks: number | null): Partial<Record<Currency, number>> => {
  const out: Partial<Record<Currency, number>> = {}
  const rub = price ? price.RUB : rubKopecks
  if (typeof rub === 'number' && !(useRegionalPriceStore.getState().list?.forceCurrency === 'USD')) out.RUB = rub
  if (price && typeof price.USD === 'number') out.USD = price.USD
  return out
}

const list = () => useRegionalPriceStore.getState().list

export const plusPrice = (tier: 'PLUS' | 'DIAMOND', rubKopecks: number | null): string | null =>
  marketPrice(pick(list()?.plus.find((p) => p.tier === tier)?.price, rubKopecks))

export const rubyPackPrice = (code: string, rubKopecks: number): string | null =>
  marketPrice(pick(list()?.rubies.find((r) => r.code === code || (code.startsWith('month-') && r.code === 'month'))?.price, rubKopecks))

export const hostingPlanPrice = (code: string, rubKopecks: number): string | null =>
  marketPrice(pick(list()?.hosting.find((h) => h.code === code)?.price, rubKopecks))

/// Worth of rubies at shop price: in dollars it follows the dollar list (PLUS ratio), not the rate.
export const rubyWorthPrice = (rubKopecks: number): string | null => {
  const plus = list()?.plus.find((p) => p.tier === 'PLUS')?.price.USD
  return marketPrice(pick(typeof plus === 'number' ? { RUB: rubKopecks, USD: Math.round((rubKopecks * plus) / 29900) } : undefined, rubKopecks))
}

/// The Millida balance in its own currency: a foreign account holds dollars (cents), everyone
/// else rubles. Never converted: it is what the wallet will actually be charged.
export const walletMoney = (minor: number, rubText: (kopecks: number) => string): string =>
  useCurrencyOverride.getState().forced === 'USD' ? formatMinorPrice(minor, 'USD') : rubText(minor)
