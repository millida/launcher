import { api } from './api'

/**
 * Семь рангов (модель предметов v3, 24.09.2026). Ранг — у расцветки: базовая
 * расцветка несёт ранг вещи, металл/стихия/свечение — на ранг выше, радуга —
 * на два (потолок — мифическая). Невозможная (RELIC) — только ручной список.
 */
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC' | 'RELIC'
export type ChestTier = 'COMMON' | 'RARE' | 'EPIC' | 'LEGEND'

export interface RubyBalance {
  balance: number
  earned: number
  spent: number
}

export interface DailyStatus {
  claimedToday: boolean
  streak: number
  cycleDay: number
  todayRubies: number
  todayChest: ChestTier | null
  graceLeft: number
  /** Щиты серии на эту неделю: пропуск дня прощается (1, PLUS — 2). Старая служба полей не шлёт. */
  shields?: number
  shieldsMax?: number
  /** Сегодняшний вход спасён щитом. */
  shieldSaved?: boolean
  /** День серии сегодня (МСК) уже засчитан: окно открывали или играли. Трей не считается. */
  activeToday?: boolean
  /** Вход идёт по подписке: те же дни, но щедрее. Старая служба поля не шлёт. */
  plus?: boolean
  plusMultiplier?: number
  /**
   * Сколько рубинов даёт день. Пока на сервере старая выдача, приезжает одно
   * число `rubies` - лаунчер обновляется раньше службы, и день не должен
   * оставаться без подписи.
   */
  cycle: { day: number; rubiesMin?: number; rubiesMax?: number; rubies?: number; chest: ChestTier | null }[]
  /**
   * Трек наград (схема 23.09.2026): 7 дней, у каждого бесплатная строка и
   * строка PLUS. Подписчик получает обе. Старая служба поля не шлёт — тогда
   * окно рисует прежний трек по `cycle`.
   */
  track?: DailyTrackDay[]
  /** Вещь периода (две недели): собирается из фрагментов, которые дают дни трека. */
  weekItem?: WeekItem | null
  /** ISO-время, когда откроется следующий сундук. */
  nextAt?: string | null
  /**
   * Сезон трека (Battle Pass, 23.09.2026): 28 клеток, каждый день входа
   * открывает следующую. Открытое и не забранное можно забрать до конца
   * сезона. Старая служба поля не шлёт — клиент считает сам (track.ts).
   */
  season?: DailySeason | null
  /**
   * «Мои сундуки»: неоткрытые сундуки игрока (24.09.2026). Сундук из клетки
   * не открывается сам — лежит здесь, пока игрок не нажмёт «Открыть».
   * Старая служба поля не шлёт — блока нет.
   */
  chests?: PendingChest[] | null
}

export interface DailySeason {
  id: string
  /** Сколько клеток открыто (дней входа в сезоне). */
  day: number
  endsAt: string
  /** Когда откроется следующая клетка. */
  nextUnlockAt: string
}

/** Состояние клетки трека: забрана, можно забрать, PLUS без подписки, ещё закрыта. */
export type DailyCellState = 'claimed' | 'ready' | 'locked' | 'future'

/** Вещь из каталога косметики так, как её показывает награда. */
export interface RewardItem {
  code: string
  name: string
  slot?: string
  rarity?: Rarity
  /** PNG 160×160 из каталога косметики. */
  preview: string | null
  /** Расцветка (модель v3): имя варианта каталога и её цвет RRGGBB. */
  variant?: string
  color?: string
  /** v3.1: цвет базовой расцветки — превью перекрашивается из него в color. */
  tintFrom?: string
}

/**
 * Награда клетки трека (модель v3, 24.09.2026). Бесплатная строка — осколки,
 * сундуки и две клетки рубинов за сезон; строка PLUS — рубины (оплачены
 * подпиской), фрагменты ранга и конкретная расцветка сезона.
 */
export type Reward =
  | { kind: 'RUBIES'; amount: number }
  /** Осколки — вторая валюта, только за игру (экономика v2, 23.09.2026). */
  | { kind: 'SHARDS'; amount: number }
  | { kind: 'CHEST'; tier: ChestTier }
  /** Фрагменты ранга; вещь (расцветка) — если служба уже знает, во что они лягут. */
  | { kind: 'FRAGMENTS'; amount: number; rarity?: Rarity; item?: RewardItem }
  | { kind: 'ITEM'; rarity?: Rarity; item?: RewardItem; owned?: boolean }

