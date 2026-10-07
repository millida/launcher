/**
 * ДЕМО НАБОРОВ И КЕЙСОВ (?preview=user, только dev; бэкенд ещё не на проде).
 *
 * Состав наборов — копия SET_DEFS бэкенда (trade-api/launcher/rubies/sets.catalog.ts),
 * вещи, расцветки, имена и превью — из живого каталога косметики, цены по рангу
 * (как у витрины в demoShop.ts). Выдуман только «мой» кошелёк и что уже куплено.
 * Покупки живут в памяти вкладки.
 */
import { plusOf, tierPct, type CaseContents, type CaseReward, type CaseDrop, type CaseOpened, type CaseOpenView, type CaseView, type ItemRef, type Rarity, type SetColorwayView, type SetTheme, type SetView } from '../../lib/rubies'
import { variantCode, variantTitles } from '../../lib/variantNames'
import { RARITY_NAME_SHORT, rarityOfPrice, rarityRank } from './rarity'
import { RANK_PRICE, demoTier, v3Price, variantRank, type DemoCatalogItem } from './demoShop'

interface SetDef {
  id: string
  title: string
  theme: SetTheme
  items: string[]
}

const SET_DEFS: SetDef[] = [
  // Пламя
  { id: 'fire_lord', title: 'Повелитель огня', theme: 'flame', items: ['FIRE_HAIR_REMASTER', 'FIRE_EYES_REMASTER', 'FIRE_ARMOR_REMASTER', 'FIRE_FEET_REMASTER', 'FIRE_WINGS_REMASTER', 'FIRE_SWORD'] },
  { id: 'mixed_fire', title: 'Смешанное пламя', theme: 'flame', items: ['MIXED_FIRE_ARMOR_HELMET', 'MIXED_FIRE_EYES_REMASTER', 'MIXED_FIRE_ARMOR', 'MIXED_FIRE_FEET_REMASTER', 'MIXED_FIRE_WINGS_REMASTER'] },
  { id: 'soul_flame', title: 'Пламя душ', theme: 'flame', items: ['SOUL_FLAME_CROWN', 'SOUL_FLAME_HANDS', 'SOUL_FLAME_SHOES', 'SOUL_FLAME_WINGS', 'SOUL_FLAME_SCYTHE', 'SOUL_FLAME_AURA'] },
  { id: 'white_flame', title: 'Духовное пламя', theme: 'flame', items: ['WHITE_FLAME_FISTS', 'WHITE_FLAME_FEET', 'WHITE_FLAME_WINGS'] },
  { id: 'neon_rgb', title: 'Неон RGB', theme: 'flame', items: ['NEON_RGB_FLAME_CROWN', 'NEON_GLASSES', 'NEON_RGB_ROBE', 'NEON_RGB_PANTS', 'NEON_RGB_FIRE_FISTS', 'NEON_RGB_FIRE_FEET', 'NEON_RGB_WINGS', 'NEON_RGB_FLAME_BATTLE_AXE', 'NEON_RGB_FLAME_AURA'] },
  { id: 'magma', title: 'Магма', theme: 'flame', items: ['MAGMA_ARMOR_HELMET', 'MAGMA_ARMOR', 'MAGMA_HAMMER', 'MAGMA_WINGS'] },
  { id: 'heart', title: 'Влюблённое сердце', theme: 'flame', items: ['HEART_HALO', 'HEART_T_SHIRT', 'HEART_FIRE_FEET', 'HEART_FIRE_WINGS', 'HEART_PARTICLES'] },
  { id: 'lightning', title: 'Повелитель молний', theme: 'flame', items: ['LIGHTNING_SUIT', 'LIGHTNING_HANDS', 'LIGHTNING_SHOES', 'LIGHTNING_CHARGED'] },
  // Тьма
  { id: 'demon_lord', title: 'Демон-повелитель', theme: 'dark', items: ['DEMONIC_OVERLORD_HELMET', 'DEMONIC_OVERLORD_ARMOR', 'DEMONIC_OVERLORD_STAFF', 'DEMONIC_OVERLORD_WINGS', 'DEMONIC_AURA'] },
  { id: 'fallen_angel', title: 'Падший ангел', theme: 'dark', items: ['FALLEN_ANGEL_HELMET', 'FALLEN_ANGEL_ARMOR', 'FALLEN_ANGEL_SWORD', 'FALLEN_ANGEL_WINGS'] },
  { id: 'undead_lord', title: 'Повелитель нежити', theme: 'dark', items: ['UNDEAD_OVERLORD_HEAD', 'UNDEAD_OVERLORD_BODY', 'UNDEAD_SCYTHE'] },
  { id: 'warden', title: 'Странник-страж', theme: 'dark', items: ['WARDEN_WANDERER_HEAD', 'WARDEN_WANDERER_BODY', 'WARDEN_FEELERS'] },
  { id: 'ender', title: 'Сущность Края', theme: 'dark', items: ['ENDER_ENTITY_HEAD', 'ENDER_ENTITY_BODY', 'ENDER_EXCALIBUR', 'ENDER_ARMS', 'ENDER_GLIMMER'] },
  { id: 'gothic_knight', title: 'Готический рыцарь', theme: 'dark', items: ['GOTHIC_KNIGHT_HELMET_1', 'GOTHIC_KNIGHT_ARMOR_SET_1', 'GOTHIC_KNIGHT_BLADE_1', 'GOTHIC_WINGS_ALT'] },
  { id: 'hollow_guard', title: 'Полый страж', theme: 'dark', items: ['GOTHIC_KNIGHT_HELMET_2', 'GOTHIC_KNIGHT_ARMOR_SET_2', 'GOTHIC_KNIGHT_BLADE_2'] },
  { id: 'liminal', title: 'Лиминальный лазутчик', theme: 'dark', items: ['LIMINAL_LURKER_HEAD', 'LIMINAL_LURKER_BODY', 'LIMINAL_LURKER_BABY'] },
  // Будущее
  { id: 'thunder_knight', title: 'Грозовой рыцарь', theme: 'future', items: ['THUNDERBOLT_HELMET', 'THUNDERBOLT_ARMOR', 'THUNDERBOLT_BLADE'] },
  { id: 'sun_spirit', title: 'Дух солнца', theme: 'future', items: ['SUN_SPIRIT_HELMET', 'SUN_SPIRIT_ARMOR', 'SUN_SPIRIT_STAFF'] },
  { id: 'mech', title: 'Боевой мех', theme: 'future', items: ['MECH_HELMET', 'MECH_ARMOR', 'MECH_CANNON', 'MECH_WINGS'] },
  { id: 'hacker', title: 'Хакер', theme: 'future', items: ['HACKER_ARMOR', 'HACKER_SWORD', 'HACKER_WINGS', 'HACKER_AURA'] },
  { id: 'sci_fi', title: 'Космонавт', theme: 'future', items: ['SCI_FI_HELMET', 'SCI_FI_ARMOR', 'SCI_FI_BACKPACK'] },
  { id: 'ice', title: 'Ледяная магия', theme: 'future', items: ['ICE_CROWN', 'ICE_STAFF', 'ICE_SHOES', 'ICE_WINGS', 'ICE_MAGIC'] },
  // Уют
  { id: 'cat', title: 'Котик', theme: 'cozy', items: ['CAT_EARS', 'CAT_NOSE', 'CAT_COSTUME', 'CAT_TAIL'] },
  { id: 'dog', title: 'Пёс', theme: 'cozy', items: ['DOG_EARS', 'DOG_NOSE', 'DOG_ONESIE', 'DOG_BACKPACK'] },
  { id: 'dragon', title: 'Дракончик', theme: 'cozy', items: ['DRAGON_ONESIE', 'DRAGON_BACKPACK', 'DRAGON_WINGS'] },
  { id: 'dancing_dragon', title: 'Танцующий дракон', theme: 'cozy', items: ['DANCING_DRAGON_HEAD', 'DANCING_DRAGON_BODY', 'DANCING_DRAGON_TAIL'] },
  { id: 'summer', title: 'Лето', theme: 'cozy', items: ['SUMMER_SUNHAT', 'SUMMER_CURLS', 'SUMMER_SHADES', 'SUMMER_DRESS'] },
  { id: 'flower', title: 'Цветочная фея', theme: 'cozy', items: ['FLOWER_CROWN', 'FLOWER_IN_HAIR', 'FLOWER_WINGS', 'FLOWER_LEGS'] },
  { id: 'rain', title: 'Дождливый день', theme: 'cozy', items: ['RAIN_JACKET', 'RAIN_BOOTS', 'RAIN_PARTICLES'] },
  { id: 'basketball', title: 'Баскетболист', theme: 'cozy', items: ['BASKETBALL_JERSEY', 'BASKETBALL_SHORTS', 'BASKETBALL_SNEAKERS'] },
  { id: 'anime', title: 'Аниме-самурай', theme: 'cozy', items: ['ANIME_BUNS', 'ANIME_DRESS', 'DOUBLE_KATANA'] },
]

