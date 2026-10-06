import { MILLI_CAT_RU, isLockedItem } from '../../../lib/milli'
import type { MilliCat, MilliItem } from '../../../lib/milli'
import type { BenchFilter, BenchGroup } from '../../../state/milliBench'
import { isLib, orphansOf, packTree } from '../milliPackTree'
import type { PackTree } from '../milliPackTree'

/*
 * Строки вкладки «Моды» карточки — чистые функции (тестируются без React).
 * Плоский массив строк известной высоты: высота считается заранее (название
 * в 1 или 2 строки — мерит вызывающий, `lines`), поэтому виртуальный список
 * не мерит DOM. Группировка: Категории (11 MilliCat; моддеру библиотеки —
 * веткой под своим модом), Зависимости (packTree по `requires`), А–Я. Поиск
 * по RU/EN названию, slug, описанию — индекс один раз на сборку. Фильтры:
 * Все · Изменённые · Выключенные · ⚠. Выключенные моды стоят на своём месте
 * (тумблер выкл.), дифф из `pack.changes`: + / − / ~.
 */

export type Mark = '+' | '-' | '~'
export type BenchRowKind = 'group' | 'mod' | 'lib' | 'ghost' | 'orphans'

/** Базовые высоты: название в одну строку, без строки моддера. */
export const ROW_H: Record<BenchRowKind, number> = { group: 34, mod: 52, lib: 40, ghost: 52, orphans: 44 }
/** Вторая строка названия. */
export const NAME_LINE_H = 16
/** Строка моддера: версия · slug · сторона · автор. */
export const META_H = 16

/** Высота строки предмета: название в 1–2 строки, моддеру — ещё строка с версией. */
export function itemHeight(kind: BenchRowKind, lines: 1 | 2, modder: boolean): number {
  const h = ROW_H[kind] + (lines === 2 ? NAME_LINE_H : 0)
  return kind === 'lib' || !modder ? h : h + META_H
}

export type LinesOf = (m: MilliItem, kind: BenchRowKind) => 1 | 2

export interface BenchRow {
  kind: BenchRowKind
  /** Стабильный ключ React: строка не пересоздаётся при прокрутке и смене фильтра. */
  key: string
  h: number
  item?: MilliItem
  mark?: Mark
  /** Ветка └ под модом (группировка «Зависимости»). */
  branch?: boolean
  /** Что не так: «Версия не проверена», заметка о риске, «Убрана — не запустятся …». */
  warn?: string
  /** Кому нужна (для библиотеки) — названиями. */
  needFor?: string[]
  // Заголовок группы
  group?: string
  label?: string
  n?: number
  collapsed?: boolean
  /** projectId строк группы (не призраков) — «Выбрать группу». */
  ids?: string[]
  // Плашка сирот
  orphans?: MilliItem[]
}

export const CAT_ORDER: readonly MilliCat[] = ['perf', 'ui', 'world', 'mobs', 'tech', 'magic', 'adventure', 'build', 'look', 'misc', 'lib']

export const catOf = (m: MilliItem): MilliCat => (m.cat && m.cat in MILLI_CAT_RU ? m.cat : isLib(m) ? 'lib' : 'misc')

// ─── Подгруппы: «Техника» → «Create и аддоны», «Энергия», «Хранение»… ─────────
// Мелкие группы со своими иконками читаются быстрее одной простыни (владелец: «мало категорий»).

interface Sub { key: string; label: string; px: string; rx?: RegExp }