export interface DailyTrackDay {
  day: number
  free: Reward[]
  plus: Reward[]
  freeState?: DailyCellState
  plusState?: DailyCellState
}

export interface WeekItem extends RewardItem {
  have: number
  need: number
  owned: boolean
  endsAt: string
}

export type GrantedReward = Reward & {
  source: 'free' | 'plus'
  /** Клетка сезона, из которой пришла награда (1…28). */
  day?: number
  /** Сундук: его id в «Моих сундуках». */
  chestId?: string
  /** Фрагменты ушли в рубины: вещь периода уже есть. */
  convertedRubies?: number
  /** Этими фрагментами вещь периода собрана. */
  unlocked?: boolean
}

export interface DailyClaim extends DailyStatus {
  gained: number
  chestId: string | null
  balance: number
  /** Что пришло, по порядку: сначала бесплатное, потом PLUS. Старая служба не шлёт. */
  granted?: GrantedReward[]
  /** Фрагментов хватило — вещь периода теперь в инвентаре (праздничный кадр). */
  weekItemUnlocked?: RewardItem | null
}

export interface PendingChest {
  id: string
  tier: ChestTier
  /** DAILY | DAILY_PLUS | PROMO | creator | playtime:hours50 … — подпись «откуда» в «Моих сундуках». */
  source: string
  title: string
  createdAt: string
  /** Клетка бонуса, из которой сундук (1…28). Старая служба не шлёт — подпись датой. */
  day?: number
}

export interface OpenedChest {
  id: string
  tier: ChestTier
  openedAt: string
  duplicate: boolean
  rubiesInstead: number | null
  item: { code: string; name: string; previewUrl: string | null } | null
}

export interface ChestItemRef {
  code: string
  name: string
  slot: string
  previewUrl: string | null
}

/** Расцветка в выпадении сундука: имя варианта и цвет RRGGBB. */
export interface ChestVariant {
  name: string
  color: string
  /** v3.1: цвет базовой расцветки — превью перекрашивается из него. */
  from?: string
}

/**
 * Строка выпадения сундука (модель v3). Слот ранга COMMON..EPIC — FRAGMENTS:
 * фрагменты одной расцветки, `have/need` — прогресс после сундука,
 * `completed` — расцветка собрана сейчас, `item: null` — всё этого ранга
 * есть, фрагменты ушли осколками (`shards`). Слот LEGENDARY и выше — ITEM:
 * расцветка целиком. RUBIES — горсть рубинов эпического и легендарного сундука.
 */
export type ChestDrop =
  | { kind: 'SHARDS'; amount: number }
  | { kind: 'RUBIES'; amount: number }
  | {
      kind: 'ITEM'
      rarity: Rarity
      item: ChestItemRef | null
      variant?: ChestVariant | null
      duplicate: boolean
      shards: number
      rubies?: number
    }
  | {
      kind: 'FRAGMENTS'
      rarity: Rarity
      item: ChestItemRef | null
      variant?: ChestVariant | null
      amount: number
      have: number
      need: number
      completed: boolean
      shards: number
      /** Докупить недостающее, рубинов: вещь собирается только покупкой остатка. Старая служба не шлёт. */
      topUp?: number
    }

export interface ChestOpenResult {
  chestId: string
  tier: ChestTier
  /** Старые поля — первая вещь сундука: их читают лаунчеры до 24.09.2026. */
  rarity: Rarity
  item: ChestItemRef | null
  duplicate: boolean
  rubies: number
  /** Осколки всего: бонус и повторы (экономика v2). Старая служба не шлёт. */
  shards?: number
  pity: boolean
  /** Сундуков до гарантии: эпической и выше, легендарной и выше (v3.1). */
  pityLeft?: { epic: number; legend: number }
  /** Сколько ударов до открытия. Старая служба не шлёт — берём по уровню. */
  hits?: number
  /** Всё, что выпало, по порядку. Старая служба не шлёт — собираем из полей выше. */
  drops?: ChestDrop[]
  proof: { serverSeedHash: string; clientSeed: string; nonce: number; rolledValue: number }
}

export interface ShopItem {
  code: string
  name: string
  slot: string
  rarity: Rarity
  rarityTitle: string
  priceRubies: number
  priceKopecks: number
  previewUrl: string | null
  owned: boolean
}

export interface RubyPack {
  code: string
  title: string
  rubies: number
  kopecks: number
  bonus: number
}

