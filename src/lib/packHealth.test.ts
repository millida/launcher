import { expect, test } from 'bun:test'
import { healthLine } from './packHealth'
import type { PackHealth } from './packHealth'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const h = (over: Partial<PackHealth>): PackHealth => ({
  slug: 'arcania',
  status: 'ok',
  launches: 120,
  successPct: 97,
  lastOkAt: '2026-09-25T10:00:00Z',
  ...over,
})

test('здоровая сборка: время и процент', () => {
  expect(healthLine(h({}), NOW)).toEqual({
    tone: 'ok',
    head: 'Работает',
    when: 'запускали 2 ч назад',
    pct: 97,
    report: false,
  })
})

test('мало запусков: только время', () => {
  expect(healthLine(h({ successPct: null, lastOkAt: '2026-09-25T11:58:00Z' }), NOW)).toMatchObject({ when: 'запускали только что', pct: null })
})

test('ниже порога: предупреждение и кнопка', () => {
  const line = healthLine(h({ status: 'warn', successPct: 64 }), NOW)
  expect(line?.tone).toBe('warn')
  expect(line?.head).toBe('Бывают сбои')
  expect(line?.report).toBe(true)
})

test('нет данных — строки нет', () => {
  expect(healthLine(null, NOW)).toBeNull()
  expect(healthLine(h({ status: 'unknown' }), NOW)).toBeNull()
  expect(healthLine(h({ successPct: null, lastOkAt: null }), NOW)).toBeNull()
})

test('давний запуск — в днях', () => {
  expect(healthLine(h({ lastOkAt: '2026-09-22T12:00:00Z' }), NOW)?.when).toBe('запускали 3 дн назад')
})
