import { api } from '../../lib/api'
import type { ItemRef, ShopCard, ShopDay, ShopSource, Workshop } from '../../lib/rubies'

/**
 * «Хочу» v2 (правка владельца 23.09.2026, 21:45: «сделано по-тупому»).
 *
 * Было: лента из имён без статуса — непонятно, когда вещь будет и сколько
 * копить. Стало: у каждой вещи статус и следующее действие —
 *   SHOP      — в магазине сейчас: цена и «Купить»;
 *   RETURNS   — вернётся не позже `returnsAt` (гарантия 60 дней);
 *   WORKSHOP  — собирается осколками в мастерской: `cost`;
 *   EARN      — купить нельзя, только игрой: `how` (сезон, достижения, часы, PLUS);
 *   OWNED     — уже есть (список чистится сам).
 * Сверху — сколько рубинов не хватает на всё покупаемое и «Докупить».
 *
 * Контракт: GET /v2/rubies/wishlist → WishList. Старая служба ручки не знает —
 * тогда список собирается на клиенте из магазина дня и мастерской (без дат).
 */
export type WishStatus = 'SHOP' | 'RETURNS' | 'WORKSHOP' | 'EARN' | 'OWNED'
export type WishHow = 'SEASON' | 'ACHIEVEMENT' | 'HOURS' | 'PLUS' | 'QUEST'

export interface WishEntry {
  item: ItemRef
  status: WishStatus
  /** SHOP: цена сейчас (со скидкой), базовая и откуда покупать. */
  price?: number
  basePrice?: number
  source?: ShopSource
  /** SHOP: до какого времени на витрине. */
  leavesAt?: string
  /** RETURNS: последний срок возвращения (гарантия 60 дней). Нет — дата неизвестна. */
  returnsAt?: string | null
  /** WORKSHOP: цена в осколках. */
  cost?: number
  /** EARN: чем получить. */
  how?: WishHow
}

export interface WishList {
  items: WishEntry[]
  /** Сумма базовых цен всего, что покупается за рубины (SHOP + RETURNS). */
  total: number
  /** Сколько рубинов не хватает на всё это при текущем балансе. */
  missing: number
}

/** Докупить ровно недостающее по базовому курсу (7 рубинов = 1 ₽), без пакета. */
export const buyExact = (rubies: number) =>
  api<{ rubies: number; kopecks: number; balance: number }>('/rubies/topup', {
    method: 'POST',
    body: JSON.stringify({ rubies }),
  })

/** Копейки за 1 рубин по базовому курсу v3: 7 рубинов за рубль (≈14,29 коп.). */
export const RUBY_KOPECKS = 100 / 7

/** Копейки за N рубинов, вверх до копейки: дробной цены не бывает. */
export const kopecksFor = (rubies: number) => Math.ceil(rubies * RUBY_KOPECKS)

/**
 * Сколько рубинов просить у /rubies/topup: вверх до кратного 7. Служба считает
 * `rubies * 100/7` копеек и кладёт в целое поле — на некратном числе падала
 * с 500 (6 раз из 7). Кратное 7 — ровные рубли, лишних максимум 6 рубинов.
 */
export const topUpRubies = (missing: number) => Math.max(7, Math.ceil(missing / 7) * 7)

/** Карточки магазина дня с их источником покупки. */
export function shopCards(day: ShopDay): [ShopCard, ShopSource][] {
  return [
    // featured/deal служба шлёт null, когда пул витрины пуст (ruby-showcase.service).
    ...(day.day.featured ? [[day.day.featured, 'featured'] as [ShopCard, ShopSource]] : []),
    ...(day.day.deal ? [[day.day.deal, 'deal'] as [ShopCard, ShopSource]] : []),
    ...day.day.items.map((c) => [c, 'day'] as [ShopCard, ShopSource]),
    ...day.day.forYou.map((c) => [c, 'forYou'] as [ShopCard, ShopSource]),
    ...(day.nightMarket?.cards ?? []).map((c) => [c, 'night'] as [ShopCard, ShopSource]),
  ]
}

/** Запасной вариант для старой службы: статус из магазина дня и мастерской. */
export function wishesFromShop(day: ShopDay, workshop: Workshop | null, catalog: Map<string, ItemRef>): WishList {
  const inShop = new Map(shopCards(day).map(([c, s]) => [c.item.code, [c, s] as const]))
  const inWork = new Map((workshop?.workshop.items ?? []).map((w) => [w.item.code, w]))
  const items: WishEntry[] = []
  for (const code of day.wishlist) {
    const shop = inShop.get(code)
    if (shop) {
      const [c, source] = shop
      items.push({
        item: c.item,
        status: c.owned ? 'OWNED' : 'SHOP',
        price: c.price,
        basePrice: c.basePrice,
        source,
        leavesAt: c.leavesAt,
      })
      continue
    }
    const w = inWork.get(code)
    if (w) {
      items.push({ item: w.item, status: w.owned ? 'OWNED' : 'WORKSHOP', cost: w.cost })
      continue
    }
    const item = catalog.get(code)
    if (item) items.push({ item, status: 'RETURNS', returnsAt: null })
  }
  const total = items.reduce((n, w) => n + (w.status === 'SHOP' ? (w.price ?? 0) : 0), 0)
  return { items, total, missing: Math.max(0, total - day.balance) }
}

/** Порядок в сетке: что можно взять сейчас — первым. */
const ORDER: Record<WishStatus, number> = { SHOP: 0, WORKSHOP: 1, RETURNS: 2, EARN: 3, OWNED: 4 }
export const sortWishes = (list: WishEntry[]) =>
  [...list].sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.returnsAt && b.returnsAt ? Date.parse(a.returnsAt) - Date.parse(b.returnsAt) : 0),
  )

/** Сколько дней до даты (минимум 1). */
export const daysUntil = (iso: string) => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000))

/* ── Уведомление «вещь из "Хочу" на витрине» ─────────────────────────────── */

const SEEN_KEY = 'm-wish-seen'

/** Какие вещи из «Хочу» уже показаны в этот день магазина (чтобы тост был один раз). */
function seenFor(dayKey: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') as { day?: string; codes?: string[] }
    return raw.day === dayKey ? new Set(raw.codes ?? []) : new Set()
  } catch {
    return new Set()
  }
}

export function markWishSeen(dayKey: string, codes: string[]) {
  try {
    const all = seenFor(dayKey)
    codes.forEach((c) => all.add(c))
    localStorage.setItem(SEEN_KEY, JSON.stringify({ day: dayKey, codes: [...all] }))
  } catch {
    /* хранилище недоступно — тост просто повторится */
  }
}

/** Вещи из «Хочу», которые сегодня в магазине и которых у игрока нет. */
export function wishedInShop(day: ShopDay): ItemRef[] {
  const want = new Set(day.wishlist)
  return shopCards(day)
    .map(([c]) => c)
    .filter((c) => want.has(c.item.code) && !c.owned)
    .map((c) => c.item)
}

/** Новые (ещё не показанные сегодня) вещи из «Хочу» на витрине. */
export function freshWishes(day: ShopDay): ItemRef[] {
  const seen = seenFor(day.day.refreshAt)
  return wishedInShop(day).filter((it) => !seen.has(it.code))
}
