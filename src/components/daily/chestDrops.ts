import type { ChestDrop, ChestOpenResult, ChestTier, Rarity } from '../../lib/rubies'

/**
 * Что лежит в сундуке и как его открывают (схема 24.09.2026, документ
 * analysis/2026-09-24_сундуки-и-редкость.md). Числа — зеркало CHEST_DROPS и
 * CHEST_ODDS службы (millida-services, rubies.catalog.ts): служба присылает
 * свои в ответе открытия и в /rubies/rules, здесь — запас для старой службы
 * и для демо.
 */

export const TIER_ORDER: ChestTier[] = ['COMMON', 'RARE', 'EPIC', 'LEGEND']

export const RARITY_ORDER: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'RELIC']

/*
 * ЕДИНАЯ ТАБЛИЦА ВЫПАДЕНИЯ (модель v3.1, решение владельца 24.09.2026, 19:37;
 * ресёрч analysis/2026-09-24_экономика-сундуков-ресерч.md). Зеркало CHEST_CONFIG
 * службы (millida-services, rubies.catalog.ts). Все числа сундука — здесь:
 * поменять шансы = поменять эту таблицу, без рефакторинга.
 *
 * Сундук — это фрагменты, осколки и рубины. Целой вещи без оплаты нет, у
 * платящего (PLUS или пакет рубинов за 30 дней) — 6–12 %. Фрагменты доводят
 * вещь до need − 1, собирает её только «Докупить фрагменты» за рубины.
 */
const RANK_ODDS: Record<Rarity, number> = { COMMON: 4200, UNCOMMON: 2600, RARE: 1600, EPIC: 900, LEGENDARY: 450, MYTHIC: 200, RELIC: 50 }

export const CHEST_CONFIG = {
  /** Шанс ранга, базисные пункты (1/10 000). Одна строка на все сундуки. */
  odds: { COMMON: RANK_ODDS, RARE: RANK_ODDS, EPIC: RANK_ODDS, LEGEND: RANK_ODDS } as Record<ChestTier, Record<Rarity, number>>,
  /** Удары, слоты фрагментов, бонус осколков, множитель кучи, горсть рубинов (%), целая вещь (bp): без оплаты и у платящего. */
  drops: {
    COMMON: { hits: 3, items: 1, shards: [5, 10], pile: 1, wholeBp: 0, wholePayerBp: 600 },
    RARE: { hits: 4, items: 1, shards: [10, 20], pile: 1.5, rubies: { pct: 10, amount: [15, 30] }, wholeBp: 0, wholePayerBp: 800 },
    EPIC: { hits: 5, items: 2, shards: [25, 40], pile: 2, rubies: { pct: 20, amount: [30, 60] }, wholeBp: 0, wholePayerBp: 1000 },
    LEGEND: { hits: 5, items: 3, shards: [60, 90], pile: 3, rubies: { pct: 35, amount: [60, 120] }, wholeBp: 0, wholePayerBp: 1200 },
  } as Record<
    ChestTier,
    {
      hits: number
      items: number
      shards: [number, number]
      pile: number
      rubies?: { pct: number; amount: [number, number] }
      wholeBp: number
      wholePayerBp: number
    }
  >,
  /** Платящий — PLUS сейчас или пакет рубинов за столько последних дней. */
  payerWindowDays: 30,
  fragments: {
    /** Фрагментов на сборку вещи. */
    need: { COMMON: 15, UNCOMMON: 25, RARE: 40, EPIC: 70, LEGENDARY: 120, MYTHIC: 200, RELIC: 350 } as Record<Rarity, number>,
    /** Фрагментов в слоте обычного сундука; у старших — × pile. */
    drop: {
      COMMON: [3, 5],
      UNCOMMON: [4, 6],
      RARE: [5, 8],
      EPIC: [6, 10],
      LEGENDARY: [8, 13],
      MYTHIC: [10, 16],
      RELIC: [12, 20],
    } as Record<Rarity, [number, number]>,
    /** Лишний фрагмент — столько осколков. */
    toShards: { COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 5, LEGENDARY: 8, MYTHIC: 12, RELIC: 20 } as Record<Rarity, number>,
  },
  /** Гарантия: эпическая и выше — раз в 50 сундуков, легендарная и выше — раз в 150. */
  pityAfter: 50,
  pityLegendAfter: 150,
}

