/**
 * ДЕМО ЭКОНОМИКИ ВЕЩЕЙ (?preview=user, только dev).
 *
 * Ответы ручек из контракта 23.09.2026 (analysis/2026-09-23_economy-api-contract.md)
 * поверх ЖИВОГО каталога косметики: имена, превью и цены — настоящие, выдумано
 * только «моё» состояние (баланс, осколки, что куплено, часы). Покупки меняют
 * состояние в памяти вкладки: баланс падает, вещь становится «куплено».
 *
 * Параметры адреса для скриншотов:
 *   &rubies=N          — баланс рубинов;
 *   &night=0           — ночной рынок закрыт;
 *   &xray=wait         — рентген-кейс уже куплен, следующий через N ч;
 *   &weekly=parcel|parcel-wait|parcel-done — посылка недели (форма службы сейчас;
 *                      по умолчанию — готова, три вещи на выбор);
 *   &weekly=path|wait|done — недельный путь (пока служба его не отдаёт);
 *   &plus-migration=1  — бывший подписчик, окно выбора вещей старого набора;
 *   &gift=rubies|shards|item|claimed — старый подарок дня (по умолчанию его нет:
 *                      с 23.09.2026, 21:43 вместо него ежедневный бонус);
 *   &wish=0            — пустой «Хочу».
 */
import type {
  Achievement,
  EconomyProgress,
  ItemRef,
  PlusEconomy,
  ShopCard,
  ShopDay,
  ShopGift,
  ShopPack,
  Workshop,
  XrayOffer,
} from '../../lib/rubies'
import { rarityOfPrice } from './rarity'
import type { Rarity } from '../../lib/rubies'
import { variantCode, variantTitles } from '../../lib/variantNames'
import { FLAGSHIP_SLOTS, FRAGMENTS_NEED, SHARD_CAP, SHARD_DAILY_LIMIT, WORKSHOP_COST, fragmentOff } from '../daily/chestDrops'
import type { WeeklyPath, WeeklyReward } from './weekly'
import type { WishEntry, WishHow, WishList } from './wish'

export interface DemoCatalogItem {
  id: string
  name: string
  slot: string
  preview?: string
  priceRubies?: number
  access?: string
  staffOnly?: boolean
  /** Расцветки каталога (v3: каждая — отдельная вещь). */
  variants?: { name: string; color?: string; emissive?: string }[]
}

/** Ранги по порядку: ранг расцветки = ранг вещи + сдвиг стиля (зеркало variants.catalog.ts службы). */
const RANKS: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'RELIC']
const PRISM = /rainbow|prism|galaxy|holo|cosmic|chroma|aurora|void/
const ELEMENT = /gold|diamond|emerald|amethyst|netherite|obsidian|fire|flame|magma|lava|soul|aether|blood|acid|(^|_)ice($|_)|wither|(^|_)ender|portal|neon|glow|lightning|frost/
const variantRank = (base: Rarity, name: string, i: number): Rarity => {
  if (i === 0) return base
  const by = PRISM.test(name) ? 2 : ELEMENT.test(name) ? 1 : 0
  return RANKS[Math.min(RANKS.indexOf('MYTHIC'), Math.max(RANKS.indexOf(base), RANKS.indexOf(base) + by))] || base
}
/** Цена ранга v3.1 в рубинах: 150 / 350 / 700 / 1 400 / 2 800 / 5 600; невозможная не продаётся. */
const RANK_PRICE: Record<Rarity, number> = { COMMON: 150, UNCOMMON: 350, RARE: 700, EPIC: 1400, LEGENDARY: 2800, MYTHIC: 5600, RELIC: 0 }
/** Прод ещё на курсе 5 ₽/рубин: цена вещи в демо — × 7/5. */
const v3Price = (p: number) => Math.round((p * 7) / 5 / 10) * 10

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Демо: вещи, которые показываем мифическими (по цене мифическую не угадать). */
const MYTHIC_DEMO = new Set<string>()
const ref = (x: DemoCatalogItem): ItemRef => ({
  code: x.id,
  name: x.name,
  slot: x.slot,
  rarity: MYTHIC_DEMO.has(x.id) ? 'MYTHIC' : rarityOfPrice(x.priceRubies || 0),
  preview: x.preview || null,
})

/** Смена дня — 00:00 МСК = 21:00 UTC. */
function nextMskMidnight(from = Date.now()): number {
  const d = new Date(from)
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21)
  return t > from ? t : t + DAY
}

