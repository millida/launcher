import { create } from 'zustand'
import type { ShopCard, ShopDay, ShopPack, ShopSource } from '../../lib/rubies'
import { MONTH_ART, packArtAt, SECOND_ART, sortPacks } from './packMath'
import { shopCards } from './wish'

/** Полоску «не хватает» показываем, только когда до вещи остаётся немного. */
export const SHORTFALL_MAX = 400

/** Вариант пополнения в окне выбора: обычный пакет или доступный разовый оффер. */
export interface PickOption {
  code: string
  title: string
  rubies: number
  kopecks: number
  art: string
  badgePct?: number
  oneTime?: boolean
  endsAt?: string
  /** Объект для doPack — покупается тем же путём, что пакет. */
  pack: ShopPack
}

/** Пакеты по цене плюс доступные разовые офферы (Второй шаг, месяц) как варианты пополнения. */
export function pickOptions(day: ShopDay): PickOption[] {
  const { list } = sortPacks(day.packs.filter((p) => !p.oneTime))
  const out: PickOption[] = list.map((p, i) => ({
    code: p.code,
    title: p.title,
    rubies: p.rubies,
    kopecks: p.kopecks,
    art: packArtAt(i, list.length),
    badgePct: p.badgePct,
    pack: p,
  }))
  const offer = (o: { code: string; title: string; rubies: number; kopecks: number; badgePct?: number; endsAt: string }, art: string): PickOption => ({
    code: o.code,
    title: o.title,
    rubies: o.rubies,
    kopecks: o.kopecks,
    art,
    badgePct: o.badgePct,
    oneTime: true,
    endsAt: o.endsAt,
    pack: o as unknown as ShopPack,
  })
  if (day.secondOffer) out.push(offer(day.secondOffer, SECOND_ART))
  if (day.monthOffer) out.push(offer(day.monthOffer, MONTH_ART))
  return out
}

/**
 * Рекомендуемый вариант: самый дешёвый по деньгам, которого ХВАТАЕТ на цель с
 * учётом баланса и уже доступных разовых. Если не хватает ни одного — самый
 * крупный, чтобы подойти ближе всего.
 */
export function recommendPack(options: PickOption[], held: number, target: number): PickOption | null {
  const enough = options.filter((o) => held + o.rubies >= target).sort((a, b) => a.kopecks - b.kopecks)
  if (enough.length) return enough[0]
  return [...options].sort((a, b) => b.rubies - a.rubies)[0] ?? null
}

/** Остаток после покупки варианта при текущем балансе (может быть отрицательным). */
export const leftAfter = (held: number, option: PickOption, target: number) => held + option.rubies - target

/**
 * Вещь, под которую показывать нехватку: 1) из «Хочу» с самой маленькой
 * нехваткой; 2) вещь/сделка дня; 3) самая дешёвая вещь витрины дороже баланса.
 * Только вещи, которые дороже баланса и которых ещё нет.
 */
export function shortfallItem(day: ShopDay): { card: ShopCard; source: ShopSource } | null {
  const bal = day.balance
  const inShop = shopCards(day).filter(([c]) => !c.owned && c.price > bal)
  if (!inShop.length) return null
  const want = new Set(day.wishlist)
  const wished = inShop.filter(([c]) => want.has(c.item.code))
  if (wished.length) {
    const best = wished.reduce((a, b) => (b[0].price - bal < a[0].price - bal ? b : a))
    return { card: best[0], source: best[1] }
  }
  const deal = inShop.find(([, s]) => s === 'deal' || s === 'featured')
  if (deal) return { card: deal[0], source: deal[1] }
  const cheap = inShop.reduce((a, b) => (b[0].price < a[0].price ? b : a))
  return { card: cheap[0], source: cheap[1] }
}

/** Следующая по цене вещь из «Хочу»/витрины дороже заданного остатка — для «до „X" не хватит». */
export function nextUnaffordable(day: ShopDay, left: number, exceptCode?: string): { name: string; price: number } | null {
  const want = new Set(day.wishlist)
  const cards = shopCards(day)
    .map(([c]) => c)
    .filter((c) => !c.owned && c.item.code !== exceptCode && c.price > left)
  if (!cards.length) return null
  const wished = cards.filter((c) => want.has(c.item.code))
  const pool = wished.length ? wished : cards
  const pick = pool.reduce((a, b) => (b.price < a.price ? b : a))
  return { name: pick.item.name, price: pick.price }
}

/** Запрос на пополнение: цель в рубинах, под что копим, следующая вещь и источник открытия. */
export interface PackNeed {
  target: number
  /** Что показать в подписи и что предложить купить сразу после пополнения. */
  item?: { card: ShopCard; source: ShopSource }
  /** Своя подпись цели, если это не одна вещь (например, всё из «Хочу»). */
  title?: string
  /** Следующая вещь, на которую может не хватить остатка. */
  next?: { name: string; price: number }
  /** Откуда открыли — для аналитики. */
  from: string
}

interface NeedState {
  need: PackNeed | null
  open: (n: PackNeed) => void
  close: () => void
}

export const usePackNeed = create<NeedState>((set) => ({
  need: null,
  open: (need) => set({ need }),
  close: () => set({ need: null }),
}))

export const openPackNeed = (need: PackNeed) => usePackNeed.getState().open(need)

/* ── Полоска «не хватает»: один раз в день на аккаунт, крестик — до завтра ── */

const BAR_KEY = 'm-shortfall-bar'

export function barDismissed(dayKey: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(BAR_KEY) || '{}') as { day?: string }).day === dayKey
  } catch {
    return false
  }
}

export function dismissBar(dayKey: string) {
  try {
    localStorage.setItem(BAR_KEY, JSON.stringify({ day: dayKey }))
  } catch {
    /* хранилище недоступно — полоска просто покажется завтра снова */
  }
}

/* ── «Теперь хватает»: не чаще раза в день на аккаунт, выключается настройкой ── */

const AFFORD_OFF_KEY = 'm-afford-notice'

/** Уведомление «Теперь хватает» включено (по умолчанию да). */
export function affordNoticeOn(): boolean {
  try {
    return localStorage.getItem(AFFORD_OFF_KEY) !== '0'
  } catch {
    return true
  }
}

export function setAffordNotice(on: boolean) {
  try {
    localStorage.setItem(AFFORD_OFF_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const AFFORD_KEY = 'm-afford-seen'

export function affordNoticedToday(dayKey: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(AFFORD_KEY) || '{}') as { day?: string }).day === dayKey
  } catch {
    return false
  }
}

export function markAffordNoticed(dayKey: string) {
  try {
    localStorage.setItem(AFFORD_KEY, JSON.stringify({ day: dayKey }))
  } catch {
    /* ignore */
  }
}

/** Самая дорогая вещь из «Хочу»/дня, на которую баланс только что стал хватать. */
export function nowAffordable(day: ShopDay, was: number): { card: ShopCard; source: ShopSource } | null {
  const bal = day.balance
  if (bal <= was) return null
  const want = new Set(day.wishlist)
  const inShop = shopCards(day).filter(([c]) => !c.owned && c.price > was && c.price <= bal)
  if (!inShop.length) return null
  const wished = inShop.filter(([c]) => want.has(c.item.code))
  const pool = wished.length ? wished : inShop.filter(([, s]) => s === 'deal' || s === 'featured')
  const list = pool.length ? pool : inShop
  const best = list.reduce((a, b) => (b[0].price > a[0].price ? b : a))
  return { card: best[0], source: best[1] }
}
