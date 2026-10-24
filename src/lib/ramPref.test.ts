import { afterEach, describe, expect, test } from 'bun:test'
import { ramGbOf, ramPrefKey, setLaunchRamMb } from './ramPref'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

afterEach(() => localStorage.removeItem(ramPrefKey('Big')))

describe('кнопки памяти меняют то, что берёт запуск', () => {
  test('6144 МБ из окна вылета — 6 ГБ на ползунке', () => {
    expect(setLaunchRamMb('Big', 6144)).toBe(true)
    expect(localStorage.getItem(ramPrefKey('Big'))).toBe('6')
  })
  test('мусор из ядра не затирает ползунок', () => {
    localStorage.setItem(ramPrefKey('Big'), '4')
    expect(setLaunchRamMb('Big', Number('abc'))).toBe(false)
    expect(localStorage.getItem(ramPrefKey('Big'))).toBe('4')
  })
  test('округление до целых гигабайт, не ниже 1', () => {
    expect([ramGbOf(6600), ramGbOf(512)]).toEqual([6, 1])
  })
})