/** Детерминированный генератор: витрина одна и та же весь день. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100_000) / 100_000
  }
}

const q = () => {
  try {
    return new URLSearchParams(location.search)
  } catch {
    return new URLSearchParams()
  }
}

interface State {
  shop: ShopDay
  workshop: Workshop
  weekly: WeeklyPath
  progress: EconomyProgress
  plus: Omit<PlusEconomy, 'active' | 'paidUntil' | 'canceled' | 'priceKopecks'>
  owned: Set<string>
  /** Вещи, которые не продаются: чем их получить (для «Хочу»). */
  earn: Map<string, WishHow>
  /** Любая вещь каталога по коду. */
  refs: Map<string, ItemRef>
}

/**
 * Достижения v2 — только то, что лаунчер проверяет сам (правка владельца
 * 21:54: «"Пережить 30 ночей" — лаунчер этого не знает»). Каждое ведёт к
 * фиче, которую человек ещё не пробовал. Источник данных — в economy-v2.md.
 * code, название, прогресс, цель, награда (осколки | 'item' | 'excl'), экран.
 */
type AchRow = [string, string, number, number, number | 'item' | 'excl', Achievement['go']?]
const ACHIEVEMENTS: AchRow[] = [
  ['launch-1', 'Запусти игру', 1, 1, 50, 'play'],
  ['server-rating', 'Зайди на сервер из рейтинга', 1, 1, 50, 'servers'],
  ['skin-upload', 'Загрузи свой скин', 1, 1, 100, 'skins'],
  ['outfit-save', 'Сохрани образ', 0, 1, 50, 'skins'],
  ['friend-add', 'Добавь друга', 1, 1, 100, 'friends'],
  ['friend-play', 'Сыграй с другом на одном сервере', 0, 1, 150, 'friends'],
  ['build-launch', 'Запусти сборку', 1, 1, 50, 'builds'],
  ['build-create', 'Создай или импортируй сборку', 0, 1, 100, 'builds'],
  ['mods-10', 'Поставь 10 модов', 4, 10, 100, 'mods'],
  ['host-create', 'Создай свой сервер', 0, 1, 'item', 'hosting'],
  ['host-friend', 'Позови друга на свой сервер', 0, 1, 300, 'hosting'],
  ['days-7', '7 дней в лаунчере', 7, 7, 100],
  ['days-30', '30 дней в лаунчере', 12, 30, 300],
  ['days-100', '100 дней в лаунчере', 12, 100, 'item'],
  ['days-365', 'Год в лаунчере', 12, 365, 'excl'],
  ['hours-10', '10 часов в игре', 10, 10, 100],
  ['hours-50', '50 часов в игре', 29, 50, 200],
  ['servers-10', '10 разных серверов', 7, 10, 150, 'servers'],
  ['servers-50', '50 разных серверов', 7, 50, 'item', 'servers'],
  ['friends-5', '5 друзей', 3, 5, 200, 'friends'],
  ['friend-play-10', '10 игр с друзьями', 2, 10, 'item', 'friends'],
  ['launches-100', '100 запусков', 41, 100, 200, 'play'],
]

