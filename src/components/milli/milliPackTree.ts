import type { MilliExcluded, MilliItem } from '../../lib/milli'

/*
 * Связи в карточке сборки Милли (04.10.2026): какая библиотека для какого
 * мода, что станет лишним, если мод убрать, и почему мод не вошёл — коротко
 * и по-русски (владелец: «фича для модеров, связи должны быть видны»).
 *
 * Сервер пока присылает связь только текстом: у зависимости `why` =
 * «Нужен для <мод>». Если придёт `requiredBy` (projectId или названия) —
 * берём его. Всё читаем осторожно: поля необязательные.
 */

type Extra = { requiredBy?: unknown; descriptionRu?: unknown }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Короткое русское описание: descriptionRu с сервера, иначе пусто. */
export function ruDescription(m: MilliItem): string {
  const v = (m as MilliItem & Extra).descriptionRu
  return typeof v === 'string' ? v.trim() : ''
}

export interface PackTree {
  /** Библиотеки под своим «корнем» — модом, паком или шейдером на выбор: projectId корня → библиотеки. */
  deps: Map<string, MilliItem[]>
  /** Кому нужна библиотека (projectId → предметы сборки, первым — тот, под кем она стоит). */
  parents: Map<string, MilliItem[]>
  /** Основа без «хозяина» в сборке: Fabric API, Sodium и т.п. */
  core: MilliItem[]
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [])

/** Библиотека (ветка под модом): `base` старого API, `cat: lib` / `by: auto` нового. */
export const isLib = (m: MilliItem) => m.base || m.cat === 'lib' || m.by === 'auto'

/** Обратный индекс `requires`: projectId → кому он нужен (requiredBy считаем сами, SPEC §1). */
export function requiredByIndex(items: MilliItem[]): Map<string, MilliItem[]> {
  const out = new Map<string, MilliItem[]>()
  for (const o of items)
    for (const r of ids(o.requires)) {
      if (r === o.projectId) continue
      const l = out.get(r)
      if (!l) out.set(r, [o])
      else if (!l.includes(o)) l.push(o)
    }
  return out
}

/** Кому нужна библиотека: `requiredBy`, обратные `requires`, и только для старого API — «Нужен для A, B» из `why`. */
function parentsOf(m: MilliItem, back: Map<string, MilliItem[]>, byId: Map<string, MilliItem>, byTitle: Map<string, MilliItem>): MilliItem[] {
  const out: MilliItem[] = []
  const add = (p: MilliItem | undefined) => {
    if (p && p.projectId !== m.projectId && !out.includes(p)) out.push(p)
  }
  for (const r of ids((m as MilliItem & Extra).requiredBy)) add(byId.get(r) || byTitle.get(norm(r)))
  for (const o of back.get(m.projectId) || []) add(o)
  if (out.length) return out
  const hit = /^нуж(?:ен|на|но|ны)\s+для\s+(.+?)\.?$/i.exec(m.why || '')
  if (!hit) return out
  const whole = byTitle.get(norm(hit[1]!))
  if (whole) return [whole]
  for (const part of hit[1]!.split(/,\s*|\s+и\s+/)) add(byTitle.get(norm(part)))
  return out
}

/**
 * Дерево сборки: под каждым предметом на выбор — его библиотеки (и
 * библиотеки библиотек), остальная основа — отдельно. `items` — все
 * предметы карточки: моды, ресурс-паки, шейдеры (у Fresh Animations свои
 * библиотеки-моды). O(n + связей): 300 предметов — доли миллисекунды.
 */
export function packTree(items: MilliItem[]): PackTree {
  const byId = new Map(items.map((m) => [m.projectId, m]))
  const byTitle = new Map(items.map((m) => [norm(m.title), m]))
  const back = requiredByIndex(items)
  const parents = new Map<string, MilliItem[]>()
  for (const m of items) if (isLib(m)) parents.set(m.projectId, parentsOf(m, back, byId, byTitle))

  /** Корень цепочки «библиотека → мод»: первый не-библиотечный вверх по связям. */
  const rootOf = (m: MilliItem): MilliItem | null => {
    let cur: MilliItem | undefined = m
    const seen = new Set<string>()
    while (cur && isLib(cur) && !seen.has(cur.projectId)) {
      seen.add(cur.projectId)
      cur = parents.get(cur.projectId)?.[0]
    }
    return cur && !isLib(cur) ? cur : null
  }

  const deps = new Map<string, MilliItem[]>()
  const core: MilliItem[] = []
  for (const m of items) {
    if (!isLib(m)) continue
    const root = rootOf(m)
    if (!root) core.push(m)
    else {
      const l = deps.get(root.projectId)
      if (l) l.push(m)
      else deps.set(root.projectId, [m])
    }
  }
  return { deps, parents, core }
}

/**
 * Библиотеки, которые никому не нужны: все их «хозяева» убраны, а сами они
 * ещё в сборке. Закреплённые (Fabric API) не трогаем.
 */
export function orphansOf(tree: PackTree, isOn: (m: MilliItem) => boolean, isLocked: (m: MilliItem) => boolean): MilliItem[] {
  const out: MilliItem[] = []
  for (const list of tree.deps.values())
    for (const dep of list) {
      const ps = tree.parents.get(dep.projectId) || []
      if (ps.length && !isLocked(dep) && isOn(dep) && ps.every((p) => !isOn(p))) out.push(dep)
    }
  return out
}

/** Что требует предмет: `requires` с сервера и библиотеки, у которых он среди «хозяев». */
export function needsOf(tree: PackTree, m: MilliItem, items: MilliItem[]): MilliItem[] {
  const byId = new Map(items.map((x) => [x.projectId, x]))
  const out: MilliItem[] = []
  const add = (x: MilliItem | undefined) => {
    if (x && x.projectId !== m.projectId && !out.includes(x)) out.push(x)
  }
  for (const id of ids(m.requires)) add(byId.get(id))
  for (const [id, ps] of tree.parents) if (ps.some((p) => p.projectId === m.projectId)) add(byId.get(id))
  return out
}

const LOADER_RU: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }
const loaderRu = (s: string) => s.replace(/\b(fabric|forge|neoforge|quilt)\b/gi, (w) => LOADER_RU[w.toLowerCase()] || w)
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/**
 * Почему мод не вошёл — по-русски, с виновником: какая зависимость или
 * версия помешала. `detail` сервера («нет GeckoLib под 1.20.1 forge»)
 * разбираем, неизвестное показываем как есть.
 */
export function excludedWhy(e: Pick<MilliExcluded, 'reason' | 'detail'>): { why: string; cause: string } {
  const d = loaderRu((e.detail || '').trim())
  const dep = /^нет (.+?) под (.+)$/i.exec(d)
  switch (e.reason) {
    case 'dep_version':
      return dep
        ? { why: 'Не нашлось подходящей зависимости', cause: 'Требует ' + dep[1] + ' — его нет под ' + dep[2] }
        : { why: 'Не уживается с версией своей зависимости', cause: cap(d) }
    case 'wrong_mc':
      return { why: 'Нет версии для этой игры', cause: dep ? 'Файла под ' + dep[2] + ' нет' : cap(d) }
    case 'conflict':
      return { why: 'Конфликт модов', cause: cap(d) }
    case 'duplicate':
      return { why: 'Повтор', cause: cap(d) }
    case 'crash':
      return { why: 'Вылетает при запуске', cause: cap(d) }
    case 'quarantine':
      return { why: 'Ломает запуск на этой версии', cause: cap(d) }
    default:
      return { why: cap(d) || 'Не подошёл', cause: '' }
  }
}