export interface Rules {
  chests: {
    items: {
      tier: ChestTier
      title: string
      /** permille бывает дробным (0,2 ‰ реликвии); bp — базисные пункты, 1/10 000 (v3). */
      chances: { rarity: Rarity; title: string; permille: number; bp?: number }[]
      /** Схема 24.09.2026: удары, вещей внутри, бонус осколков. Старая служба не шлёт. */
      hits?: number
      items?: number
      shards?: { min: number; max: number }
      /** Шанс целой вещи, %: без оплаты и у платящего (26.09.2026). Старая служба не шлёт. */
      wholePct?: number
      wholePayerPct?: number
    }[]
    pityAfter: number
    /** Платящий — PLUS или пакет рубинов за столько дней. */
    payerWindowDays?: number
    /** Легендарная и выше — раз в столько сундуков (v3.1). */
    pityLegendAfter?: number
    duplicateShare?: number
    /** Модель v2: фрагментов на вещь и в слоте по редкости. */
    fragments?: { need: Partial<Record<Rarity, number>>; drop: Partial<Record<Rarity, [number, number]>> }
  }
  packs: {
    /** Модель v3: 7 рубинов за 1 ₽. Старая служба не шлёт. */
    rubiesPerRuble?: number
    rubyKopecks: number
    items: RubyPack[]
    /** Подписка рядом с пакетами: решение у человека одно, и сравнивать надо тут же. */
    plus?: {
      priceKopecks: number
      items: number
      rubiesMin: number
      rubiesMax: number
      sameAs: RubyPack
    }
  }
}

export interface Inventory {
  items: {
    code: string
    name: string
    slot: string
    rarity: Rarity
    rarityTitle: string
    previewUrl: string | null
    source: string
    since: string
  }[]
  count: number
  catalogCount: number
  worthRubies: number
  points: number
  byRarity: Record<string, number>
}

export interface ProgressItem {
  code: string
  title: string
  hours: number
  hoursDone: number
  chest: string | null
  rubies: number
  done: boolean
  claimed: boolean
  /** Служба (d722de3c9): за задание будет вещь навсегда. */
  item?: boolean
  /** Какая вещь выпала — только в ответе на забор. */
  granted?: ItemRef
}

export const RARITY_NAMES: Record<Rarity, string> = {
  COMMON: 'Обычная',
  UNCOMMON: 'Необычная',
  RARE: 'Редкая',
  EPIC: 'Эпическая',
  LEGENDARY: 'Легендарная',
  MYTHIC: 'Мифическая',
  RELIC: 'Невозможная',
}

export const loadRules = () => api<Rules>('/rubies/rules')
export const loadBalance = () => api<RubyBalance>('/rubies/balance')
/**
 * `streak=2`: новая служба не засчитывает этим запросом день серии (его шлёт и
 * лаунчер в трее) — день засчитывает POST /rubies/daily/active. Без метки
 * старые лаунчеры получают прежнее поведение.
 */
export const loadDaily = () => api<DailyStatus>('/rubies/daily?streak=2')
/**
 * «Забрать». С клеткой — сезонная схема: `{ day, row }` (row plus без
 * подписки → 403). Без аргумента — старая ручка «забрать сегодня».
 */
export const claimDaily = (cell?: { day: number; row: 'free' | 'plus' }) =>
  api<DailyClaim>('/rubies/daily/claim', cell ? { method: 'POST', body: JSON.stringify(cell) } : { method: 'POST' })
/** Забрать все открытые клетки сезона разом. */
export const claimAllDaily = () => api<DailyClaim>('/rubies/daily/claim-all', { method: 'POST' })
export const loadChests = () => api<{ pending: PendingChest[]; opened: OpenedChest[] }>('/rubies/chests')
export const loadShop = (slot?: string) =>
  api<{ items: ShopItem[] }>('/rubies/shop' + (slot ? '?slot=' + encodeURIComponent(slot) : ''))
export const loadInventory = () => api<Inventory>('/rubies/inventory')
/**
 * Сундуки за игру (служба 47ea1c7d8): каждый час игры за сутки — обычный
 * сундук, не больше `limit` (3) в сутки. Забранный сундук открывается
 * обычным путём сундуков (chestId).
 */
