import { expect, test } from 'bun:test'
import type { MilliItem } from '../../../lib/milli'
import { packTree } from '../milliPackTree'
import { benchOrphans, benchRows, buildIndex, offsetsOf, rowIndexOf, rowsInView, scrollFor } from './benchRows'
import type { Mark } from './benchRows'
import { DEMO_REMOVED, demoPack } from './demoPack'

const it = (projectId: string, title: string, extra: Partial<MilliItem> = {}): MilliItem => ({
  projectId,
  slug: title.toLowerCase().replace(/\W+/g, '-'),
  title,
  icon: null,
  why: '',
  base: false,
  source: 'modrinth',
  ...extra,
})

const base = { removed: [] as MilliItem[], marks: new Map<string, Mark>(), group: 'cat' as const, filter: 'all' as const, query: '', modder: true }

test('demoPack детерминирован: 300 предметов, связи внутри сборки, двое сирот', () => {
  const a = demoPack()
  expect(JSON.stringify(a)).toBe(JSON.stringify(demoPack()))
  expect(a.mods.length).toBe(300)
  const ids = new Set(a.mods.map((m) => m.projectId))
  expect(ids.size).toBe(300)
  expect(a.mods.flatMap((m) => m.requires ?? []).every((r) => ids.has(r))).toBe(true)
  expect(benchOrphans(a.mods, []).length).toBe(2)
  expect(a.mods.every((m) => !m.icon || m.icon.startsWith('data:'))).toBe(true)
})

test('300 предметов: packTree и строки быстрее 20 мс', () => {
  const p = demoPack()
  for (let i = 0; i < 3; i++) benchRows({ ...base, mods: p.mods }) // прогрев JIT
  let t = performance.now()
  const tree = packTree(p.mods)
  const treeMs = performance.now() - t
  t = performance.now()
  for (const group of ['cat', 'deps', 'az'] as const) benchRows({ ...base, mods: p.mods, group, tree })
  const rowsMs = (performance.now() - t) / 3
  expect(treeMs).toBeLessThan(20)
  expect(rowsMs).toBeLessThan(20)
})

test('Категории: 11 групп по-русски, библиотеки у игрока свёрнуты', () => {
  const p = demoPack()
  const player = benchRows({ ...base, mods: p.mods, modder: false })
  const groups = player.rows.filter((r) => r.kind === 'group')
  expect(groups.map((g) => g.label)).toContain('Оптимизация')
  expect(groups.map((g) => g.label)).toContain('Библиотеки')
  const lib = groups.find((g) => g.group === 'lib')!
  expect(lib.collapsed).toBe(true)
  expect(lib.n).toBe(30)
  expect(player.rows.some((r) => r.kind === 'lib')).toBe(false)
  const modder = benchRows({ ...base, mods: p.mods })
  expect(modder.rows.filter((r) => r.kind === 'lib').length).toBe(30)
  // Ручное переключение инвертирует умолчание.
  const open = benchRows({ ...base, mods: p.mods, modder: false, toggled: new Set(['lib']) })
  expect(open.rows.filter((r) => r.kind === 'lib').length).toBe(30)
})

test('Зависимости: библиотека веткой под модом по requires, не по why', () => {
  const lib = it('L', 'GeckoLib', { cat: 'lib', why: 'Нужен для Кого-то другого' })
  const a = it('A', 'Alex Mobs', { cat: 'mobs', requires: ['L'] })
  const core = it('C', 'Fabric API', { cat: 'lib' })
  const out = benchRows({ ...base, mods: [a, lib, core], group: 'deps' })
  const seq = out.rows.map((r) => (r.kind === 'group' ? '#' + r.label : (r.branch ? '└' : '') + r.item!.title))
  expect(seq).toEqual(['#Моды и их библиотеки', 'Alex Mobs', '└GeckoLib', '#Основа сборки', 'Fabric API'])
  expect(out.rows.find((r) => r.item?.projectId === 'L')!.needFor).toEqual(['Alex Mobs'])
})

