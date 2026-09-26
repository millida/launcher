import { describe, expect, test } from 'bun:test'
import { PLUS_PASS } from './chestDrops'
import { seasonCell, TRACK_DAYS } from './track'

/*
 * PLUS → ни одной вещи (владелец, 25.09.2026). До этого 7/14/21/28-я клетки
 * линии PLUS обещали расцветку сезона навсегда, а карточка PLUS в магазине —
 * «×4 расцветки навсегда». Прогноз клиента — копия SEASON_TRACK службы
 * (rubies.catalog.ts): разойдутся — лента пообещает не то, что придёт.
 */
describe('линия PLUS без вещей', () => {
  const SEVENTH: { day: number; plus: unknown[] }[] = [
    { day: 7, plus: [{ kind: 'SHARDS', amount: 60 }] },
    { day: 14, plus: [{ kind: 'SHARDS', amount: 175 }] },
    { day: 21, plus: [{ kind: 'SHARDS', amount: 60 }] },
    { day: 28, plus: [{ kind: 'SHARDS', amount: 480 }, { kind: 'CHEST', tier: 'LEGEND' }] },
  ]
  for (const { day, plus } of SEVENTH) {
    test('клетка ' + day + ' → осколки вместо расцветки, как у службы', () => {
      expect(seasonCell(day).plus).toEqual(plus as never)
    })
  }

  test('ни в одной клетке прогноза нет вещи', () => {
    const withItem: string[] = []
    for (let n = 1; n <= TRACK_DAYS; n++) {
      const cell = seasonCell(n)
      if (cell.free.some((r) => r.kind === 'ITEM')) withItem.push(n + ':free')
      if (cell.plus.some((r) => r.kind === 'ITEM')) withItem.push(n + ':plus')
    }
    expect(withItem).toEqual([])
  })

  test('карточка PLUS обещает только рубины, сундуки и множитель осколков', () => {
    expect(Object.keys(PLUS_PASS).sort()).toEqual(['chests', 'rubies', 'rubiesCap', 'shardBoost'])
  })
})