const SUBS: Record<MilliCat, Sub[]> = {
  perf: [{ key: 'perf', label: 'Оптимизация', px: 'fps_torch' }],
  ui: [
    { key: 'ui:map', label: 'Карты', px: 'compass', rx: /\b(map|minimap|journeymap|xaero|waypoint)/ },
    { key: 'ui:recipe', label: 'Рецепты', px: 'book_quill', rx: /\b(jei|emi|rei|recipe|рецепт)/ },
    { key: 'ui:inv', label: 'Инвентарь', px: 'chest', rx: /\b(inventory|sort|mouse ?tweaks|инвентар)/ },
    { key: 'ui', label: 'Удобство', px: 'spyglass' },
  ],
  world: [
    { key: 'world:struct', label: 'Постройки и данжи', px: 'shulker_box', rx: /\b(structure|dungeon|village|tower|ruin|castle|данж|построй|строени)/ },
    { key: 'world:biome', label: 'Биомы и пещеры', px: 'grass_dandelion', rx: /\b(biome|terrain|cave|terralith|tectonic|биом|пещер)/ },
    { key: 'world', label: 'Мир', px: 'grass_dandelion' },
  ],
  mobs: [
    { key: 'mobs:boss', label: 'Боссы', px: 'nether_star', rx: /\b(boss|cataclysm|mowzie|босс)/ },
    { key: 'mobs', label: 'Мобы и существа', px: 'zombie_bandage' },
  ],
  tech: [
    { key: 'tech:create', label: 'Create и аддоны', px: 'create_cog', rx: /\bcreate\b/ },
    { key: 'tech:energy', label: 'Энергия и машины', px: 'redstone_lamp_on', rx: /\b(energy|power|electric|mekanism|thermal|reactor|generator|энерг)/ },
    { key: 'tech:store', label: 'Хранение', px: 'chest_large', rx: /\b(storage|drawer|backpack|ae2|applied|refined|хранени|рюкзак)/ },
    { key: 'tech', label: 'Техника', px: 'comparator' },
  ],
  magic: [{ key: 'magic', label: 'Магия', px: 'spellbook' }],
  adventure: [
    { key: 'adv:fight', label: 'Оружие и бой', px: 'rpg_sword_shield', rx: /\b(weapon|sword|gun|combat|armor|оруж|меч|бой)/ },
    { key: 'adv:rpg', label: 'Классы и прокачка', px: 'diamond', rx: /\b(class|skill|level|rpg|quest|класс|навык|прокач|квест)/ },
    { key: 'adventure', label: 'Приключения', px: 'compass' },
  ],
  build: [
    { key: 'build:decor', label: 'Декор и мебель', px: 'painting', rx: /\b(furniture|decor|мебел|декор)/ },
    { key: 'build', label: 'Строительство', px: 'crafting_table' },
  ],
  look: [
    { key: 'look:sound', label: 'Звук', px: 'bell', rx: /\b(sound|audio|music|звук|музык)/ },
    { key: 'look:anim', label: 'Анимации', px: 'firework_star', rx: /\b(animation|anim|анимац)/ },
    { key: 'look', label: 'Графика', px: 'glowstone_bright' },
  ],
  misc: [{ key: 'misc', label: 'Разное', px: 'chest' }],
  lib: [{ key: 'lib', label: 'Библиотеки', px: 'book_quill' }],
}

const SUB_BY_KEY = new Map(Object.values(SUBS).flat().map((x) => [x.key, x]))

/** Подгруппа предмета; без совпадения — общая группа категории. */
export function subOf(m: MilliItem): Sub {
  const list = SUBS[catOf(m)]
  const text = (m.slug + ' ' + m.title + ' ' + (m.descriptionRu ?? '') + ' ' + (m.description ?? '')).toLowerCase()
  return list.find((x) => !x.rx || x.rx.test(text)) ?? list[list.length - 1]!
}

/** Иконка группы по её ключу. */
export const groupPx = (key: string): string | null => SUB_BY_KEY.get(key)?.px ?? null

// ─── Поиск ──────────────────────────────────────────────────────────────────

/** Нижний регистр, ё → е, всё кроме букв/цифр — пробел. */
export const normSearch = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export type SearchIndex = Map<string, string>

/** Кэш нормализованных строк поиска на всё время жизни окна: ключ — projectId + поля строки. */
const normCache = new Map<string, { sig: string; norm: string }>()

/**
 * projectId → нормализованная строка (название, slug, RU/EN описание, why, категория).
 * Нормализация (регэксп по Юникоду) — один раз на предмет: новая ревизия собирает
 * индекс за O(n) из кэша, без повторного normSearch.
 */
export function buildIndex(items: readonly MilliItem[]): SearchIndex {
  const out: SearchIndex = new Map()
  for (const m of items) {
    if (out.has(m.projectId)) continue
    const sig = m.title + '\u0001' + m.slug + '\u0001' + (m.descriptionRu ?? '') + '\u0001' + (m.description ?? '') + '\u0001' + (m.why ?? '') + '\u0001' + (m.cat ?? '')
    let hit = normCache.get(m.projectId)
    if (!hit || hit.sig !== sig) {
      hit = { sig, norm: ' ' + normSearch([m.title, m.slug, m.slug.replace(/-/g, ''), m.descriptionRu ?? '', m.description ?? '', m.why ?? '', MILLI_CAT_RU[catOf(m)]].join(' ')) }
      normCache.set(m.projectId, hit)
    }
    out.set(m.projectId, hit.norm)
  }
  return out
}