async function build(catalog: DemoCatalogItem[], wallet: { balance: number }, packsLive: ShopPack[]): Promise<State> {
  const p = q()
  if (p.has('rubies')) wallet.balance = Math.max(0, Number(p.get('rubies')) || 0)
  const now = Date.now()
  const refresh = nextMskMidnight(now)
  const shop = catalog.filter((x) => x.access === 'PURCHASE' && (x.priceRubies || 0) > 0)
  const plusPool = catalog.filter((x) => x.access === 'PLUS')
  const used = new Set<string>()
  const random = rng(Math.floor((refresh - 21 * HOUR) / DAY) * 7919)
  const take = (list: DemoCatalogItem[], test: (x: DemoCatalogItem) => boolean): DemoCatalogItem => {
    const ok = list.filter((x) => !used.has(x.id) && test(x))
    const pick = ok[Math.floor(random() * ok.length)] || list.find((x) => !used.has(x.id)) || list[0]!
    used.add(pick.id)
    return pick
  }
  const rarity = (x: DemoCatalogItem) => rarityOfPrice(x.priceRubies || 0)
  const top = (x: DemoCatalogItem) => rarity(x) === 'EPIC' || rarity(x) === 'LEGENDARY'

  // Вещи «Пути» и мастерской в магазин не попадают: сначала отбираем их.
  const capes = shop.filter((x) => x.slot === 'CAPE').slice(0, 8)
  capes.forEach((x) => used.add(x.id))
  const achItems = [0, 1, 2, 3, 4].map(() => take(shop, (x) => ['FACE', 'EARS', 'HEAD', 'ACCESSORY', 'EMOTE'].includes(x.slot) && !top(x)))
  // Мастерская модели v2: 5 обычных, 4 необычных, 3 редких — эпических и флагманов за осколки нет.
  const plain = (x: DemoCatalogItem) => !FLAGSHIP_SLOTS.includes(x.slot)
  const workshopItems = [
    ...Array.from({ length: 5 }, () => take(shop, (x) => rarity(x) === 'COMMON' && plain(x))),
    ...Array.from({ length: 4 }, () => take(shop, (x) => rarity(x) === 'UNCOMMON' && plain(x))),
    ...Array.from({ length: 3 }, () => take(shop, (x) => rarity(x) === 'RARE' && plain(x))),
  ]
  const weeklyPrize = take(shop, (x) => rarity(x) === 'RARE' && ['WINGS', 'PET', 'BACK', 'HAT', 'EFFECT'].includes(x.slot))

  // Купленное заранее: у игрока не пустая коллекция.
  const owned = new Set<string>([capes[0]!.id, capes[1]!.id, achItems[0]!.id, workshopItems[3]!.id])

  // Начатые вещи: фрагменты из сундуков снижают цену (модель v2).
  const frags = new Map<string, number>()
  /**
   * Карточка витрины (v3.1): вещь-расцветка. У вещи с расцветками демо берёт
   * одну — по дню, — со своим кодом «КОД~имя», именем, рангом и ценой ранга.
   */
  const card = (x: DemoCatalogItem, leavesAt: number, discountPct = 0): ShopCard => {
    let it = ref(x)
    let base = MYTHIC_DEMO.has(x.id) ? RANK_PRICE.MYTHIC : RANK_PRICE[it.rarity] || v3Price(x.priceRubies || 0)
    const list = (x.variants || []).filter((v) => v && v.name)
    if (list.length > 1) {
      const i = Math.floor(random() * list.length)
      const v = list[i]!
      const rarity = variantRank(it.rarity, v.name.toLowerCase(), i)
      const title = variantTitles(x.name, list.map((y) => y.name))[i] || x.name
      it = {
        ...it,
        code: variantCode(x.id, v.name),
        name: title,
        rarity,
        variant: v.name,
        color: (v.color || '').replace('#', ''),
        ...(i > 0 && list[0]!.color ? { tintFrom: list[0]!.color.replace('#', '') } : {}),
      }
      base = RANK_PRICE[rarity] || base
    }
    const shown = Math.round((base * (100 - discountPct)) / 100 / 10) * 10
    const have = owned.has(it.code) ? 0 : frags.get(x.id) || 0
    const need = FRAGMENTS_NEED[it.rarity]
    const off = have && need ? fragmentOff(shown, have, need) : 0
    return {
      item: it,
      price: shown - off,
      basePrice: base,
      discountPct,
      owned: owned.has(it.code),
      leavesAt: new Date(leavesAt).toISOString(),
      ...(have && need ? { fragments: { have: Math.min(have, need), need, off } } : {}),
    }
  }

  const featured = take(shop, (x) => ['WINGS', 'PET', 'BACK', 'EFFECT'].includes(x.slot) && rarity(x) === 'LEGENDARY')
  const deal = take(shop, (x) => rarity(x) === 'EPIC' && ['HAT', 'FULL_BODY', 'WINGS', 'PET'].includes(x.slot))
  // Восемь вещей: ровная сетка 4 или 8 в ряд (правка владельца 23.09.2026).
  const items = [
    take(shop, top),
    ...Array.from({ length: 7 }, (_, i) => take(shop, (x) => (i < 2 ? rarity(x) === 'RARE' : !top(x)))),
  ]
  const forYou = Array.from({ length: 4 }, () => take(shop, (x) => !owned.has(x.id)))
  // Шесть редкостей на одной витрине: первая вещь дня — мифическая (демо события).
  MYTHIC_DEMO.add(items[0]!.id)
  // Фрагменты: начатые вещи витрины — только не флагманы (из сундука их фрагментов не бывает).
  if (p.get('frags') !== '0') {
    const shares = [0.35, 0.7, 0.5, 0.2]
    ;[...items, deal, ...forYou]
      .filter((x) => !FLAGSHIP_SLOTS.includes(x.slot) && FRAGMENTS_NEED[ref(x).rarity] > 0)
      .slice(0, shares.length)
      .forEach((x, i) => frags.set(x.id, Math.max(1, Math.round(FRAGMENTS_NEED[ref(x).rarity] * shares[i]!))))
  }
  // Одна вещь витрины уже куплена: карточка показывает «Куплено».
  owned.add(items[5]!.id)

  // Набор: вещи одной темы по слову в названии.
  let bundleItems: DemoCatalogItem[] = []
  let bundleTheme = ''
  for (const [word, title] of [
    ['дракон', 'Драконий'],
    ['демон', 'Демонический'],
    ['рыцар', 'Рыцарский'],
    ['кибер', 'Кибер'],
    ['пират', 'Пиратский'],
    ['огн', 'Огненный'],
  ]) {
    const found = shop.filter((x) => !used.has(x.id) && x.name.toLowerCase().includes(word!))
    const slots = new Set<string>()
    const pick = found.filter((x) => (slots.has(x.slot) ? false : (slots.add(x.slot), true))).slice(0, 4)
    if (pick.length >= 3) {
      bundleItems = pick
      bundleTheme = title!
      break
    }
  }
  if (!bundleItems.length) bundleItems = [0, 1, 2].map(() => take(shop, () => true))
  bundleItems.forEach((x) => used.add(x.id))
  owned.add(bundleItems[bundleItems.length - 1]!.id)
  const bundleLeaves = refresh + DAY

  const nightOn = p.get('night') !== '0'
  const nightDiscounts = [22, 15, 40, 18, 30, 26]
  const night = nightDiscounts.map((d, i) => card(take(shop, (x) => (i < 2 ? top(x) : rarity(x) === 'RARE' || top(x))), refresh + 7 * DAY, d))

  const xrayItem = take(shop, (x) => rarity(x) === 'EPIC')
  const xrayWait = p.get('xray') === 'wait'
  const xray: XrayOffer = {
    id: 'xr-' + xrayItem.id,
    tier: 'EPIC',
    item: ref(xrayItem),
    price: 2_200,
    expiresAt: new Date(now + 4 * HOUR).toISOString(),
    nextAt: xrayWait ? new Date(now + 3 * HOUR + 20 * 60_000).toISOString() : null,
  }

  const monthPlus = plusPool
    .filter((x) => ['WINGS', 'PET', 'BACK', 'FULL_BODY'].includes(x.slot))
    .filter((x, i, all) => all.findIndex((o) => o.slot === x.slot) === i)
    .slice(0, 3)

  // Недельный путь сбрасывается в понедельник 00:00 МСК.
  const monday = (() => {
    const mskDay = (new Date(refresh).getUTCDay() + 1) % 7
    return refresh + ((1 - mskDay + 7) % 7) * DAY
  })()
  const weeklyMode = p.get('weekly')
  const hoursSteps = [10, 25, 50, 100, 250, 500, 1_000, 2_000]
  const hours = 29
  let achItem = 0
  const achievements: Achievement[] = ACHIEVEMENTS.map(([code, title, progress, target, prize, go]) => ({
    code,
    title,
    points: typeof prize === 'number' ? Math.round(prize / 10) : prize === 'item' ? 25 : 50,
    done: progress >= target,
    progress: Math.min(progress, target),
    target,
    reward:
      typeof prize === 'number'
        ? { kind: 'SHARDS' as const, amount: prize }
        : { kind: 'ITEM' as const, item: ref(achItems[achItem++ % achItems.length]!), exclusive: prize === 'excl' },
    go,
  }))
  const points = achievements.filter((a) => a.done).reduce((n, a) => n + a.points, 0)

  const migrationOn = p.get('plus-migration') === '1'

  // Подарок дня меняется каждый день: рубины, осколки, вещь — по кругу.
  const dayIndex = Math.floor((refresh - 21 * HOUR) / DAY)
  const giftParam = p.get('gift')
  const giftKind: ShopGift['kind'] =
    giftParam === 'rubies' ? 'RUBIES' : giftParam === 'shards' ? 'SHARDS' : giftParam === 'item' ? 'ITEM' : (['RUBIES', 'SHARDS', 'ITEM'] as const)[dayIndex % 3]!
  const giftItem = take(shop, (x) => rarity(x) === 'COMMON' && !owned.has(x.id))
  const gift: ShopGift | null = !giftParam ? null : {
    kind: giftKind,
    amount: giftKind === 'RUBIES' ? 12 : giftKind === 'SHARDS' ? 15 : undefined,
    item: giftKind === 'ITEM' ? ref(giftItem) : undefined,
    claimed: giftParam === 'claimed',
    refreshAt: new Date(refresh).toISOString(),
  }

  const earn = new Map<string, WishHow>([
    ...capes.map((x) => [x.id, 'HOURS'] as [string, WishHow]),
    ...achItems.map((x) => [x.id, 'ACHIEVEMENT'] as [string, WishHow]),
  ])
  const refs = new Map(catalog.map((x) => [x.id, ref(x)]))
  catalog.forEach((x) => PRICES.set(x.id, x.priceRubies || 0))

  return {
    owned,
    earn,
    refs,
    shop: {
      balance: wallet.balance,
      shards: 640,
      plus: false,
      day: {
        featured: card(featured, refresh),
        deal: card(deal, refresh, 25),
        items: items.map((x) => card(x, refresh)),
        forYou: forYou.map((x) => card(x, refresh)),
        refreshAt: new Date(refresh).toISOString(),
      },
      bundle: {
        id: 'bundle-' + bundleItems[0]!.id,
        title: bundleTheme ? bundleTheme + ' набор' : 'Набор дня',
        items: bundleItems.map((x) => card(x, bundleLeaves)),
        price: 0,
        fullPrice: 0,
        leavesAt: new Date(bundleLeaves).toISOString(),
      },
      nightMarket: nightOn ? { endsAt: new Date(refresh + 7 * DAY).toISOString(), cards: night } : null,
      xray,
      packs: packsLive,
      gift,
      // «Хочу» на все статусы: вещь с витрины (тост «на витрине»), из
      // мастерской, две вернутся, одна — только за часы в игре.
      wishlist:
        p.get('wish') === '0'
          ? []
          : [items[1]!.id, workshopItems[5]!.id, take(shop, top).id, take(shop, top).id, capes[4]!.id],
    },
    workshop: {
      shards: 640,
      cap: SHARD_CAP,
      today: { earned: 60, limit: SHARD_DAILY_LIMIT, resetsAt: new Date(refresh).toISOString() },
      fragments: [...frags.entries()]
        .map(([id, have]) => ({ item: refs.get(id)!, have, need: FRAGMENTS_NEED[refs.get(id)!.rarity] }))
        .filter((f) => f.item && f.need),
      workshop: {
        items: workshopItems.map((x) => ({
          item: ref(x),
          cost: WORKSHOP_COST[rarity(x)] ?? 1_000,
          owned: owned.has(x.id),
        })),
        rotatesAt: new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1) - 3 * HOUR).toISOString(),
      },
    },
    weekly: weeklyPath(weeklyMode, ref(weeklyPrize), weeklyPrize.priceRubies || 1_600, new Date(monday).toISOString()),
    progress: {
      hours,
      hourItems: hoursSteps.map((h, i) => ({ hours: h, item: ref(capes[i % capes.length]!), owned: hours >= h })),
      achievements,
      points,
      pointItems: [50, 100, 150, 250, 400].map((pt, i) => ({ points: pt, item: ref(achItems[i]!), owned: points >= pt })),
    },
    plus: {
      month: { items: monthPlus.map(ref), claimed: false },
      rubiesOnPay: 750,
      shardBoost: 1.5,
      // Живой каталог уже без вещей access=PLUS — для показа берём продаваемые.
      migration: migrationOn
        ? { eligible: true, picks: 12, picked: [], pool: (plusPool.length ? plusPool : catalog.filter((x) => x.priceRubies)).slice(0, 40).map(ref) }
        : null,
    },
  }
}