/** Прежние имена — срезы CHEST_CONFIG. */
export const CHEST_DROPS = CHEST_CONFIG.drops
export const CHEST_ODDS = CHEST_CONFIG.odds
export const FRAGMENTS_NEED = CHEST_CONFIG.fragments.need
export const FRAGMENT_DROP = CHEST_CONFIG.fragments.drop
export const FRAGMENT_TO_SHARDS = CHEST_CONFIG.fragments.toShards
export const ODDS_TOTAL = 10_000

/** Бесплатно вещь не собирается: фрагменты не выше need − 1 (зеркало fragmentCap службы). */
export const fragmentCap = (r: Rarity) => Math.max(0, FRAGMENTS_NEED[r] - 1)

/** База цены докупки по рангу, рубинов (зеркало FRAGMENT_TOPUP_BASE службы). */
const TOPUP_BASE: Record<Rarity, number> = { COMMON: 150, UNCOMMON: 350, RARE: 700, EPIC: 1400, LEGENDARY: 2800, MYTHIC: 5600, RELIC: 11200 }

/** Докупить недостающие фрагменты: база × (need − have) / need, вверх до десятка, не меньше 10. */
export const fragmentTopUp = (r: Rarity, have: number) => {
  const need = FRAGMENTS_NEED[r]
  const missing = need - Math.min(Math.max(0, have), fragmentCap(r))
  return Math.max(10, Math.ceil((TOPUP_BASE[r] * missing) / need / 10) * 10)
}

/** Шанс в базисных пунктах → «4,5 %», «0,02 %». */
export const pctOfBp = (bp: number) =>
  (bp / 100).toLocaleString('ru-RU', { maximumFractionDigits: bp < 10 ? 2 : 1 }) + ' %'

/** Строка шансов службы → базисные пункты: новая шлёт bp, старая — промилле. */
export const bpOf = (c: { permille: number; bp?: number }) => c.bp ?? Math.round(c.permille * 10)

/** Осколки: потолок кошелька и дневной лимит из сундуков, подарка и фрагментов. */
export const SHARD_CAP = 1500
export const SHARD_DAILY_LIMIT = 100
export const SHARD_DAILY_LIMIT_PLUS = 150

/** Мастерская: цена в осколках. Эпических, легендарных и мифических за осколки нет. */
export const WORKSHOP_COST: Partial<Record<Rarity, number>> = { COMMON: 200, UNCOMMON: 450, RARE: 1000 }

/**
 * PLUS = мощный пропуск (v3): за 28 дней 880 рубинов в клетках, сундуки
 * 3 редких + 5 эпических + легендарный, фрагменты и осколки; вещей PLUS не
 * даёт. Рубинов подписчику за 30 дней — не больше 2 100 (299 ₽ × 7).
 */
export const PLUS_PASS = {
  chests: { RARE: 3, EPIC: 5, LEGEND: 1 } as Partial<Record<ChestTier, number>>,
  rubies: 880,
  rubiesCap: 2100,
  shardBoost: 1.5,
}

/** Бесплатные рубины: до 500 в месяц (трек 290 + редкие горсти из сундуков). */
export const FREE_RUBIES_MONTH_MAX = 500

/** Фрагменты снижают цену вещи в магазине не больше чем наполовину. */
export const FRAGMENT_PRICE_SHARE_MAX = 0.5
export const fragmentOff = (price: number, have: number, need: number) =>
  price <= 0 || need <= 0 || have <= 0 ? 0 : Math.floor((price * (Math.min(have, need) / need) * FRAGMENT_PRICE_SHARE_MAX) / 10) * 10

export const PITY_AFTER = CHEST_CONFIG.pityAfter
export const PITY_LEGEND_AFTER = CHEST_CONFIG.pityLegendAfter

export const RARITY_NAME: Record<Rarity, string> = {
  COMMON: 'Обычная',
  UNCOMMON: 'Необычная',
  RARE: 'Редкая',
  EPIC: 'Эпическая',
  LEGENDARY: 'Легендарная',
  MYTHIC: 'Мифическая',
  RELIC: 'Невозможная',
}

export const isTier = (t: unknown): t is ChestTier => typeof t === 'string' && t in CHEST_DROPS

/** Сундук, как его показывает открытие: удары и награды по порядку. */
export interface OpenedView {
  chestId: string
  tier: ChestTier
  hits: number
  drops: ChestDrop[]
  /** Лучшая редкость внутри: до неё разгорается свет в щелях. */
  top: Rarity
  /** Сундуков до гарантии после этого открытия (v3.1). Старая служба не шлёт. */
  pityLeft?: { epic: number; legend: number }
}

