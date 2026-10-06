import { expect, test } from 'bun:test'
import type { MilliItem } from '../../lib/milli'
import { excludedWhy, needsOf, orphansOf, packTree } from './milliPackTree'

const it = (projectId: string, title: string, base = false, why = '', extra: Partial<MilliItem> = {}): MilliItem => ({
  projectId,
  slug: projectId,
  title,
  icon: null,
  why,
  base,
  source: 'modrinth',
  ...extra,
})

test('библиотека встаёт под свой мод по «Нужен для …», основа без хозяина — отдельно', () => {
  const zombie = it('z', 'Zombie Awareness')
  const coro = it('c', 'CoroUtil', true, 'Нужен для Zombie Awareness')
  const sodium = it('s', 'Sodium', true, 'Больше FPS')
  const t = packTree([zombie, coro, sodium])
  expect(t.deps.get('z')?.map((m) => m.title)).toEqual(['CoroUtil'])
  expect(t.core.map((m) => m.title)).toEqual(['Sodium'])
  expect(needsOf(t, zombie, [zombie, coro, sodium]).map((m) => m.title)).toEqual(['CoroUtil'])
})

test('requiredBy с сервера важнее текста, библиотека библиотеки уходит к корню', () => {
  const a = it('a', 'Arthropod Phobia')
  const b = it('b', 'Grim & Bleak')
  const gecko = it('g', 'GeckoLib', true, 'Нужен для кого-то', { requiredBy: ['a', 'b'] })
  const deep = it('d', 'Deep Lib', true, 'Нужен для GeckoLib')
  const t = packTree([a, b, gecko, deep])
  expect(t.parents.get('g')?.map((m) => m.title)).toEqual(['Arthropod Phobia', 'Grim & Bleak'])
  expect(t.deps.get('a')?.map((m) => m.title)).toEqual(['GeckoLib', 'Deep Lib'])
})

test('убрали все моды библиотеки — она лишняя; закреплённую не трогаем', () => {
  const a = it('a', 'A')
  const lib = it('l', 'Lib', true, 'Нужен для A')
  const t = packTree([a, lib])
  const off = new Set(['a'])
  expect(orphansOf(t, (m) => !off.has(m.projectId), () => false).map((m) => m.title)).toEqual(['Lib'])
  expect(orphansOf(t, (m) => !off.has(m.projectId), () => true)).toEqual([])
})

test('причина «не вошёл» — по-русски, с виновником', () => {
  expect(excludedWhy({ reason: 'dep_version', detail: 'нет GeckoLib под 1.20.1 forge' })).toEqual({
    why: 'Не нашлось подходящей зависимости',
    cause: 'Требует GeckoLib — его нет под 1.20.1 Forge',
  })
  expect(excludedWhy({ reason: 'crash', detail: 'Вылетает вместе с «Mod A»' }).why).toBe('Вылетает при запуске')
  expect(excludedWhy({ reason: 'новое', detail: 'Что-то иное' })).toEqual({ why: 'Что-то иное', cause: '' })
})