export interface PlayChests {
  earned: number
  claimed: number
  ready: number
  limit: number
  /** Через сколько секунд игры следующий; null — на сегодня всё. */
  nextInS: number | null
  chest: string
}
export const loadPlayChests = () => api<PlayChests>('/rubies/play-chests')
export const claimPlayChest = () => api<PlayChests & { chestId: string }>('/rubies/play-chests/claim', { method: 'POST' })

export const loadProgress = () => api<{ items: ProgressItem[]; hours: number }>('/rubies/progress')

/**
 * Клиентский сид — вклад игрока в честность броска: сервер обязуется хешем
 * своего сида заранее, а игрок подмешивает свой, и подкрутить результат под
 * конкретного человека становится нечем.
 */
export function openChest(id: string, clientSeed: string) {
  return api<ChestOpenResult>('/rubies/chests/' + encodeURIComponent(id) + '/open', {
    method: 'POST',
    body: JSON.stringify({ clientSeed }),
  })
}

/**
 * Покупка из гардероба: код вещи-расцветки («КОД~имя») и источник `wardrobe` —
 * служба продаёт так любую вещь магазина по базовой цене, а не только витрину
 * дня (без источника отвечала «Этой вещи сейчас нет на витрине»). Служба до
 * этой правки источник не знает («Неизвестная витрина») — тогда прежний запрос.
 */
export const buyCosmetic = (code: string) =>
  api<{ balance: number; granted?: ItemRef[] }>('/rubies/shop/buy', {
    method: 'POST',
    body: JSON.stringify({ code, source: 'wardrobe' }),
  }).catch((e) => {
    if (!/неизвестная витрина/i.test(String((e as { message?: string } | null)?.message ?? e))) throw e
    return api<{ balance: number; granted?: ItemRef[] }>('/rubies/shop/buy', { method: 'POST', body: JSON.stringify({ code }) })
  })

export const buyPack = (pack: string) =>
  api<{ pack: string; rubies: number; kopecks: number; balance: number }>('/rubies/packs/buy', {
    method: 'POST',
    body: JSON.stringify({ pack }),
  })

export const redeemPromo = (code: string) =>
  api<{ code: string; rubies: number; chest: string | null; item: string | null; balance: number }>(
    '/rubies/promo',
    { method: 'POST', body: JSON.stringify({ code }) },
  )

export const claimProgress = (code: string) =>
  api<ProgressItem>('/rubies/progress/' + encodeURIComponent(code) + '/claim', { method: 'POST' })

export const rubles = (kopecks: number) => (kopecks / 100).toLocaleString('ru-RU') + ' ₽'

/** Случайный клиентский сид: игрок его не вводит, но подмешать обязан. */
export const freshClientSeed = () => Math.random().toString(36).slice(2, 12)

// ─────────────────────────────────────────────────────────────────────────────
// Экономика вещей (контракт 23.09.2026:
// ~/Documents/Claude/Работа/Проекты/millida/analysis/2026-09-23_economy-api-contract.md).
// Старые типы и вызовы выше не трогаем: ими пользуются трек входа и гардероб.
// Деньги — целые рубины, время — ISO UTC, смена дня — 00:00 МСК.
// ─────────────────────────────────────────────────────────────────────────────

/** Вещь каталога так, как её отдают ручки экономики. */
export interface ItemRef {
  code: string
  name: string
  slot: string
  rarity: Rarity
  /** PNG 160×160 из каталога косметики. */
  preview: string | null
  /** Расцветка (v3): что именно выдано или лежит в награде. */
  variant?: string
  color?: string
  /** v3.1: цвет базовой расцветки — превью перекрашивается из него в color. */
  tintFrom?: string
}

export type Channel = 'FREE' | 'QUEST' | 'ACHIEVEMENT' | 'HOURS' | 'SEASON' | 'SHOP' | 'PLUS_MONTH' | 'WELCOME' | 'LEGACY'

export interface ShopCard {
  item: ItemRef
  price: number
  basePrice: number
  discountPct: number
  owned: boolean
  /** Когда вещь уходит с витрины: пишем датой, без отсчёта. */
  leavesAt: string
  /** Начатая вещь: «7/20» и сколько рубинов фрагменты уже сняли с цены (не больше половины). */
  fragments?: { have: number; need: number; off: number }
  /** Цена с PLUS: служба шлёт её только тем, у кого подписки нет. */
  plusPrice?: number
}

export type ShopSource = 'day' | 'deal' | 'featured' | 'forYou' | 'night' | 'bundle' | 'wardrobe'