const SET_DISCOUNT_PCT = 20
/** Утешительные призы — зеркало sets.catalog службы (c8151757a): веса 40/25/10 осколками, 15/7/3 рубинами. */
type Prize = { kind: 'shards' | 'rubies'; amount: number; weight: number }
const prizes = (shards: [number, number, number], rubies: [number, number, number]): Prize[] => [
  { kind: 'shards', amount: shards[0], weight: 40 },
  { kind: 'shards', amount: shards[1], weight: 25 },
  { kind: 'shards', amount: shards[2], weight: 10 },
  { kind: 'rubies', amount: rubies[0], weight: 15 },
  { kind: 'rubies', amount: rubies[1], weight: 7 },
  { kind: 'rubies', amount: rubies[2], weight: 3 },
]
const CONSOLATION_490 = prizes([15, 30, 60], [20, 40, 80])
const CONSOLATION_590 = prizes([20, 40, 80], [25, 50, 100])
const CONSOLATION_690 = prizes([20, 40, 80], [30, 60, 120])
const CONSOLATION_1190 = prizes([40, 80, 160], [60, 120, 240])
const CONSOLATION_2490 = prizes([100, 200, 400], [150, 300, 600])
/** Шанс промаха службы, ‰ (miss), и её призы по ящику (90dde4154: у Тьмы, Питомцев и Мифического промаха нет). */
const MISS: Record<string, { miss: number; prizes: Prize[] }> = {
  flame: { miss: 560, prizes: CONSOLATION_690 },
  dark: { miss: 0, prizes: CONSOLATION_1190 },
  future: { miss: 560, prizes: CONSOLATION_690 },
  cozy: { miss: 650, prizes: CONSOLATION_490 },
  wings: { miss: 560, prizes: CONSOLATION_690 },
  pets: { miss: 0, prizes: CONSOLATION_1190 },
  emotes: { miss: 570, prizes: CONSOLATION_590 },
  mythic: { miss: 0, prizes: CONSOLATION_2490 },
  shards: { miss: 150, prizes: prizes([40, 80, 160], [30, 60, 120]) },
}
/** missPct и consolation как у службы: 0 на гарантии, 100 когда вещей не осталось. */
const missView = (id: string, guaranteed: boolean, none: boolean) => {
  const m = MISS[id] ?? MISS.flame!
  const missPct = none ? 100 : guaranteed ? 0 : m.miss / 10
  const sum = m.prizes.reduce((n, p) => n + p.weight, 0)
  const kinds = ['rubies', 'shards'] as const
  const consolation = kinds.map((kind) => {
    const rows = m.prizes.filter((p) => p.kind === kind)
    const w = rows.reduce((n, p) => n + p.weight, 0)
    return { kind, min: Math.min(...rows.map((p) => p.amount)), max: Math.max(...rows.map((p) => p.amount)), chancePct: Math.round(((missPct * w) / sum) * 100) / 100 }
  })
  const bonus = kinds.map((kind) => ({ kind, min: 10, max: kind === 'rubies' ? 50 : 40 }))
  return { missPct, consolation, bonus }
}
const SET_OF_DAY_PCT = 40
const CASE_PITY = 15
/** Ящик дня −15 %, с PLUS не складывается: берётся меньшая из двух цен (служба 90dde4154). */
const CASE_OF_DAY_PCT = 15
/** Бесплатный первый ящик: обычный ящик за рубины не дороже этой цены. */
const FREE_CASE_MAX_PRICE = 690
/** Таблица обычного ящика: ~72% цены возвращается вещами (служба, 62834a66f). */
const STANDARD_ODDS: Partial<Record<Rarity, number>> = { COMMON: 260, UNCOMMON: 285, RARE: 245, EPIC: 135, LEGENDARY: 60, MYTHIC: 15 }
/** Тьма и Питомцы: редкая и выше в каждом ящике. */
const GUARANTEED_RARE_ODDS: Partial<Record<Rarity, number>> = { RARE: 905, EPIC: 72, LEGENDARY: 19, MYTHIC: 4 }
const MULTI_EPIC = { count: 10, payFor: 9, floor: 'EPIC' as Rarity }
interface CaseDef {
  id: string
  title: string
  price: number
  color: string
  odds: Partial<Record<Rarity, number>>
  pity: number
  pityFrom: Rarity
  /** Пол: что выпадает в каждом ящике как минимум. */
  floor: Rarity
  /** ×10 за payFor цен, в десятке точно floor и выше. */
  multi?: { count: number; payFor: number; floor: Rarity }
  /** Какие вещи идут в ящик: тема наборов, слоты или всё подряд. */
  slots?: string[]
}
/** Восемь ящиков и «Осколочный», зеркало CASE_DEFS службы (90dde4154: гарантии Редкая+/Эпическая+, ×10 за 9 цен). */
const CASE_DEFS: CaseDef[] = [
  { id: 'flame', title: 'Пламя', price: 690, color: 'FF6A1A', odds: STANDARD_ODDS, pity: CASE_PITY, pityFrom: 'EPIC', floor: 'COMMON', multi: MULTI_EPIC },
  { id: 'dark', title: 'Тьма', price: 1190, color: '8B3DFF', odds: GUARANTEED_RARE_ODDS, pity: 12, pityFrom: 'EPIC', floor: 'RARE', multi: MULTI_EPIC },
  { id: 'future', title: 'Будущее', price: 690, color: '1FB6FF', odds: STANDARD_ODDS, pity: CASE_PITY, pityFrom: 'EPIC', floor: 'COMMON', multi: MULTI_EPIC },
  { id: 'cozy', title: 'Уют', price: 490, color: '7BD94A', odds: { COMMON: 399, UNCOMMON: 327, RARE: 159, EPIC: 64, LEGENDARY: 36, MYTHIC: 15 }, pity: 30, pityFrom: 'EPIC', floor: 'COMMON' },
  { id: 'wings', title: 'Крылья', price: 690, color: 'F2F5FF', odds: STANDARD_ODDS, pity: CASE_PITY, pityFrom: 'EPIC', floor: 'COMMON', multi: MULTI_EPIC, slots: ['WINGS', 'BACK'] },
  { id: 'pets', title: 'Питомцы', price: 1190, color: 'FFC93D', odds: GUARANTEED_RARE_ODDS, pity: 12, pityFrom: 'EPIC', floor: 'RARE', multi: MULTI_EPIC, slots: ['PET'] },
  { id: 'emotes', title: 'Эмоции', price: 590, color: 'FF5FA8', odds: { COMMON: 275, UNCOMMON: 295, RARE: 290, EPIC: 115, MYTHIC: 25 }, pity: 25, pityFrom: 'EPIC', floor: 'COMMON', multi: { count: 10, payFor: 9, floor: 'RARE' }, slots: ['EMOTE'] },
  { id: 'mythic', title: 'Мифический', price: 2490, color: 'FF2D55', odds: { EPIC: 840, LEGENDARY: 135, MYTHIC: 25 }, pity: 8, pityFrom: 'LEGENDARY', floor: 'EPIC', multi: { count: 10, payFor: 9, floor: 'LEGENDARY' }, slots: ['*'] },
  // За осколки (контракт коллеги: currency 'shards'): всё подряд, цена в осколках.
  { id: 'shards', title: 'Осколочный', price: 500, color: '3DE0C8', odds: STANDARD_ODDS, pity: CASE_PITY, pityFrom: 'EPIC', floor: 'COMMON', slots: ['*'] },
]
/** Подпись гарантии как у службы (guaranteeOf). */
const guaranteeOf = (def: CaseDef) => ({
  minRarity: def.floor,
  label: def.floor === 'RARE' ? 'Редкая+ в каждом ящике' : def.floor === 'EPIC' ? 'Эпическая+ в каждом ящике' : def.id === 'emotes' ? 'Эмоция в каждом ящике' : 'Вещь в каждом ящике',
})
const freeEligible = (def: CaseDef) => def.id !== 'shards' && def.price <= FREE_CASE_MAX_PRICE
/** Только dev: ?casepity=7 — счётчик гарантии уже на 7; ?caserar=LEGENDARY — главная вещь этой редкости (кадры апгрейда). */
function demoParam(k: string): string | null {
  return typeof location !== 'undefined' ? new URLSearchParams(location.search).get(k) : null
}
const DROP_RARITIES: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC']
const isTop = (r: Rarity, from: Rarity = 'EPIC') => rarityRank(r) >= rarityRank(from)
const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10)
const baseOf = (code: string) => code.split('~')[0]!
const fail = (text: string) => Promise.reject(new Error(text))