const rank = (r: Rarity) => RARITY_ORDER.indexOf(r)

/** Строка с рангом: вещь или фрагменты (не осколки и не рубины). */
export const hasRarity = (d: ChestDrop): d is Extract<ChestDrop, { kind: 'ITEM' | 'FRAGMENTS' }> =>
  d.kind === 'ITEM' || d.kind === 'FRAGMENTS'

export function topOf(drops: ChestDrop[]): Rarity {
  let best: Rarity = 'COMMON'
  for (const d of drops) if (hasRarity(d) && rank(d.rarity) > rank(best)) best = d.rarity
  return best
}

/**
 * Ответ службы → вид открытия. Новая служба шлёт `hits` и `drops`; старая
 * (прод на 24.09.2026) — одну вещь, повтор рубинами или осколками. Лаунчер
 * выходит раньше службы, поэтому понимает оба.
 */
export function viewOf(r: ChestOpenResult): OpenedView {
  const tier: ChestTier = isTier(r.tier) ? r.tier : 'COMMON'
  let drops: ChestDrop[] = Array.isArray(r.drops) ? r.drops.filter(Boolean) : []
  if (!drops.length) {
    drops = [
      {
        kind: 'ITEM',
        rarity: r.rarity || 'COMMON',
        item: r.item,
        duplicate: !!r.duplicate,
        shards: r.duplicate ? r.shards || 0 : 0,
        rubies: r.duplicate ? r.rubies || 0 : 0,
      },
    ]
  }
  const hits = Math.max(1, Math.min(6, Number(r.hits) || CHEST_DROPS[tier].hits))
  return { chestId: r.chestId, tier, hits, drops, top: topOf(drops), pityLeft: r.pityLeft }
}

/* ── Демо: бросок на клиенте по тем же таблицам (только dev) ── */

type DemoItem = { code: string; name: string; slot: string; previewUrl: string | null; variant?: { name: string; color: string; from?: string } }
const DEMO_ITEMS: Record<Rarity, DemoItem[]> = {
  // v3: выпадает всё, флагманы тоже; верх держат шансы.
  COMMON: [
    { code: 'BAKE_DAY', name: 'Пекарский день', slot: 'HAT', previewUrl: null },
    { code: 'FOX_EARS', name: 'Лисьи ушки', slot: 'EARS', previewUrl: null },
  ],
  UNCOMMON: [{ code: 'KING_CROWN', name: 'Королевская корона', slot: 'HAT', previewUrl: 'https://cdn.millida.net/cosmetics/previews/KING_CROWN.5d97038503.png' }],
  RARE: [{ code: 'HEART_HALO', name: 'Сердечный нимб', slot: 'HAT', previewUrl: 'https://cdn.millida.net/cosmetics/previews/HEART_HALO.ab5e76b913.png' }],
  EPIC: [{ code: 'ANIME_LOVE', name: 'Аниме-любовь', slot: 'EMOTE', previewUrl: 'https://cdn.millida.net/cosmetics/previews/ANIME_LOVE.423952871d.png' }],
  LEGENDARY: [
    { code: 'ASTRAL_WINGS~gold', name: 'Астральные крылья солнца', slot: 'WINGS', previewUrl: 'https://cdn.millida.net/cosmetics/previews/ASTRAL_WINGS.f9fd93059b.png', variant: { name: 'gold', color: 'f5c542', from: '8a55d8' } },
  ],
  MYTHIC: [
    { code: 'ASTRAL_WINGS~rainbow', name: 'Астральные крылья радуги', slot: 'WINGS', previewUrl: 'https://cdn.millida.net/cosmetics/previews/ASTRAL_WINGS.f9fd93059b.png', variant: { name: 'rainbow', color: 'e04a4a' } },
  ],
  RELIC: [
    { code: 'VALKYRIE_WINGS~gold', name: 'Крылья валькирии солнца', slot: 'WINGS', previewUrl: null, variant: { name: 'gold', color: '111111' } },
  ],
}

/** Флагманские слоты: никогда бесплатно (зеркало FLAGSHIP_SLOTS службы). */
export const FLAGSHIP_SLOTS = ['WINGS', 'PET', 'EFFECT', 'AURA', 'CAPE']