export interface ShopBundle {
  id: string
  title: string
  items: ShopCard[]
  /** С учётом уже купленного. */
  price: number
  fullPrice: number
  leavesAt: string
}

export interface XrayOffer {
  id: string
  tier: 'RARE' | 'EPIC'
  /** Вещь внутри видна до оплаты. */
  item: ItemRef
  price: number
  expiresAt: string
  /** Когда появится следующий кейс, если этот уже куплен. */
  nextAt: string | null
}

export interface MonthOffer {
  code: string
  title: string
  rubies: number
  kopecks: number
  oneTime?: boolean
  endsAt: string
}

export interface ShopPack {
  code: string
  title: string
  rubies: number
  kopecks: number
  /** Разовый пакет («Стартовый набор», code 'starter'): служба отдаёт его первым, пока не было оплат. */
  oneTime?: boolean
}

/**
 * Бесплатный подарок дня (правка владельца 23.09.2026: «раз в день меняется —
 * чтобы был смысл каждый день заходить, получать бесплатно и видеть платное»).
 */
export interface ShopGift {
  kind: 'RUBIES' | 'SHARDS' | 'ITEM'
  amount?: number
  item?: ItemRef
  claimed: boolean
  /** Когда появится новый: пишем датой, без отсчёта. */
  refreshAt: string
}

export interface ShopDay {
  balance: number
  shards: number
  plus: boolean
  day: { featured: ShopCard | null; deal: ShopCard | null; items: ShopCard[]; forYou: ShopCard[]; refreshAt: string }
  bundle: ShopBundle | null
  nightMarket: { endsAt: string; cards: ShopCard[] } | null
  xray: XrayOffer | null
  packs: ShopPack[]
  /** Предложение месяца (служба 7e81279a7): разовый пакет до конца месяца МСК; null — куплено или нет. */
  monthOffer?: MonthOffer | null
  wishlist: string[]
  /** Старая служба поля не шлёт — плитки подарка тогда нет. */
  gift?: ShopGift | null
  /** Уровень подписки (магазин v2, 06.10.2026) и её скидка на всё за рубины. */
  plusTier?: ShopTier
  plusPct?: number
}

/** Уровень подписки: нет / PLUS / Diamond. */
export type ShopTier = 'PLUS' | 'DIAMOND' | null

/** Скидка подписки на вещи, наборы и ящики: зеркало PLUS_ITEM_DISCOUNT_PCT службы. */
export const PLUS_ITEM_PCT = 10
export const DIAMOND_ITEM_PCT = 15
export const tierPct = (tier: ShopTier | undefined): number => (tier === 'DIAMOND' ? DIAMOND_ITEM_PCT : tier === 'PLUS' ? PLUS_ITEM_PCT : 0)
/** «С PLUS»: цена без подписки минус скидка PLUS, до десятка рубинов (как у службы). */
export const plusOf = (price: number): number => Math.max(10, Math.round((price * (100 - PLUS_ITEM_PCT)) / 100 / 10) * 10)

/** Прогресс вещи фрагментами и цена докупки остатка в рубинах. Старая служба topUp не шлёт. */
export interface FragmentProgress {
  have: number
  need: number
  topUp?: number
}

export interface FragmentCard extends FragmentProgress {
  item: ItemRef
}

export interface Workshop {
  shards: number
  cap: number
  /** Дневной лимит осколков из сундуков, подарка и фрагментов (сутки МСК). Старая служба не шлёт. */
  today?: { earned: number; limit: number; resetsAt: string }
  /** Начатые вещи: фрагменты копятся до need - 1, остаток докупается за рубины (topUp). */
  fragments?: FragmentCard[]
  workshop: { items: { item: ItemRef; cost: number; owned: boolean }[]; rotatesAt: string }
}

export interface WeeklyParcel {
  hours: number
  need: number
  ready: boolean
  choices: ItemRef[] | null
  claimedAt: string | null
  resetsAt: string
}

export interface Achievement {
  code: string
  title: string
  points: number
  done: boolean
  progress?: number
  target?: number
  /**
   * Награда v2 (правка владельца 23.09.2026, 21:54: «шмотки ни за что — бред»):
   * мелочь — осколками, вехи — вещью, эксклюзив — только за трудное.
   */
  reward?: { kind: 'SHARDS'; amount: number } | { kind: 'ITEM'; item: ItemRef; exclusive?: boolean }
  /** Точка интереса: какой экран лаунчера открывает «Перейти». */
  go?: 'play' | 'servers' | 'friends' | 'builds' | 'mods' | 'skins' | 'hosting'
}

