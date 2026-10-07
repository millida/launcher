import { expect, test } from 'bun:test'
import { rowWindow } from './useVirtualRows'

test('виртуальная сетка: только ряды в окне и запас вокруг', () => {
  // 700 вещей по 6 в ряд, ряд 240 px, окно 800 px с прокрутки 2400.
  const w = rowWindow({ count: 700, cols: 6, rowH: 240, top: 2400, height: 800, overscan: 2 })
  expect(w.rows).toBe(117)
  expect(w.start).toBe(8)
  expect(w.end).toBe(16)
  expect((w.end - w.start) * 6).toBeLessThan(60)
  // Сетка ниже окна: рисуется только запас сверху.
  expect(rowWindow({ count: 700, cols: 6, rowH: 240, top: -900, height: 800, overscan: 2 }).end).toBe(2)
})