/** Совпадение: каждое слово запроса — начало слова в строке (или подстрока, если слово ≥3 букв). */
export function matcher(query: string, index: SearchIndex): ((m: MilliItem) => boolean) | null {
  const toks = normSearch(query).split(' ').filter(Boolean)
  if (!toks.length) return null
  return (m) => {
    const hay = index.get(m.projectId) ?? ' ' + normSearch(m.title + ' ' + m.slug)
    for (const t of toks) if (!(t.length >= 3 ? hay.includes(t) : hay.includes(' ' + t))) return false
    return true
  }
}

// ─── Проблемы, сироты ───────────────────────────────────────────────────────

/** ⚠ строки: версия не проверена (сеть), известный риск. */
export function problemOf(m: MilliItem): string {
  if (m.unchecked) return 'Версия не проверена'
  if (m.risk === 'risky') return m.riskNote || 'Известная проблема обойдена'
  return ''
}

/**
 * Библиотеки, которые больше никому не нужны: все их моды убраны (призраки)
 * или их подтянули автоматически (`by: auto`), а хозяина в сборке нет.
 * Закреплённые и обязательные (Fabric API) не трогаем.
 */
export function benchOrphans(mods: readonly MilliItem[], removed: readonly MilliItem[], tree?: PackTree): MilliItem[] {
  const gone = new Set(removed.map((m) => m.projectId))
  const t = tree ?? packTree([...mods, ...removed.filter((r) => !mods.some((m) => m.projectId === r.projectId))])
  const locked = (m: MilliItem) => isLockedItem(m) || !!m.pinned
  const out = orphansOf(t, (m) => !gone.has(m.projectId), locked)
  for (const m of t.core) if (m.by === 'auto' && !gone.has(m.projectId) && !locked(m) && !(t.parents.get(m.projectId) || []).length && !out.includes(m)) out.push(m)
  return out
}

// ─── Строки ─────────────────────────────────────────────────────────────────

export interface RowsInput {
  /** Моды головы (то, что в сборке сейчас). */
  mods: readonly MilliItem[]
  /** Убранные из этой вкладки (userRemoved + дифф), уже найденные предметами. */
  removed: readonly MilliItem[]
  marks: ReadonlyMap<string, Mark>
  group: BenchGroup
  filter: BenchFilter
  query: string
  modder: boolean
  /** Группы, которые игрок свернул/развернул вручную (инверсия умолчания). */
  toggled?: ReadonlySet<string>
  index?: SearchIndex
  /** Дерево по модам + убранным: считать один раз на голову. */
  tree?: PackTree
  /** Плашка «N библиотек больше не нужны» закрыта крестиком. */
  orphansHidden?: boolean
  /** Сколько строк займёт название (мерит вызывающий по ширине списка). Нет — одна. */
  lines?: LinesOf
}

export interface RowsOut {
  rows: BenchRow[]
  counts: Record<BenchFilter, number>
  /** Строк-предметов после фильтра и поиска (без заголовков). */
  shown: number
  orphans: MilliItem[]
}

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })
const byTitle = (a: MilliItem, b: MilliItem) => collator.compare(a.title, b.title)

/** По умолчанию у игрока свёрнуты библиотеки; у моддера всё открыто. */
const defaultCollapsed = (key: string, modder: boolean) => !modder && (key === 'lib' || key === 'core')

const firstLetter = (t: string) => {
  const c = t.trim().charAt(0).toUpperCase()
  return /\p{L}/u.test(c) ? c : '#'
}

