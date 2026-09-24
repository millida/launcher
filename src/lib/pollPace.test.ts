import { expect, test } from 'bun:test'
import {
  POLL_AFTER_WAIT_MS,
  POLL_BASE_MS,
  POLL_FAIL_MAX_MS,
  POLL_HIDDEN_MIN_MS,
  POLL_SERVER_MAX_MS,
  pollDelayMs,
  pollIntervalFrom,
} from './pollPace'

// Вход → вердикт. Закреплено потому, что опрос друзей шёл раз в 5 секунд всегда
// и при сбое площадки стучался в том же темпе, усиливая аварию.
const intervals: Array<[string, unknown, number]> = [
  ['сервер молчит — прежняя частота', undefined, POLL_BASE_MS],
  ['ноль не останавливает опрос', 0, POLL_BASE_MS],
  ['мусор не останавливает опрос', 'потом', POLL_BASE_MS],
  ['отрицательное значение отвергнуто', -1000, POLL_BASE_MS],
  ['значение сервера принято', 20_000, 20_000],
  ['слишком частое подтянуто к минимуму', 500, POLL_BASE_MS],
  ['слишком редкое срезано до потолка', 600_000, POLL_SERVER_MAX_MS],
]

for (const [name, input, expected] of intervals) {
  test(`интервал: ${name}`, () => {
    expect(pollIntervalFrom(input)).toBe(expected)
  })
}

test('пауза равна названной сервером, с разбросом не больше пятой части', () => {
  expect(pollDelayMs(20_000, 0, false, () => 0.5)).toBe(20_000)
  expect(pollDelayMs(20_000, 0, false, () => 0)).toBe(16_000)
  expect(pollDelayMs(20_000, 0, false, () => 1)).toBe(24_000)
})

test('скрытое окно опрашивает не чаще раза в 30 секунд', () => {
  expect(pollDelayMs(POLL_BASE_MS, 0, true, () => 0.5)).toBe(POLL_HIDDEN_MIN_MS)
})

test('пауза растёт с каждой ошибкой и упирается в потолок', () => {
  const steps = [1, 2, 3, 4, 5, 9].map((f) => pollDelayMs(POLL_BASE_MS, f, false, () => 0.5))
  expect(steps).toEqual([5_000, 10_000, 20_000, 40_000, POLL_FAIL_MAX_MS, POLL_FAIL_MAX_MS])
})

test('после ответа, который сервер держал, переспрос почти сразу', () => {
  expect(pollDelayMs(20_000, 0, false, () => 0.5, true)).toBe(POLL_AFTER_WAIT_MS)
})

test('метка «ждал» не отменяет паузу после ошибки — иначе сбой превратится в шторм', () => {
  expect(pollDelayMs(20_000, 3, false, () => 0.5, true)).toBe(20_000)
})

test('в скрытом окне метка «ждал» не ускоряет опрос', () => {
  expect(pollDelayMs(POLL_BASE_MS, 0, true, () => 0.5, true)).toBe(POLL_HIDDEN_MIN_MS)
})

test('разброс есть всегда — иначе лаунчеры вернутся одной волной', () => {
  const values = new Set([0, 0.25, 0.75, 1].map((r) => pollDelayMs(10_000, 0, false, () => r)))
  expect(values.size).toBeGreaterThan(1)
})