test('Поиск: RU и EN описание, slug, ё/е, без регистра', () => {
  const p = demoPack()
  const index = buildIndex(p.mods)
  const q = (query: string) => benchRows({ ...base, mods: p.mods, query, index, group: 'az' }).shown
  expect(q('рецепты')).toBeGreaterThan(0) // JEI: «Рецепты всех предметов»
  expect(q('Recipe viewing')).toBeGreaterThan(0)
  expect(q('xaeros-minimap')).toBeGreaterThanOrEqual(1)
  expect(q('xaeros-minimap')).toBeLessThan(q('xaeros'))
  expect(q('ЖИВЫЕ')).toBeGreaterThan(0)
  expect(q('всё')).toBe(q('все'))
  expect(q('нет такого мода')).toBe(0)
})

test('Фильтры и дифф: + ~ в строке, − призрак, ⚠ unchecked/risky', () => {
  const p = demoPack()
  const marks = new Map<string, Mark>()
  for (const r of p.changes!.added) marks.set(r.projectId, '+')
  for (const r of p.changes!.removed) marks.set(r.projectId, '-')
  for (const r of p.changes!.changed) marks.set(r.projectId, '~')
  const removed = [DEMO_REMOVED]
  const all = benchRows({ ...base, mods: p.mods, removed, marks })
  expect(all.rows.filter((r) => r.kind === 'ghost').map((r) => r.item!.title)).toEqual(['Sound Physics Remastered II'])
  expect(all.rows.filter((r) => r.mark === '+').length).toBe(2)
  expect(all.rows.filter((r) => r.mark === '~').length).toBe(1)
  expect(all.counts).toEqual({ all: 300, changed: 4, off: 1, warn: 3 })
  const changed = benchRows({ ...base, mods: p.mods, removed, marks, filter: 'changed' })
  expect(changed.shown).toBe(4)
  const off = benchRows({ ...base, mods: p.mods, removed, marks, filter: 'off' })
  expect(off.shown).toBe(1)
  const warn = benchRows({ ...base, mods: p.mods, removed, marks, filter: 'warn' })
  expect(warn.rows.filter((r) => r.item).every((r) => !!r.warn)).toBe(true)
  expect(warn.shown).toBe(3)
})

test('Убрали мод — его библиотека в плашке сирот; убрали библиотеку — призрак предупреждает', () => {
  const lib = it('L', 'Citadel', { cat: 'lib', by: 'auto' })
  const a = it('A', "Alex's Mobs", { cat: 'mobs', requires: ['L'] })
  const b = it('B', 'Other', { cat: 'mobs' })
  expect(benchOrphans([lib, b], [a]).map((m) => m.title)).toEqual(['Citadel'])
  const out = benchRows({ ...base, mods: [a, b], removed: [lib], marks: new Map([['L', '-' as Mark]]) })
  expect(out.rows.find((r) => r.kind === 'ghost')!.warn).toBe("Убрана — не запустятся: Alex's Mobs")
  expect(rowIndexOf(out.rows, 'B')).toBeGreaterThan(0)
})

test('Окно списка: ≤60 строк, запас 8, scrollFor', () => {
  const p = demoPack()
  const { rows } = benchRows({ ...base, mods: p.mods })
  const off = offsetsOf(rows.map((r) => r.h))
  expect(off[rows.length]).toBe(rows.reduce((s, r) => s + r.h, 0))
  const [s0, e0] = rowsInView(off, 0, 600)
  expect(s0).toBe(0)
  expect(e0 - s0).toBeLessThanOrEqual(60)
  const mid = off[150]!
  const [s1, e1] = rowsInView(off, mid, 600)
  expect(s1).toBe(150 - 8)
  expect(e1 - s1).toBeLessThanOrEqual(60)
  const [s2, e2] = rowsInView(off, 0, 10_000)
  expect(e2 - s2).toBe(60)
  expect(rowsInView(offsetsOf([]), 0, 600)).toEqual([0, 0])
  // Строка ниже окна — минимальный сдвиг; по центру — в середине.
  expect(scrollFor(off, 20, 0, 400)).toBe(off[21]! - 400)
  expect(scrollFor(off, 5, 0, 400)).toBe(0)
  const c = scrollFor(off, 100, 0, 400, 'center')
  expect(Math.abs(c + 200 - (off[100]! + off[101]!) / 2)).toBeLessThanOrEqual(1)
})