/**
 * Недельный путь: задания → звёзды → вещь недели. По умолчанию — 8 из 10:
 * видна кнопка «Докупить 2», ступень 3 забрана, ступень 6 ждёт «Забрать».
 */
const WEEKLY_NEED = 10
const WEEKLY_STAR_PRICE = 100
function weeklyPath(mode: string | null, prize: ItemRef, prizePrice: number, resetsAt: string): WeeklyPath {
  const start = mode === 'wait'
  const all = mode === 'done'
  // code, название, звёзд за задание, прогресс, цель, единица
  const rows: [string, string, number, number, number, string?][] = [
    ['hours', 'Играй на серверах', 5, start ? 1.6 : all ? 5 : 3.4, 5, 'ч'],
    ['friend', 'Сыграй с другом', 1, all || !start ? 1 : 0, 1],
    ['server', 'Зайди на новый сервер', 1, 1, 1],
    ['days', 'Заходи 4 дня', 2, start ? 1 : all ? 4 : 4, 4, 'дн'],
    ['bonus', 'Забери бонус', 1, start ? 1 : all ? 3 : 2, 3, 'раз'],
    ['try', 'Примерь вещь с витрины', 1, all ? 1 : 0, 1],
  ]
  const tasks = rows.map(([code, title, stars, progress, target, unit]) => ({
    code,
    title,
    stars,
    progress,
    target,
    unit,
    earned: code === 'hours' ? Math.min(stars, Math.floor(progress)) : progress >= target ? stars : 0,
  }))
  const stars = Math.min(WEEKLY_NEED, tasks.reduce((n, t) => n + t.earned, 0))
  return {
    weekKey: 0,
    resetsAt,
    stars,
    need: WEEKLY_NEED,
    prize,
    prizePrice,
    steps: [
      { at: 3, reward: { kind: 'SHARDS', amount: 30 }, claimed: stars >= 3 && !all },
      { at: 6, reward: { kind: 'SHARDS', amount: 60 }, claimed: false },
      { at: 10, reward: { kind: 'ITEM', item: prize }, claimed: false },
    ],
    tasks,
    plus: false,
    plusHoursBoost: 2,
    boost: null,
  }
}

