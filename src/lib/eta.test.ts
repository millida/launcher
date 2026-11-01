import { expect, test } from 'bun:test'
import { etaText } from './eta'

test('время до конца: секунды, минуты, часы; округление вверх; пусто, когда не известно', () => {
  expect(etaText(23, 'en')).toContain('25')
  expect(etaText(23, 'en')).toContain('sec')
  expect(etaText(100, 'en')).toContain('2')
  expect(etaText(100, 'en')).toContain('min')
  expect(etaText(3 * 3600, 'en')).toContain('3')
  expect(etaText(3 * 3600, 'en')).toContain('hr')
  expect(etaText(61, 'en')).toContain('65')
  expect(etaText(300, 'ru')).toContain('5')
  expect(etaText(0, 'en')).toBe('')
  expect(etaText(Number.NaN, 'en')).toBe('')
  expect(etaText(-4, 'en')).toBe('')
})