export interface EconomyProgress {
  hours: number
  hourItems: { hours: number; item: ItemRef; owned: boolean; fragments?: FragmentProgress | null }[]
  achievements: Achievement[]
  points: number
  pointItems: { points: number; item: ItemRef; owned: boolean; fragments?: FragmentProgress | null }[]
}

/** Новые поля GET /launcher/plus поверх прежних (PlusStatus). */
export interface PlusEconomy {
  active: boolean
  paidUntil: string | null
  canceled: boolean
  priceKopecks: number
  rubiesOnPay?: number
  shardBoost?: number
  /** Уровень оплаченной подписки (магазин v2). */
  tier?: ShopTier
  /** Тарифы: PLUS и PLUS Diamond (тот же пропуск, награды сразу). */
  offers?: PlusOffer[]
}

export interface PlusOffer {
  tier: 'PLUS' | 'DIAMOND'
  priceKopecks: number
  days: number
}

/** Запасные тарифы, если служба не прислала offers. */
export const DEFAULT_PLUS_OFFERS: PlusOffer[] = [
  { tier: 'PLUS', priceKopecks: 29900, days: 30 },
  { tier: 'DIAMOND', priceKopecks: 53900, days: 30 },
]

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

/** Магазин дня. Тот же адрес, что у старой витрины, но новая форма ответа. */
export const loadShopDay = () => api<ShopDay>('/rubies/shop')
export const buyShopCard = (code: string, source: ShopSource, bundleId?: string) =>
  api<{ balance: number; granted: ItemRef[] }>('/rubies/shop/buy', post({ code, source, bundleId }))
export const claimShopGift = () =>
  api<{ balance: number; shards: number; granted: ShopGift }>('/rubies/shop/gift/claim', { method: 'POST' })
export const wishItem = (code: string, on: boolean) => api<{ wishlist: string[] }>('/rubies/shop/wish', post({ code, on }))
export const buyXray = (id: string) =>
  api<{ balance: number; item: ItemRef; chestId: string }>('/rubies/xray/buy', post({ id }))
export const loadWorkshop = () => api<Workshop>('/rubies/shards')
export const craftItem = (code: string) =>
  api<{ shards: number; item: ItemRef; fragments?: FragmentProgress & { amount: number } }>('/rubies/shards/craft', post({ code }))
export const loadWeekly = () => api<WeeklyParcel>('/rubies/weekly')
export const claimWeekly = (code: string) =>
  api<{ item: ItemRef; fragments?: FragmentProgress & { amount: number } }>('/rubies/weekly/claim', post({ code }))
/** «Докупить фрагменты»: единственный путь собрать начатую вещь. Код - вещь-расцветка. */
export const completeFragments = (code: string) =>
  api<{ balance: number; price: number; granted: ItemRef[] }>('/rubies/fragments/complete', post({ code }))
export const loadEconomyProgress = () => api<EconomyProgress>('/rubies/progress')
export const loadPlusEconomy = () => api<PlusEconomy>('/launcher/plus')

export interface PackQuest {
  code: string
  title: string
  pack: string
  packName: string
  minutes: number
  needMinutes: number
  done: boolean
  claimed: boolean
  item: ItemRef
  owned: boolean
  fragments: FragmentProgress | null
}
export interface TelegramReward {
  available: boolean
  amount: number
  claimed: boolean
  linked: boolean
  botUrl: string
  channelUrl: string
}
export const loadTelegramReward = () => api<TelegramReward>('/rubies/telegram')
export const claimTelegramReward = () =>
  api<TelegramReward & { granted: boolean; balance: number | null }>('/rubies/telegram/claim', { method: 'POST' })

export const loadPackQuests = () => api<{ quests: PackQuest[] }>('/rubies/quests')
export const claimPackQuest = (code: string) =>
  api<{ quest: PackQuest; item: ItemRef | null }>(
    '/rubies/quests/' + encodeURIComponent(code) + '/claim',
    { method: 'POST' },
  )

/**
 * Подарок новичку (26.09.2026): половина фрагментов нимба, остаток докупается
 * за рубины. Повтор ничего не выдаёт. Старая служба ручки не знает — экран без подарка.
 */