export function benchRows(inp: RowsInput): RowsOut {
  const { mods, removed, marks, group, filter, modder } = inp
  const match = inp.query.trim() ? matcher(inp.query, inp.index ?? buildIndex([...mods, ...removed])) : null
  const tree = inp.tree ?? packTree([...mods, ...removed.filter((r) => !mods.some((m) => m.projectId === r.projectId))])
  const onIds = new Set(mods.map((m) => m.projectId))
  const searching = !!match

  // Выключенные стоят на своём месте (тумблер выкл.): выключил — строка не пропадает.
  const ghosts = removed.filter((m) => !onIds.has(m.projectId))

  const warnOf = (m: MilliItem, ghost: boolean): string => {
    if (ghost && isLib(m)) {
      const left = (tree.parents.get(m.projectId) || []).filter((p) => onIds.has(p.projectId))
      if (left.length) return 'Убрана — не запустятся: ' + left.slice(0, 2).map((p) => p.title).join(', ') + (left.length > 2 ? ' и ещё ' + (left.length - 2) : '')
    }
    return problemOf(m)
  }

  const counts: Record<BenchFilter, number> = { all: mods.length, changed: 0, off: 0, warn: 0 }
  for (const m of mods) {
    if (marks.has(m.projectId)) counts.changed++
    if (problemOf(m)) counts.warn++
  }
  const allGone = removed.filter((m) => !onIds.has(m.projectId))
  counts.off = allGone.length
  for (const g of allGone) {
    if (marks.get(g.projectId) === '-') counts.changed++
    if (warnOf(g, true)) counts.warn++
  }

  const pass = (m: MilliItem, ghost: boolean): boolean => {
    if (match && !match(m)) return false
    switch (filter) {
      case 'changed':
        return marks.has(m.projectId)
      case 'off':
        return ghost
      case 'warn':
        return !!warnOf(m, ghost)
      default:
        return true
    }
  }

  const rows: BenchRow[] = []
  let shown = 0
  const itemRow = (m: MilliItem, ghost: boolean, branch = false): BenchRow => {
    shown++
    const kind: BenchRowKind = ghost ? 'ghost' : isLib(m) ? 'lib' : 'mod'
    const r: BenchRow = { kind, key: (branch ? 'b:' : 'i:') + m.projectId, h: itemHeight(kind, inp.lines ? inp.lines(m, kind) : 1, modder), item: m }
    const mark = ghost ? '-' : marks.get(m.projectId)
    if (mark) r.mark = mark
    if (branch) r.branch = true
    const w = warnOf(m, ghost)
    if (w) r.warn = w
    if (isLib(m)) {
      const ps = tree.parents.get(m.projectId)
      if (ps && ps.length) r.needFor = ps.map((p) => p.title)
    }
    return r
  }
  const pushGroup = (key: string, label: string, list: { m: MilliItem; ghost: boolean; branch?: boolean }[]) => {
    if (!list.length) return
    const collapsed = !searching && filter === 'all' && (inp.toggled?.has(key) ?? false) !== defaultCollapsed(key, modder)
    rows.push({
      kind: 'group',
      key: 'g:' + key,
      h: ROW_H.group,
      group: key,
      label,
      n: list.filter((x) => !x.ghost && !x.branch).length,
      collapsed,
      ids: list.filter((x) => !x.ghost).map((x) => x.m.projectId),
    })
    if (collapsed) return
    for (const x of list) rows.push(itemRow(x.m, x.ghost, x.branch))
  }

  // Плашка сирот — сверху, только когда игрок смотрит весь список.
  const orphans = benchOrphans(mods, allGone, tree)
  if (orphans.length && !inp.orphansHidden && !searching && (filter === 'all' || filter === 'changed')) {
    rows.push({ kind: 'orphans', key: 'orphans', h: ROW_H.orphans, orphans })
  }

  const live = mods.filter((m) => pass(m, false))
  // Убранные без имени (только id Modrinth, вроде «BJoffwm5») игроку ничего не говорят — не показываем.
  const dead = ghosts.filter((m) => pass(m, true) && !!m.title && m.title !== m.projectId && m.title !== m.slug)

  if (group === 'cat') {
    // Моддеру в полном списке библиотека стоит веткой под своим модом; остальное — в «Библиотеках».
    const nest = modder && filter === 'all' && !searching
    type E = { m: MilliItem; ghost: boolean; branch?: boolean }
    const by = new Map<string, E[]>()
    const libs: E[] = []
    for (const m of live) {
      // Библиотеки — в своей группе (у игрока свёрнута); моддеру в полном списке — веткой под модом.
      if (isLib(m)) libs.push({ m, ghost: false })
      else push(by, subOf(m).key, { m, ghost: false })
    }
    for (const m of dead) push(by, subOf(m).key, { m, ghost: true })
    const placed = new Set<string>()
    const liveIds = new Set(live.map((m) => m.projectId))
    for (const sub of CAT_ORDER.flatMap((c) => SUBS[c])) {
      const c = sub.key
      const l = by.get(c)
      if (c === 'lib' || !l) continue
      l.sort((a, b) => byTitle(a.m, b.m))
      if (!nest) {
        pushGroup(c, sub.label, l)
        continue
      }
      const out: E[] = []
      for (const x of l) {
        out.push(x)
        if (x.ghost) continue
        for (const d of tree.deps.get(x.m.projectId) || []) {
          if (!liveIds.has(d.projectId) || placed.has(d.projectId)) continue
          placed.add(d.projectId)
          out.push({ m: d, ghost: false, branch: true })
        }
      }
      pushGroup(c, sub.label, out)
    }
    const rest = [...libs.filter((x) => !placed.has(x.m.projectId)), ...(by.get('lib') ?? [])].sort((a, b) => byTitle(a.m, b.m))
    pushGroup('lib', MILLI_CAT_RU.lib, rest)
  } else if (group === 'az') {
    const all = [...live.map((m) => ({ m, ghost: false })), ...dead.map((m) => ({ m, ghost: true }))].sort((a, b) => byTitle(a.m, b.m))
    const by = new Map<string, { m: MilliItem; ghost: boolean }[]>()
    for (const x of all) push(by, firstLetter(x.m.title), x)
    for (const [k, l] of by) pushGroup('az:' + k, k, l)
  } else {
    // Зависимости: мод, под ним └ его библиотеки; основа без хозяина — отдельно; убранное — в конце.
    const liveIds = new Set(live.map((m) => m.projectId))
    const roots: { m: MilliItem; ghost: boolean; branch?: boolean }[] = []
    const placed = new Set<string>()
    for (const m of [...mods].filter((x) => !isLib(x)).sort(byTitle)) {
      const deps = (tree.deps.get(m.projectId) || []).filter((d) => onIds.has(d.projectId))
      const rootIn = liveIds.has(m.projectId)
      const depsIn = deps.filter((d) => liveIds.has(d.projectId) || (rootIn && !match && filter === 'all'))
      if (!rootIn && !depsIn.length) continue
      roots.push({ m, ghost: false })
      placed.add(m.projectId)
      for (const d of depsIn) {
        roots.push({ m: d, ghost: false, branch: true })
        placed.add(d.projectId)
      }
    }
    pushGroup('roots', 'Моды и их библиотеки', roots)
    const core = live.filter((m) => isLib(m) && !placed.has(m.projectId)).sort(byTitle)
    pushGroup('core', 'Основа сборки', core.map((m) => ({ m, ghost: false })))
    pushGroup('gone', 'Убрано', dead.sort(byTitle).map((m) => ({ m, ghost: true })))
  }

  return { rows, counts, shown, orphans }
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const l = map.get(k)
  if (l) l.push(v)
  else map.set(k, [v])
}

