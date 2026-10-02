/**
 * ДЕМО НАБОРОВ И КЕЙСОВ (?preview=user, только dev; бэкенд ещё не на проде).
 *
 * Состав наборов — копия SET_DEFS бэкенда (trade-api/launcher/rubies/sets.catalog.ts),
 * вещи, расцветки, имена и превью — из живого каталога косметики, цены по рангу
 * (как у витрины в demoShop.ts). Выдуман только «мой» кошелёк и что уже куплено.
 * Покупки живут в памяти вкладки.
 */
import type { CaseContents, CaseOpened, CaseView, ItemRef, Rarity, SetColorwayView, SetTheme, SetView } from '../../lib/rubies'
import { variantCode, variantTitles } from '../../lib/variantNames'
import { RARITY_NAME_SHORT, rarityOfPrice, rarityRank } from './rarity'
import { RANK_PRICE, v3Price, variantRank, type DemoCatalogItem } from './demoShop'

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
const SET_OF_DAY_PCT = 40
const CASE_PITY = 15
const CASE_THEMES: { id: SetTheme; title: string; price: number }[] = [
  { id: 'flame', title: 'Пламя', price: 690 },
  { id: 'dark', title: 'Тьма', price: 690 },
  { id: 'future', title: 'Будущее', price: 690 },
  { id: 'cozy', title: 'Уют', price: 490 },
]
const CASE_ODDS: Partial<Record<Rarity, number>> = { COMMON: 400, UNCOMMON: 300, RARE: 180, EPIC: 80, LEGENDARY: 32, MYTHIC: 8 }
const DROP_RARITIES = Object.keys(CASE_ODDS) as Rarity[]
const isTop = (r: Rarity) => rarityRank(r) >= rarityRank('EPIC')
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
  const pity = new Map<SetTheme, number>()

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
        return {
          name: c.name,
          color: c.color,
          items,
          fullPrice: round10(full),
          price: miss ? round10((miss * (100 - pct)) / 100) : 0,
          discountPct: pct,
          have: items.filter((p) => p.owned).length,
        }
      })
      return { id: r.def.id, title: r.def.title, theme: r.def.theme, ofDay, colorways }
    })
    return { sets: out, refreshAt: refreshAt() }
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

  const poolOf = (b: Built, theme: SetTheme): Priced[] => {
    const codes = new Set(SET_DEFS.filter((d) => d.theme === theme).flatMap((d) => d.items))
    return [...codes].flatMap((c) => b.byBase.get(c) || []).filter((p) => !!CASE_ODDS[p.item.rarity])
  }

  const oddsOf = (b: Built, pool: Priced[], guaranteed: boolean) => {
    const rows = DROP_RARITIES.map((rarity) => {
      const all = pool.filter((p) => p.item.rarity === rarity)
      return { rarity, base: CASE_ODDS[rarity] || 0, left: all.filter((p) => !isOwned(b, p.item.code)).length, total: all.length }
    })
    const top = rows.filter((r) => isTop(r.rarity) && r.left > 0)
    const live = (guaranteed && top.length ? top : rows).filter((r) => r.left > 0)
    const sum = live.reduce((n, r) => n + r.base, 0)
    return rows.map((r) => ({
      rarity: r.rarity,
      weight: sum && live.includes(r) ? Math.round((r.base * 1000) / sum) : 0,
      left: r.left,
      total: r.total,
    }))
  }

  const cases = async () => {
    const b = await build()
    const out: CaseView[] = CASE_THEMES.map((t) => {
      const pool = poolOf(b, t.id)
      const pityLeft = Math.max(1, CASE_PITY - (pity.get(t.id) || 0))
      return {
        id: t.id,
        title: t.title,
        price: t.price,
        odds: oddsOf(b, pool, pityLeft <= 1),
        pityLeft,
        pity: CASE_PITY,
        left: pool.filter((p) => !isOwned(b, p.item.code)).length,
        total: pool.length,
        cover: [...pool].sort((x, y) => y.price - x.price).slice(0, 3).map((p) => p.item),
        sets: SET_DEFS.filter((d) => d.theme === t.id).map((d) => d.title),
      }
    })
    return { cases: out }
  }

  const contents = async (id: string): Promise<CaseContents> => {
    const b = await build()
    const theme = CASE_THEMES.find((t) => t.id === id)
    if (!theme) return fail('Кейса нет')
    const pool = poolOf(b, theme.id)
    const odds = oddsOf(b, pool, false)
    return {
      id,
      items: [...pool]
        .sort((x, y) => rarityRank(y.item.rarity) - rarityRank(x.item.rarity) || y.price - x.price)
        .map((p) => {
          const row = odds.find((o) => o.rarity === p.item.rarity)
          const owned = isOwned(b, p.item.code)
          return { item: p.item, owned, chance: owned || !row?.left ? 0 : Math.round((row.weight / 10 / row.left) * 100) / 100 }
        }),
    }
  }

  const open = async (body: { caseId?: string; requestId?: string }): Promise<CaseOpened> => {
    const b = await build()
    const theme = CASE_THEMES.find((t) => t.id === body.caseId)
    if (!theme) return fail('Кейса нет')
    const pool = poolOf(b, theme.id)
    const guaranteed = CASE_PITY - (pity.get(theme.id) || 0) <= 1
    const odds = oddsOf(b, pool, guaranteed).filter((o) => o.weight > 0)
    if (!odds.length) return fail('У тебя уже всё из этого кейса')
    if (deps.wallet.balance < theme.price) return fail('http 402')
    deps.wallet.balance -= theme.price
    const sum = odds.reduce((n, o) => n + o.weight, 0)
    let at = Math.random() * sum
    let rarity = odds[odds.length - 1]!.rarity
    for (const o of odds) {
      if (at < o.weight) {
        rarity = o.rarity
        break
      }
      at -= o.weight
    }
    const left = pool.filter((p) => p.item.rarity === rarity && !isOwned(b, p.item.code))
    const hit = left[Math.floor(Math.random() * left.length)]!
    bought.add(hit.item.code)
    const top = isTop(hit.item.rarity)
    pity.set(theme.id, top ? 0 : (pity.get(theme.id) || 0) + 1)
    return {
      balance: deps.wallet.balance,
      item: hit.item,
      rarityName: RARITY_NAME_SHORT[hit.item.rarity],
      top,
      pityLeft: Math.max(1, CASE_PITY - (pity.get(theme.id) || 0)),
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