export interface WelcomeGift {
  item: ItemRef | null
  claimed: boolean
  granted?: boolean
  equipped?: boolean
  fragments?: FragmentProgress | null
}
export const claimWelcome = () => api<WelcomeGift>('/rubies/welcome/claim', { method: 'POST' })

// ─────────────────────────────────────────────────────────────────────────────
// Наборы и кейсы (02.10.2026, бэкенд: trade-api/launcher/rubies/sets.catalog.ts).
// Набор — образ из вещей одной темы со скидкой; кейс — случайная вещь темы,
// которой у игрока ещё нет, шансы открыты, раз в `pity` открытий — эпическая+.
// ─────────────────────────────────────────────────────────────────────────────

export type SetTheme = 'flame' | 'dark' | 'future' | 'cozy'

export interface SetColorwayView {
  /** '' — у набора одна расцветка. */
  name: string
  /** RRGGBB для кружка-переключателя. */
  color: string | null
  items: { item: ItemRef; price: number; owned: boolean }[]
  fullPrice: number
  /** К оплате: 0 — весь набор уже свой. */
  price: number
  discountPct: number
  /** Сколько вещей уже есть. */
  have: number
  /** Цена с PLUS — только тому, у кого подписки нет. */
  plusPrice?: number
}

export interface SetView {
  id: string
  title: string
  theme: SetTheme
  ofDay: boolean
  colorways: SetColorwayView[]
}

export interface CaseOddsView {
  rarity: Rarity
  /** Проценты ×10 (1000 = 100%). */
  weight: number
  left: number
  total: number
}

export interface CaseView {
  /** flame, dark, future, cozy, wings, pets, emotes, mythic. */
  id: string
  title: string
  /** К оплате этим игроком: скидки дня и подписки уже внутри. */
  price: number
  /** Цена без скидок: зачёркнута, если price меньше. */
  basePrice: number
  /** Цена с PLUS — только тому, у кого подписки нет. */
  plusPrice?: number
  /** Ящик дня: −30% до 00:00 МСК. */
  ofDay: boolean
  /** Цвет сундука и обложки, RRGGBB. */
  color: string
  odds: CaseOddsView[]
  /** Открытий до гарантии (1 — следующее). */
  pityLeft: number
  pity: number
  /** С какой редкости гарантия: эпическая у обычных, легендарная у мифического. */
  pityFrom: Rarity
  /** Сколько вещей темы ещё нет / всего. */
  left: number
  total: number
  /** Три самые дорогие вещи ящика. */
  cover: ItemRef[]
  /** Шанс «вместо вещи — утешительный приз» сейчас, %: 0 на гарантии, 100 когда вещей не осталось. Старая служба не шлёт. */
  missPct?: number
  /** Промах всё равно приносит дешёвую вещь. */
  cheapItem?: boolean
  /** Бонус каждого открытия сверх награды: вид, от и до. */
  bonus?: { kind: 'shards' | 'rubies'; min: number; max: number }[]
  /** Чем платят: рубины (по умолчанию) или осколки («Осколочный»). */
  currency?: 'rubies' | 'shards'
  /** Какие утешительные призы бывают. */
  consolation?: CaseConsolation[]
  /** Названия наборов темы. */
  sets: string[]
  /** Что выпадает в каждом ящике как минимум (служба 90dde4154): «Редкая+ в каждом ящике». */
  guarantee?: { minRarity: Rarity; label: string }
  /** ×10: одно списание за `price` (9 цен), в десятке точно `floor` и выше. null — ×10 у ящика нет. */
  multi?: { count: number; price: number; basePrice: number; floor: Rarity } | null
  /** Бесплатный первый ящик ещё не взят, и этот ящик подходит. */
  freeAvailable?: boolean
}

/** Недавний редкий выпад: бегущая лента под сеткой ящиков. Только ник и вещь. */
export interface CaseDrop {
  nick: string
  item: ItemRef
  caseId: string
  at: string
}

/** Утешительный приз ящика (служба 5edc63884): вид, от и до, шанс от всех открытий, %. */
export interface CaseConsolation {
  kind: 'shards' | 'rubies'
  min: number
  max: number
  chancePct: number
}

export interface CaseContents {
  id: string
  items: { item: ItemRef; owned: boolean; chance: number }[]
  missPct?: number
  consolation?: CaseConsolation[]
}

/**
 * Награда открытия (контракт службы, ветка коллеги): ящик отдаёт несколько
 * наград по очереди — вещь, дешёвая вещь (`cheap`, вместо промаха: вещь и
 * сумма), рубины, осколки. Старая служба шлёт одну — собираем из kind/item.
 */