interface Priced {
  item: ItemRef
  price: number
  /** Имя расцветки ('' — у вещи одна). */
  variantName: string
}

/** Вещь каталога → её вещи-расцветки (v3.1): у каждой свой код, имя, ранг и цена. */
function expand(x: DemoCatalogItem): Priced[] {
  const base: ItemRef = { code: x.id, name: x.name, slot: x.slot, rarity: rarityOfPrice(x.priceRubies || 0), preview: x.preview || null }
  const list = (x.variants || []).filter((v) => v && v.name)
  if (list.length < 2) return [{ item: base, price: RANK_PRICE[base.rarity] || v3Price(x.priceRubies || 0), variantName: '' }]
  const titles = variantTitles(x.name, list.map((v) => v.name))
  return list.map((v, i) => {
    const rarity = variantRank(base.rarity, v.name.toLowerCase(), i)
    const item: ItemRef = {
      ...base,
      code: variantCode(x.id, v.name),
      name: titles[i] || x.name,
      rarity,
      variant: v.name,
      color: (v.color || '').replace('#', ''),
      // Своё превью расцветки точнее любой перекраски (как ruby-items.service службы).
      ...(v.preview ? { preview: v.preview } : i > 0 && list[0]!.color ? { tintFrom: list[0]!.color.replace('#', '') } : {}),
    }
    return { item, price: RANK_PRICE[rarity] || RANK_PRICE[base.rarity], variantName: v.name }
  })
}