/** «Докупить» — только с 7 звёзд и только недостающее. */
function priceBoost(w: WeeklyPath) {
  const missing = w.need - w.stars
  const prizeTaken = w.steps.some((st) => st.reward.kind === 'ITEM' && st.claimed)
  w.boost =
    missing > 0 && !prizeTaken
      ? { available: w.stars >= 7, missing, pricePerStar: WEEKLY_STAR_PRICE, price: missing * WEEKLY_STAR_PRICE }
      : null
}

/** Цена набора: полная — за все вещи, к оплате — только за недостающие, −20 %. */
function priceBundle(s: State) {
  const b = s.shop.bundle
  if (!b) return
  b.items.forEach((c) => (c.owned = s.owned.has(c.item.code)))
  b.fullPrice = b.items.reduce((n, c) => n + c.basePrice, 0)
  b.price = Math.round((b.items.filter((c) => !c.owned).reduce((n, c) => n + c.basePrice, 0) * 0.8) / 10) * 10
}

function syncOwned(s: State) {
  const all = [s.shop.day.featured, s.shop.day.deal, ...s.shop.day.items, ...s.shop.day.forYou, ...(s.shop.nightMarket?.cards || [])].filter((c): c is ShopCard => !!c)
  all.forEach((c) => (c.owned = s.owned.has(c.item.code)))
  s.workshop.workshop.items.forEach((w) => (w.owned = s.owned.has(w.item.code)))
  priceBundle(s)
  priceBoost(s.weekly)
}