/** Демо-прогресс фрагментов: что у игрока уже накоплено (по коду вещи). */
const DEMO_HAVE: Record<string, number> = { HEART_HALO: 22, ANIME_LOVE: 31, KING_CROWN: 9 }

function rollRarity(tier: ChestTier, v: number): Rarity {
  let cur = 0
  for (const r of RARITY_ORDER) {
    cur += CHEST_ODDS[tier][r]
    if (v * ODDS_TOTAL < cur) return r
  }
  return 'EPIC'
}

/** Демо-счётчики гарантии: живут в localStorage, как счётчики службы в базе. */
function demoPity(drops: ChestDrop[]): { epic: number; legend: number } {
  let c = { epic: 37, legend: 112 }
  try {
    c = { ...c, ...JSON.parse(localStorage.getItem('m-demo-pity') || '{}') }
  } catch {
    /* пусто */
  }
  const best = rank(topOf(drops))
  c.epic = best >= rank('EPIC') ? 0 : c.epic + 1
  c.legend = best >= rank('LEGENDARY') ? 0 : c.legend + 1
  try {
    localStorage.setItem('m-demo-pity', JSON.stringify(c))
  } catch {
    /* пусто */
  }
  return { epic: Math.max(1, PITY_AFTER - c.epic), legend: Math.max(1, PITY_LEGEND_AFTER - c.legend) }
}

/**
 * Демо-открытие: ответ в форме новой службы. `force` — редкость первой вещи
 * (для скриншотов эпического и легендарного тизера: `&chest-top=EPIC`).
 */
export function demoOpen(id: string, tier: ChestTier, force?: Rarity | null, whole = false): ChestOpenResult {
  const def = CHEST_DROPS[tier]
  const rnd = Math.random
  const bonus = def.shards[0] + Math.floor(rnd() * (def.shards[1] - def.shards[0] + 1))
  const drops: ChestDrop[] = bonus > 0 ? [{ kind: 'SHARDS', amount: bonus }] : []
  const progress = new Map<string, number>()
  let extra = 0
  for (let i = 0; i < def.items; i++) {
    const rarity = i === 0 && force ? force : rollRarity(tier, rnd())
    const pool = DEMO_ITEMS[rarity]
    const picked = pool[Math.floor(rnd() * pool.length)]!
    const { variant, ...item } = picked
    // Целая вещь — только первым слотом, демо бросает как бесплатный игрок; `&chest-whole=1` — для скриншота.
    if (i === 0 && (whole || rnd() * ODDS_TOTAL < def.wholeBp)) {
      drops.push({ kind: 'ITEM', rarity, item, variant: variant ?? null, duplicate: false, shards: 0 })
      continue
    }
    const [lo, hi] = FRAGMENT_DROP[rarity]
    const amount = Math.max(1, Math.round((lo + Math.floor(rnd() * (hi - lo + 1))) * def.pile))
    const need = FRAGMENTS_NEED[rarity]
    const before = progress.get(item.code) ?? DEMO_HAVE[item.code] ?? 0
    const total = before + amount
    const have = Math.max(before, Math.min(total, fragmentCap(rarity)))
    progress.set(item.code, have)
    const shards = (total - have) * FRAGMENT_TO_SHARDS[rarity]
    extra += shards
    drops.push({
      kind: 'FRAGMENTS',
      rarity,
      item,
      variant: variant ?? null,
      amount,
      have,
      need,
      completed: false,
      shards,
      topUp: fragmentTopUp(rarity, have),
    })
  }
  const r = CHEST_DROPS[tier].rubies
  if (r && rnd() * 100 < r.pct) drops.splice(1, 0, { kind: 'RUBIES', amount: r.amount[0] + Math.floor(rnd() * (r.amount[1] - r.amount[0] + 1)) })
  const pityLeft = demoPity(drops)
  const first = drops.find((d) => d.kind === 'FRAGMENTS' || d.kind === 'ITEM') as Extract<ChestDrop, { kind: 'FRAGMENTS' | 'ITEM' }>
  return {
    chestId: id,
    tier,
    rarity: first.rarity,
    item: first.item,
    duplicate: first.kind === 'FRAGMENTS' ? !first.completed : false,
    rubies: 0,
    shards: bonus + extra,
    pity: false,
    pityLeft,
    hits: def.hits,
    drops,
    proof: { serverSeedHash: 'demo', clientSeed: 'demo', nonce: 1, rolledValue: 0.5 },
  }
}