export function demoSets(deps: {
  catalog: () => Promise<DemoCatalogItem[]>
  wallet: { balance: number }
  /** Базовые коды вещей, которые уже «куплены» демо-игроком (все расцветки). */
  ownedBases: () => Promise<string[]>
}) {
  /** Купленное в демо: коды вещей-расцветок. */
  const bought = new Set<string>()
  const pity = new Map<string, number>()
  /** Бесплатный первый ящик уже взят. */
  let freeTaken = false
  const sinceOf = (id: string) => pity.get(id) ?? Math.min(Number(demoParam('casepity')) || 0, (CASE_DEFS.find((d) => d.id === id)?.pity ?? 1) - 1)

  interface ResolvedSet {
    def: SetDef
    colorways: { name: string; color: string | null; items: Priced[] }[]
  }
  interface Built {
    byBase: Map<string, Priced[]>
    resolved: ResolvedSet[]
    bases: Set<string>
  }
  let built: Promise<Built> | null = null

  const build = (): Promise<Built> => {
    if (!built)
      built = (async () => {
        const [cat, owned] = await Promise.all([deps.catalog(), deps.ownedBases()])
        const byBase = new Map<string, Priced[]>()
        for (const x of cat) {
          if (x.access !== 'PURCHASE' || !(x.priceRubies || 0)) continue
          byBase.set(x.id, expand(x))
        }
        const resolved: ResolvedSet[] = []
        for (const def of SET_DEFS) {
          const parts = def.items.map((c) => byBase.get(c)).filter((l): l is Priced[] => !!l?.length)
          if (parts.length < 3) continue
          const multi = parts.filter((l) => l.length > 1)
          const names = multi.length
            ? multi[0]!.map((p) => p.variantName).filter((n) => n && multi.every((l) => l.some((p) => p.variantName === n)))
            : []
          const pick = (l: Priced[], n: string) => (l.length > 1 ? l.find((p) => p.variantName === n) : undefined) ?? l[0]!
          resolved.push({
            def,
            colorways: (names.length ? names : ['']).map((name) => {
              const items = parts.map((l) => pick(l, name))
              const colored = name ? items.find((p) => p.variantName === name && p.item.color) : undefined
              return { name, color: colored?.item.color || null, items }
            }),
          })
        }
        // Чтобы в гардеробе и в магазине было что показать: у двух наборов часть вещей уже есть, один собран.
        const seed = (n: number, count: number) => {
          const r = resolved[n]
          if (r) r.colorways[0]!.items.slice(0, count).forEach((p) => bought.add(p.item.code))
        }
        seed(1, 2)
        seed(3, 2)
        seed(9, 99)
        return { byBase, resolved, bases: new Set(owned) }
      })()
    built.catch(() => (built = null))
    return built
  }

  const isOwned = (b: Built, code: string) => bought.has(code) || b.bases.has(baseOf(code))

  const dayKey = () => Math.floor((Date.now() + 3 * 3_600_000) / 86_400_000)
  const refreshAt = () => new Date((dayKey() + 1) * 86_400_000 - 3 * 3_600_000).toISOString()

  const sets = async () => {
    const b = await build()
    const dayIndex = b.resolved.length ? dayKey() % b.resolved.length : -1
    const out: SetView[] = b.resolved.map((r, i) => {
      const ofDay = i === dayIndex
      const pct = ofDay ? SET_OF_DAY_PCT : SET_DISCOUNT_PCT
      const colorways: SetColorwayView[] = r.colorways.map((c) => {
        const items = c.items.map((p) => ({ item: p.item, price: p.price, owned: isOwned(b, p.item.code) }))
        const full = items.reduce((n, p) => n + p.price, 0)
        const miss = items.filter((p) => !p.owned).reduce((n, p) => n + p.price, 0)
        const tier = demoTier()
        const own = miss ? round10((miss * (100 - pct)) / 100) : 0
        const sub = tierPct(tier)
        return {
          name: c.name,
          color: c.color,
          items,
          fullPrice: round10(full),
          price: sub && own ? round10((own * (100 - sub)) / 100) : own,
          discountPct: pct,
          have: items.filter((p) => p.owned).length,
          ...(!tier && own ? { plusPrice: plusOf(own) } : {}),
        }
      })
      return { id: r.def.id, title: r.def.title, theme: r.def.theme, ofDay, colorways }
    })
    return { sets: out, refreshAt: refreshAt(), plusTier: demoTier() }
  }

  const buy = async (body: { setId?: string; colorway?: string; expect?: number }) => {
    const { sets: list } = await sets()
    const set = list.find((s) => s.id === body.setId)
    const way = set?.colorways.find((c) => c.name === (body.colorway || ''))
    if (!set || !way) return fail('Набора нет')
    if (way.price <= 0) return fail('Набор уже собран')
    if (body.expect !== way.price) return fail('Цена набора изменилась: обновите магазин')
    if (deps.wallet.balance < way.price) return fail('http 402')
    deps.wallet.balance -= way.price
    const granted = way.items.filter((p) => !p.owned).map((p) => p.item)
    granted.forEach((it) => bought.add(it.code))
    return { balance: deps.wallet.balance, price: way.price, granted }
  }

  const poolOf = (b: Built, def: CaseDef): Priced[] => {
    if (def.slots) {
      const all = [...b.byBase.values()].flat().filter((p) => !!def.odds[p.item.rarity])
      return def.slots.includes('*') ? all : all.filter((p) => def.slots!.includes(p.item.slot))
    }
    const codes = new Set(SET_DEFS.filter((d) => d.theme === def.id).flatMap((d) => d.items))
    return [...codes].flatMap((c) => b.byBase.get(c) || []).filter((p) => !!def.odds[p.item.rarity])
  }

  const oddsOf = (b: Built, def: CaseDef, pool: Priced[], guaranteed: boolean) => {
    const rows = DROP_RARITIES.filter((r) => def.odds[r]).map((rarity) => {
      const all = pool.filter((p) => p.item.rarity === rarity)
      return { rarity, base: def.odds[rarity] || 0, left: all.filter((p) => !isOwned(b, p.item.code)).length, total: all.length }
    })
    const top = rows.filter((r) => isTop(r.rarity, def.pityFrom) && r.left > 0)
    const live = (guaranteed && top.length ? top : rows).filter((r) => r.left > 0)
    const sum = live.reduce((n, r) => n + r.base, 0)
    return rows.map((r) => ({
      rarity: r.rarity,
      weight: sum && live.includes(r) ? Math.round((r.base * 1000) / sum) : 0,
      left: r.left,
      total: r.total,
    }))
  }

  /** Ящик дня: по кругу из восьми, каждый раз в восемь дней. */
  const ofDayId = () => CASE_DEFS[dayKey() % 8]!.id
  /** Как casePrice службы: меньшая из скидки дня и подписки, не вместе. «Осколочный» без скидок. */
  const priceOf = (def: CaseDef, tier = demoTier()) => {
    if (def.id === 'shards') return def.price
    const day = def.id === ofDayId() ? round10((def.price * (100 - CASE_OF_DAY_PCT)) / 100) : def.price
    const pct = tierPct(tier)
    const plus = pct ? round10((def.price * (100 - pct)) / 100) : def.price
    return Math.min(day, plus)
  }

  const cases = async () => {
    const b = await build()
    const tier = demoTier()
    const out: CaseView[] = CASE_DEFS.map((t) => {
      const pool = poolOf(b, t)
      const pityLeft = Math.max(1, t.pity - sinceOf(t.id))
      const price = priceOf(t, tier)
      return {
        id: t.id,
        title: t.title,
        price,
        basePrice: t.price,
        ...(tier ? {} : { plusPrice: priceOf(t, 'PLUS') }),
        ofDay: t.id === ofDayId(),
        color: t.color,
        odds: oddsOf(b, t, pool, pityLeft <= 1),
        pityLeft,
        pity: t.pity,
        pityFrom: t.pityFrom,
        left: pool.filter((p) => !isOwned(b, p.item.code)).length,
        total: pool.length,
        // Как у службы: по одной вещи на базовый код, самые дорогие, и по
        // возможности из разных мест на теле.
        cover: (() => {
          const uniq = [...pool]
            .sort((x, y) => y.price - x.price)
            .filter((p, i, list) => list.findIndex((o) => baseOf(o.item.code) === baseOf(p.item.code)) === i)
          const out: Priced[] = []
          for (const p of uniq) if (out.length < 3 && !out.some((o) => o.item.slot === p.item.slot)) out.push(p)
          for (const p of uniq) if (out.length < 3 && !out.includes(p)) out.push(p)
          return out.map((p) => p.item)
        })(),
        sets: SET_DEFS.filter((d) => d.theme === t.id).map((d) => d.title),
        ...missView(t.id, pityLeft <= 1, !pool.some((p) => !isOwned(b, p.item.code))),
        cheapItem: true,
        currency: t.id === 'shards' ? ('shards' as const) : ('rubies' as const),
        guarantee: guaranteeOf(t),
        multi: t.multi ? { count: t.multi.count, price: t.price * t.multi.payFor, basePrice: t.price * t.multi.count, floor: t.multi.floor } : null,
        freeAvailable: !freeTaken && freeEligible(t),
      }
    })
    // Лента последних редких выпадений: ники выдуманные, вещи — из пулов.
    const nicks = ['Kryptonite', 'Sanya_Mine', 'Tigrenok', 'xX_Nexus_Xx', 'Alina_Craft', 'Vovan4ik', 'Zefir']
    const drops: CaseDrop[] = []
    for (let i = 0; i < 10; i++) {
      const def = CASE_DEFS[(i * 3) % CASE_DEFS.length]!
      const top = poolOf(b, def).filter((p) => isTop(p.item.rarity)).sort((x, y) => y.price - x.price)
      const hit = top[(i * 5) % Math.max(1, top.length)]
      if (hit) drops.push({ nick: nicks[i % nicks.length]!, item: hit.item, caseId: def.id, at: new Date(Date.now() - (i + 1) * 340_000).toISOString() })
    }
    return { cases: out, drops, refreshAt: refreshAt(), ofDayPct: CASE_OF_DAY_PCT }
  }

  const contents = async (id: string): Promise<CaseContents> => {
    const b = await build()
    const def = CASE_DEFS.find((t) => t.id === id)
    if (!def) return fail('Кейса нет')
    const pool = poolOf(b, def)
    const odds = oddsOf(b, def, pool, false)
    return {
      id,
      ...missView(id, def.pity - sinceOf(def.id) <= 1, !pool.some((p) => !isOwned(b, p.item.code))),
      items: [...pool]
        .sort((x, y) => rarityRank(y.item.rarity) - rarityRank(x.item.rarity) || y.price - x.price)
        .map((p) => {
          const row = odds.find((o) => o.rarity === p.item.rarity)
          const owned = isOwned(b, p.item.code)
          return { item: p.item, owned, chance: owned || !row?.left ? 0 : Math.round((row.weight / 10 / row.left) * 100) / 100 }
        }),
    }
  }

  /** Бросок редкости по весам. */
  const pick = (odds: { rarity: Rarity; weight: number }[]): Rarity => {
    const sum = odds.reduce((n, o) => n + o.weight, 0)
    let at = Math.random() * sum
    for (const o of odds) {
      if (at < o.weight) return o.rarity
      at -= o.weight
    }
    return odds[odds.length - 1]!.rarity
  }
  /** Бонус каждого открытия: 1–3 мелочи рубинами и осколками. */
  const extras = (): CaseReward[] => {
    const n = 1 + Math.floor(Math.random() * 3)
    return Array.from({ length: n }, (_, i) =>
      i % 2 ? { kind: 'shards' as const, amount: 10 * (1 + Math.floor(Math.random() * 4)) } : { kind: 'rubies' as const, amount: 10 * (1 + Math.floor(Math.random() * 5)) },
    )
  }

  /**
   * Один ящик как caseOpen службы: на гарантии — pityFrom и выше, иначе промах
   * (дешёвая вещь + утешение) или вещь по шансам. `atLeast` — пол редкости
   * (бесплатный ящик: Редкая, последняя карта ×10: гарантия десятки).
   */
  const rollOne = (b: Built, def: CaseDef, pool: Priced[], atLeast?: Rarity): { open: CaseOpenView; item?: ItemRef } | null => {
    const guaranteed = def.pity - sinceOf(def.id) <= 1
    let odds = oddsOf(b, def, pool, guaranteed).filter((o) => o.weight > 0)
    if (atLeast) {
      const up = odds.filter((o) => rarityRank(o.rarity) >= rarityRank(atLeast))
      if (up.length) odds = up
    }
    const forced = demoParam('caserar') as Rarity | null
    if (forced && odds.some((o) => o.rarity === forced)) odds = odds.filter((o) => o.rarity === forced)
    if (!odds.length) return null
    const m = MISS[def.id] ?? MISS.flame!
    const forceMiss = demoParam('miss') === '1'
    if (!guaranteed && !atLeast && !forced && (forceMiss || Math.random() * 1000 < m.miss)) {
      const total = m.prizes.reduce((n, p) => n + p.weight, 0)
      let roll = Math.random() * total
      const prize = m.prizes.find((p) => (roll -= p.weight) < 0) ?? m.prizes[0]!
      const free = pool.filter((p) => !isOwned(b, p.item.code))
      const cheapPool = free.filter((p) => p.item.rarity === 'COMMON' || p.item.rarity === 'UNCOMMON')
      const from = cheapPool.length ? cheapPool : free
      const cheap = from[Math.floor(Math.random() * from.length)]
      const rewards: CaseReward[] = [...(cheap ? [{ kind: 'cheap' as const, item: cheap.item }] : []), { kind: prize.kind, amount: prize.amount }, ...extras().slice(0, 2)]
      if (cheap) bought.add(cheap.item.code)
      pity.set(def.id, sinceOf(def.id) + 1)
      return { open: { rewards, kind: cheap ? 'cheap' : prize.kind, top: false, ...(cheap ? { rarity: cheap.item.rarity } : {}) }, item: cheap?.item }
    }
    const rarity = pick(odds)
    const left = pool.filter((p) => p.item.rarity === rarity && !isOwned(b, p.item.code))
    const hit = left[Math.floor(Math.random() * left.length)]!
    bought.add(hit.item.code)
    const top = isTop(hit.item.rarity, def.pityFrom)
    pity.set(def.id, top ? 0 : sinceOf(def.id) + 1)
    return { open: { rewards: [{ kind: 'item', item: hit.item, rarityName: RARITY_NAME_SHORT[hit.item.rarity] }, ...extras()], kind: 'item', rarity: hit.item.rarity, top }, item: hit.item }
  }

  const open = async (body: { caseId?: string; requestId?: string; count?: number; free?: boolean }): Promise<CaseOpened> => {
    const b = await build()
    const def = CASE_DEFS.find((t) => t.id === body.caseId)
    if (!def) return fail('Кейса нет')
    const count = body.count === 10 ? 10 : 1
    const free = body.free === true
    if (free && (count !== 1 || !freeEligible(def))) return fail('Бесплатный ящик - один обычный ящик за рубины')
    if (free && freeTaken) return fail('Бесплатный ящик уже открыт')
    if (count === 10 && !def.multi) return fail('У этого ящика нет ×10')
    const pool = poolOf(b, def)
    if (!pool.some((p) => !isOwned(b, p.item.code))) return fail('У тебя уже всё из этого кейса')
    const price = free ? 0 : count === 10 ? def.price * def.multi!.payFor : priceOf(def)
    const byShards = def.id === 'shards'
    if (!byShards) {
      if (deps.wallet.balance < price) return fail('http 402')
      deps.wallet.balance -= price
    }
    if (free) freeTaken = true
    const floorRank = def.multi ? rarityRank(def.multi.floor) : 0
    const opens: CaseOpenView[] = []
    let reached = false
    let multiFloorUsed = false
    for (let i = 0; i < count; i++) {
      const last = count === 10 && i === count - 1 && !reached
      const got = rollOne(b, def, pool, free ? 'RARE' : last ? def.multi!.floor : undefined)
      if (!got) break
      if (last && got.item) multiFloorUsed = true
      if (got.open.kind === 'item' && got.open.rarity && rarityRank(got.open.rarity) >= floorRank) reached = true
      opens.push(got.open)
    }
    if (!opens.length) return fail('У тебя уже всё из этого кейса')
    for (const o of opens) for (const r of o.rewards) if (r.kind === 'rubies') deps.wallet.balance += r.amount ?? 0
    const best = opens
      .map((o) => o.rarity)
      .filter((r): r is Rarity => !!r)
      .sort((x, y) => rarityRank(y) - rarityRank(x))[0]
    const lead = count === 1 ? opens[0]! : [...opens].sort((x, y) => rarityRank(y.rarity ?? 'COMMON') - rarityRank(x.rarity ?? 'COMMON'))[0]!
    const first = lead.rewards[0]
    return {
      balance: deps.wallet.balance,
      price,
      count: opens.length,
      opens,
      ...(best ? { best } : {}),
      multiFloorUsed,
      rewards: count === 1 ? lead.rewards : opens.flatMap((o) => o.rewards),
      kind: lead.kind,
      item: first?.item,
      amount: lead.kind === 'cheap' ? lead.rewards[1]?.amount : first?.amount,
      ...(first?.item ? { rarityName: RARITY_NAME_SHORT[first.item.rarity] } : {}),
      top: opens.some((o) => o.top),
      pityLeft: Math.max(1, def.pity - sinceOf(def.id)),
    }
  }

  /** Права демо-игрока для /cosmetics/owned: вещи-расцветки, купленные наборами и кейсами. */
  const boughtVariants = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const code of bought) {
      const [base, name] = code.split('~')
      if (name) (out[base!] ||= []).push(name)
    }
    return out
  }
  const boughtBases = () => [...new Set([...bought].map(baseOf))]

  return { sets, buy, cases, contents, open, boughtBases, boughtVariants, ready: () => build().then(() => undefined) }
}