const fail = (text: string) => Promise.reject(new Error(text))

/** Каталожная цена вещи по коду (для «Хочу»: сколько стоит то, что вернётся). */
const PRICES = new Map<string, number>()
function priceOfRef(_s: State, code: string): number {
  return PRICES.get(code) || 0
}

/**
 * Обработчики ручек экономики. `wallet` — общий объект баланса демо, чтобы
 * старая ручка /rubies/balance видела те же рубины.
 */
export function demoEconomy(deps: {
  catalog: () => Promise<DemoCatalogItem[]>
  packs: () => Promise<ShopPack[]>
  wallet: { balance: number }
}) {
  let state: Promise<State> | null = null
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
  const get = () => {
    if (!state)
      state = (async () => {
        const [cat, packs] = await Promise.all([deps.catalog(), deps.packs()])
        const s = await build(cat, deps.wallet, packs)
        syncOwned(s)
        return s
      })()
    state.catch(() => (state = null))
    return state
  }

  const shop = async () => {
    const s = await get()
    s.shop.balance = deps.wallet.balance
    s.shop.shards = s.workshop.shards
    syncOwned(s)
    return JSON.parse(JSON.stringify(s.shop)) as ShopDay
  }

  const buy = async (body: { code?: string; source?: string; bundleId?: string }) => {
    const s = await get()
    const cards = [s.shop.day.featured, s.shop.day.deal, ...s.shop.day.items, ...s.shop.day.forYou, ...(s.shop.nightMarket?.cards || [])].filter((c): c is ShopCard => !!c)
    if (body.source === 'bundle') {
      const b = s.shop.bundle
      if (!b || b.id !== body.bundleId) return fail('bundle gone')
      priceBundle(s)
      if (deps.wallet.balance < b.price) return fail('http 402')
      deps.wallet.balance -= b.price
      const granted = b.items.filter((c) => !s.owned.has(c.item.code)).map((c) => c.item)
      granted.forEach((i) => s.owned.add(i.code))
      syncOwned(s)
      return { balance: deps.wallet.balance, granted }
    }
    const c = cards.find((x) => x.item.code === body.code)
    if (!c) return fail('not in shop')
    if (s.owned.has(c.item.code)) return fail('owned')
    if (deps.wallet.balance < c.price) return fail('http 402')
    deps.wallet.balance -= c.price
    s.owned.add(c.item.code)
    syncOwned(s)
    return { balance: deps.wallet.balance, granted: [c.item] }
  }

  const wish = async (body: { code?: string; on?: boolean }) => {
    const s = await get()
    const list = s.shop.wishlist.filter((c) => c !== body.code)
    if (body.on && body.code) list.push(body.code)
    s.shop.wishlist = list
    return { wishlist: list }
  }

  const xrayBuy = async (body: { id?: string }) => {
    const s = await get()
    const x = s.shop.xray
    if (!x || x.id !== body.id || x.nextAt) return fail('offer gone')
    if (deps.wallet.balance < x.price) return fail('http 402')
    deps.wallet.balance -= x.price
    s.owned.add(x.item.code)
    // Следующий кейс — через 4 часа: перебирать до легендарки нельзя.
    x.nextAt = new Date(Date.now() + 4 * HOUR).toISOString()
    return { balance: deps.wallet.balance, item: x.item, chestId: 'xr-chest-' + x.item.code }
  }

  const craft = async (body: { code?: string }) => {
    const s = await get()
    const w = s.workshop.workshop.items.find((x) => x.item.code === body.code)
    if (!w || s.owned.has(w.item.code)) return fail('not craftable')
    if (s.workshop.shards < w.cost) return fail('http 402')
    s.workshop.shards -= w.cost
    s.owned.add(w.item.code)
    syncOwned(s)
    return { shards: s.workshop.shards, item: w.item }
  }

  /** Посылка недели в форме службы (/rubies/weekly сейчас). */
  let parcelClaimed: string | null = null
  const parcelMode = () => {
    const m = new URLSearchParams(location.search).get('weekly')
    return m === 'path' || m === 'wait' || m === 'done' ? null : m || 'parcel'
  }
  const parcel = (s: State) => {
    const mode = parcelMode()
    const monday = new Date(s.weekly.resetsAt).toISOString()
    const claimedAt = mode === 'parcel-done' ? new Date(Date.now() - 3_600_000).toISOString() : parcelClaimed
    const hours = mode === 'parcel-wait' ? 1.4 : 3.6
    const ready = !claimedAt && hours >= 3
    const choices = s.shop.day.items.filter((c) => ['COMMON', 'UNCOMMON', 'RARE'].includes(c.item.rarity)).slice(0, 3).map((c) => c.item)
    return { hours, need: 3, ready, choices: ready ? choices : null, claimedAt, resetsAt: monday }
  }

  const weeklyClaim = async (body: { at?: number; code?: string }) => {
    const s = await get()
    if (parcelMode()) {
      const view = parcel(s)
      const item = view.choices?.find((c) => c.code === body.code)
      if (!item) return fail('Этой вещи нет в посылке недели')
      parcelClaimed = new Date().toISOString()
      s.owned.add(item.code)
      syncOwned(s)
      return { item: clone(item) }
    }
    const w = s.weekly
    const step = w.steps.find((st) => st.at === body.at)
    if (!step || step.claimed || w.stars < step.at) return fail('not ready')
    step.claimed = true
    const granted: WeeklyReward = step.reward
    if (granted.kind === 'SHARDS') s.workshop.shards = Math.min(s.workshop.cap, s.workshop.shards + granted.amount)
    else s.owned.add(granted.item.code)
    syncOwned(s)
    return { path: clone(w), balance: deps.wallet.balance, shards: s.workshop.shards, granted: clone(granted) }
  }

  const weeklyBoost = async (body: { stars?: number }) => {
    const s = await get()
    const w = s.weekly
    priceBoost(w)
    const b = w.boost
    if (!b || !b.available || body.stars !== b.missing) return fail('boost unavailable')
    if (deps.wallet.balance < b.price) return fail('http 402')
    deps.wallet.balance -= b.price
    w.stars = w.need
    priceBoost(w)
    return { path: clone(w), balance: deps.wallet.balance }
  }

  const giftClaim = async () => {
    const s = await get()
    const g = s.shop.gift
    if (!g || g.claimed) return fail('gift claimed')
    g.claimed = true
    if (g.kind === 'RUBIES') deps.wallet.balance += g.amount || 0
    if (g.kind === 'SHARDS') s.workshop.shards = Math.min(s.workshop.cap, s.workshop.shards + (g.amount || 0))
    if (g.kind === 'ITEM' && g.item) s.owned.add(g.item.code)
    return { balance: deps.wallet.balance, shards: s.workshop.shards, granted: clone(g) }
  }

  /** Награды бонуса (демо): рубины — в общий кошелёк, осколки — в мастерскую. */
  const credit = async (got: { rubies?: number; shards?: number }) => {
    const s = await get()
    deps.wallet.balance += got.rubies || 0
    s.workshop.shards = Math.min(s.workshop.cap, s.workshop.shards + (got.shards || 0))
  }

  /** «Хочу» со статусами (контракт GET /rubies/wishlist). */
  const wishlist = async (): Promise<WishList> => {
    const s = await get()
    syncOwned(s)
    const cards: [ShopCard, WishEntry['source']][] = [
      ...(s.shop.day.featured ? [[s.shop.day.featured, 'featured'] as [ShopCard, WishEntry['source']]] : []),
      ...(s.shop.day.deal ? [[s.shop.day.deal, 'deal'] as [ShopCard, WishEntry['source']]] : []),
      ...s.shop.day.items.map((c) => [c, 'day'] as [ShopCard, WishEntry['source']]),
      ...s.shop.day.forYou.map((c) => [c, 'forYou'] as [ShopCard, WishEntry['source']]),
      ...(s.shop.nightMarket?.cards || []).map((c) => [c, 'night'] as [ShopCard, WishEntry['source']]),
    ]
    const hash = (code: string) => [...code].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7)
    const items: WishEntry[] = []
    for (const code of s.shop.wishlist) {
      const hit = cards.find(([c]) => c.item.code === code)
      const w = s.workshop.workshop.items.find((x) => x.item.code === code)
      const item = hit?.[0].item || w?.item || s.refs.get(code)
      if (!item) continue
      if (s.owned.has(code)) items.push({ item, status: 'OWNED' })
      else if (hit) items.push({ item, status: 'SHOP', price: hit[0].price, basePrice: hit[0].basePrice, source: hit[1], leavesAt: hit[0].leavesAt })
      else if (w) items.push({ item, status: 'WORKSHOP', cost: w.cost })
      else if (s.earn.has(code)) items.push({ item, status: 'EARN', how: s.earn.get(code) })
      else items.push({ item, status: 'RETURNS', returnsAt: new Date(Date.now() + (3 + (hash(code) % 50)) * DAY).toISOString() })
    }
    // Итог — по базовой цене вещей магазина: у тех, что вернутся, цена та же, что в каталоге.
    const total = items.reduce((n, w) => {
      if (w.status === 'SHOP') return n + (w.price || 0)
      if (w.status === 'RETURNS') return n + (s.refs.get(w.item.code) ? priceOfRef(s, w.item.code) : 0)
      return n
    }, 0)
    return { items, total, missing: Math.max(0, total - deps.wallet.balance) }
  }

  /** Докупить ровно N рубинов по базовому курсу (демо — сразу начисляет). */
  const topup = async (body: { rubies?: number }) => {
    const n = Math.max(1, Math.min(50_000, Math.round(body.rubies || 0)))
    deps.wallet.balance += n
    return { rubies: n, kopecks: n * 20, balance: deps.wallet.balance }
  }

  const plusMonthClaim = async () => {
    const s = await get()
    return fail(s.plus.month ? 'plus required' : 'no month')
  }

  /** Подарок новичку (модель v2): нимб из живого каталога, навсегда и сразу надет. */
  const welcomeClaim = async () => {
    const s = await get()
    const item = s.refs.get('ANGEL_HALO') || null
    const granted = !!item && !s.owned.has('ANGEL_HALO')
    if (item) s.owned.add('ANGEL_HALO')
    return { item: item ? { ...item, rarity: 'UNCOMMON' as const } : null, claimed: !!item, granted, equipped: granted }
  }

  const migrationPick = async (body: { codes?: string[] }) => {
    const s = await get()
    const m = s.plus.migration
    if (!m) return fail('not eligible')
    const codes = (body.codes || []).filter((c) => !m.picked.includes(c)).slice(0, m.picks - m.picked.length)
    m.picked.push(...codes)
    codes.forEach((c) => s.owned.add(c))
    return { granted: m.pool.filter((i) => codes.includes(i.code)) }
  }

  return {
    shop,
    buy,
    credit,
    wishlist,
    topup,
    giftClaim,
    wish,
    xrayBuy,
    craft,
    weeklyClaim,
    weeklyBoost,
    plusMonthClaim,
    migrationPick,
    welcomeClaim,
    workshop: async () => clone((await get()).workshop),
    weekly: async () => {
      const s = await get()
      if (parcelMode()) return parcel(s)
      priceBoost(s.weekly)
      return clone(s.weekly)
    },
    progress: async () => clone((await get()).progress),
    plus: async () => clone((await get()).plus),
  }
}
