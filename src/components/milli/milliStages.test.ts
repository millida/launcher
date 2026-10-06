import { expect, test } from 'bun:test'
import { milliStagePercent, milliStageRows } from './MilliGlobe'

const st = (key: string, done = 0, total = 0) => ({ key, labelRu: key, done, total })

test('этапы: пройденные ✓, последний ▸, впереди ·', () => {
  const rows = milliStageRows([st('plan'), st('candidates'), st('select', 40, 270)])
  expect(rows.map((r) => [r.key, r.state])).toEqual([
    ['plan', 'done'],
    ['candidates', 'done'],
    ['select', 'run'],
    ['resolve', 'wait'],
    ['deps', 'wait'],
    ['conflicts', 'wait'],
    ['extras', 'wait'],
    ['enrich', 'wait'],
  ])
  expect(milliStageRows([])).toEqual([])
})

test('процент растёт по этапам и не доходит до 100', () => {
  const a = milliStagePercent([st('plan')])
  const b = milliStagePercent([st('plan'), st('select', 10, 270)])
  const c = milliStagePercent([st('plan'), st('select', 260, 270)])
  const d = milliStagePercent([st('plan'), st('select'), st('deps'), st('conflicts'), st('extras'), st('enrich', 9, 10)])
  expect(a).toBeLessThan(b)
  expect(b).toBeLessThan(c)
  expect(d).toBeLessThanOrEqual(97)
})

test('события не по порядку (как у сервера): идёт самый свежий, ранний «Подбираю» остаётся впереди', () => {
  const rows = milliStageRows([
    { ...st('plan', 1, 1), at: 3 },
    { ...st('select', 0, 0), at: 2 },
    { ...st('candidates', 1, 3), at: 5 },
  ])
  expect(rows.slice(0, 3).map((r) => [r.key, r.state])).toEqual([
    ['plan', 'done'],
    ['candidates', 'run'],
    ['select', 'wait'],
  ])
  const later = milliStageRows([
    { ...st('plan', 1, 1), at: 3 },
    { ...st('select', 150, 150), at: 6 },
    { ...st('candidates', 3, 3), at: 5 },
  ])
  expect(later.find((r) => r.state === 'run')?.key).toBe('select')
  expect(later.find((r) => r.key === 'candidates')?.state).toBe('done')
})

test('счётчики «найдено · проверено» и бегущие названия — свежие, без повторов, ≤5', async () => {
  const { milliTally, milliTickerNames } = await import('./MilliGlobe')
  const stages = [
    { ...st('candidates', 1, 3), at: 4, found: 120, sample: ['jei', 'jade'] },
    { ...st('select', 50, 150), at: 6, found: 412, checked: 138, sample: ['jei', 'create', 'the-mimicer', 'nyctophobia', 'appleskin', 'xaeros-minimap'] },
  ]
  expect(milliTally(stages)).toEqual({ found: 412, checked: 138 })
  expect(milliTally([st('plan')])).toEqual({ found: null, checked: null })
  const names = milliTickerNames(stages)
  expect(names).toHaveLength(5)
  expect(names[0]).toBe('xaeros-minimap')
  expect(new Set(names).size).toBe(names.length)
})

test('benchEdits: отмена ручной правки держится, «Вернула» возвращает, новая правка сбрасывает отменённое', async () => {
  const { benchEdits } = await import('./bench/BenchChanges')
  const ch = (titleRu: string, n = 1) => ({ changes: { titleRu, by: 'user' as const, added: [], removed: Array.from({ length: n }, (_, i) => ({ projectId: 'p' + i, title: 'T' + i, tab: 'mods' as const, by: 'user' as const })), changed: [] } })
  let r = benchEdits([ch('Ваши правки'), ch('Отмена')])
  expect([r.live.length, r.undone.length, r.ownUndone]).toEqual([0, 1, false])
  r = benchEdits([ch('Ваши правки'), ch('Отмена'), ch('Вернула')])
  expect([r.live.length, r.undone.length]).toEqual([1, 0])
  r = benchEdits([ch('Отмена')])
  expect(r.ownUndone).toBe(true)
  r = benchEdits([ch('Ваши правки'), ch('Отмена'), ch('Ваши правки')])
  expect([r.live.length, r.undone.length]).toEqual([1, 0])
})
