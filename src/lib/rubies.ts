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
    }[]
    pityAfter: number
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
export const loadDaily = () => api<DailyStatus>('/rubies/daily')
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

/** Покупка из гардероба: код вещи-расцветки («КОД~имя») — служба v3.1 знает его сама. */
export const buyCosmetic = (code: string) =>
  api<{ code: string; name: string; spent: number; balance: number }>('/rubies/shop/buy', {
    method: 'POST',
    body: JSON.stringify({ code }),
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

export type Channel = 'FREE' | 'QUEST' | 'ACHIEVEMENT' | 'HOURS' | 'SEASON' | 'SHOP' | 'PLUS_MONTH'

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
}

export type ShopSource = 'day' | 'deal' | 'featured' | 'forYou' | 'night' | 'bundle'

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

export interface ShopPack {
  code: string
  title: string
  rubies: number
  kopecks: number
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
  wishlist: string[]
  /** Старая служба поля не шлёт — плитки подарка тогда нет. */
  gift?: ShopGift | null
}

export interface Workshop {
  shards: number
  cap: number
  /** Дневной лимит осколков из сундуков, подарка и фрагментов (сутки МСК). Старая служба не шлёт. */
  today?: { earned: number; limit: number; resetsAt: string }
  /** Начатые вещи: фрагменты копятся до need, потом вещь выдаётся сама. */
  fragments?: { item: ItemRef; have: number; need: number }[]
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
  hourItems: { hours: number; item: ItemRef; owned: boolean }[]
  achievements: Achievement[]
  points: number
  pointItems: { points: number; item: ItemRef; owned: boolean }[]
}

/** Новые поля GET /launcher/plus поверх прежних (PlusStatus). */
export interface PlusEconomy {
  active: boolean
  paidUntil: string | null
  canceled: boolean
  priceKopecks: number
  month?: { items: ItemRef[]; claimed: boolean }
  rubiesOnPay?: number
  shardBoost?: number
  migration?: { eligible: boolean; picks: number; picked: string[]; pool: ItemRef[] } | null
}

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
export const craftItem = (code: string) => api<{ shards: number; item: ItemRef }>('/rubies/shards/craft', post({ code }))
export const loadWeekly = () => api<WeeklyParcel>('/rubies/weekly')
export const claimWeekly = (code: string) => api<{ item: ItemRef }>('/rubies/weekly/claim', post({ code }))
export const loadEconomyProgress = () => api<EconomyProgress>('/rubies/progress')
export const loadPlusEconomy = () => api<PlusEconomy>('/launcher/plus')
export const claimPlusMonth = () => api<{ items: ItemRef[] }>('/launcher/plus/month/claim', { method: 'POST' })
export const pickPlusMigration = (codes: string[]) =>
  api<{ granted: ItemRef[] }>('/launcher/plus/migration/pick', post({ codes }))

/**
 * Подарок новичку (модель предметов v2, решение владельца 24.09.2026, 18:23):
 * единственная бесплатная вещь — нимб при первом запуске, навсегда и сразу надет.
 * Повтор ничего не выдаёт. Старая служба ручки не знает — экран без подарка.
 */
export interface WelcomeGift {
  item: ItemRef | null
  claimed: boolean
  granted?: boolean
  equipped?: boolean
}
export const claimWelcome = () => api<WelcomeGift>('/rubies/welcome/claim', { method: 'POST' })