/** Индекс строки предмета (не ветки-дубля): куда прокрутить «Показать». */
export function rowIndexOf(rows: readonly BenchRow[], projectId: string): number {
  for (let i = 0; i < rows.length; i++) if (rows[i]!.item?.projectId === projectId) return i
  return -1
}

/** Группа, в которой стоит предмет (чтобы развернуть её перед «Показать»). */
export function groupKeyOf(m: MilliItem, group: BenchGroup): string {
  if (group === 'cat') return isLib(m) ? 'lib' : subOf(m).key
  if (group === 'az') return 'az:' + firstLetter(m.title)
  return isLib(m) ? 'core' : 'roots'
}

// ─── Окно виртуального списка ───────────────────────────────────────────────

/** Префиксные суммы высот: offsets[i] — верх строки i, offsets[n] — высота списка. */
export function offsetsOf(heights: readonly number[]): Float64Array {
  const out = new Float64Array(heights.length + 1)
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i]! + heights[i]!
  return out
}

/** Первая строка, чей низ ниже `y` (бинарный поиск). */
export function indexAt(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1]! <= y) lo = mid + 1
    else hi = mid
  }
  return Math.min(lo, Math.max(0, n - 1))
}

/** Окно [start, end): видимые строки + запас `over` с обеих сторон, не больше `max`. */
export function rowsInView(offsets: Float64Array, scrollTop: number, viewH: number, over = 8, max = 60): [number, number] {
  const n = offsets.length - 1
  if (n <= 0) return [0, 0]
  const first = indexAt(offsets, Math.max(0, scrollTop))
  const last = indexAt(offsets, Math.max(0, scrollTop + Math.max(viewH, 1) - 1))
  let start = Math.max(0, first - over)
  let end = Math.min(n, last + 1 + over)
  if (end - start > max) {
    // Высокое окно: запас режем поровну, видимое — целиком.
    const extra = Math.max(0, max - (last + 1 - first))
    start = Math.max(0, first - (extra >> 1))
    end = Math.min(n, start + max)
  }
  return [start, end]
}

/** scrollTop, при котором строка i видна: 'nearest' — минимальный сдвиг, 'center' — по центру. */
export function scrollFor(offsets: Float64Array, i: number, scrollTop: number, viewH: number, align: 'nearest' | 'center' = 'nearest'): number {
  const n = offsets.length - 1
  if (n <= 0) return 0
  const k = Math.max(0, Math.min(n - 1, i))
  const top = offsets[k]!
  const bot = offsets[k + 1]!
  const maxTop = Math.max(0, offsets[n]! - viewH)
  if (align === 'center') return Math.max(0, Math.min(maxTop, Math.round(top - (viewH - (bot - top)) / 2)))
  if (top < scrollTop) return top
  if (bot > scrollTop + viewH) return Math.min(maxTop, bot - viewH)
  return scrollTop
}