export interface CaseReward {
  /** fragments — только сундуки бонуса: фрагменты вещи. */
  kind: 'item' | 'cheap' | 'rubies' | 'shards' | 'fragments'
  item?: ItemRef
  amount?: number
  /** Фрагменты: сколько собрано из скольких. */
  frag?: { have: number; need: number }
  /** Вещь уже была — пришла осколками/рубинами. */
  dup?: boolean
  rarityName?: string
}

export interface CaseOpened {
  balance: number
  /** Сколько списано (скидки дня и подписки внутри). */
  price?: number
  /** item — вещь; shards и rubies — утешительный приз; cheap — дешёвая вещь вместо промаха. */
  kind?: 'item' | 'cheap' | 'shards' | 'rubies'
  /** Все награды открытия по порядку (первая — главная). */
  rewards?: CaseReward[]
  /** Для shards и rubies: сколько выдано. */
  amount?: number
  /** Для shards: сколько осколков теперь на счёте. */
  shards?: number
  /** Для shards: упёрлись в потолок — остаток выдан рубинами. */
  rubies?: number
  /** Вещь — только при kind 'item'. */
  item?: ItemRef
  rarityName?: string
  top: boolean
  pityLeft: number
  /** Сколько ящиков открыто этим запросом: 1 или 10. */
  count?: number
  /** Каждый ящик отдельно: у ×10 десять, у одиночного один. Старая служба не шлёт. */
  opens?: CaseOpenView[]
  /** Лучшая редкость среди выпавших вещей. */
  best?: Rarity
  /** ×10: последняя карта поднята до гарантии десятки. */
  multiFloorUsed?: boolean
}

/** Один ящик из ответа открытия: награды по порядку, главная редкость, сбросил ли счётчик гарантии. */
export interface CaseOpenView {
  rewards: CaseReward[]
  kind: 'item' | 'cheap' | 'rubies' | 'shards'
  rarity?: Rarity
  top: boolean
}

export const loadSets = () => api<{ sets: SetView[]; refreshAt: string; plusTier?: ShopTier }>('/rubies/sets')
/** `expect` — цена, которую видел игрок: изменилась — служба откажет, и магазин обновится. */
export const buySet = (setId: string, colorway: string, expect: number) =>
  api<{ balance: number; price: number; granted: ItemRef[] }>('/rubies/sets/buy', post({ setId, colorway, expect }))
export const loadCases = () => api<{ cases: CaseView[]; drops?: CaseDrop[]; refreshAt?: string; ofDayPct?: number }>('/rubies/cases')
export const loadCaseContents = (id: string) => api<CaseContents>('/rubies/cases/' + encodeURIComponent(id))
/**
 * `requestId` — новый на каждое открытие: повтор запроса не спишет рубины дважды.
 * `count: 10` — десять ящиков одним списанием; `free` — бесплатный первый ящик.
 */
export const openCase = (caseId: string, requestId: string, opt: { count?: 1 | 10; free?: boolean } = {}) =>
  api<CaseOpened>(
    '/rubies/cases/open',
    post({ caseId, requestId, ...(opt.count === 10 ? { count: 10 } : {}), ...(opt.free ? { free: true } : {}) }),
  )
/** Ящики ответа по одному: из `opens`, иначе один ящик из старых плоских полей. */
export function opensOf(res: CaseOpened): CaseOpenView[] {
  if (res.opens && res.opens.length) return res.opens
  const rewards = rewardsOf(res)
  const main = rewards[0]
  return [{ rewards, kind: (res.kind ?? 'item') as CaseOpenView['kind'], rarity: main?.item?.rarity, top: res.top }]
}
/** Награды открытия: из `rewards`, иначе из одного ответа старой службы. */
export function rewardsOf(res: CaseOpened): CaseReward[] {
  if (res.rewards && res.rewards.length) return res.rewards
  const kind = res.kind ?? 'item'
  if (kind === 'item' || kind === 'cheap') return res.item ? [{ kind, item: res.item, amount: res.amount }] : []
  return [{ kind, amount: res.amount ?? 0 }]
}

export const newRequestId = (): string => {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  return c && 'randomUUID' in c ? c.randomUUID().replace(/-/g, '') : Math.random().toString(16).slice(2) + Date.now().toString(16)
}
