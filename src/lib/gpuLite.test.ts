import { beforeEach, expect, test } from 'bun:test'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage

const g = await import('./gpuLite')

beforeEach(() => {
  store.clear()
  g._resetGpuLite()
})

// 25.09.2026: окно 2.0.x падало на сбое видеокарты и после перезагрузки снова
// создавало WebGL — у одного игрока 8–11 падений подряд.
test('после сбоя видеокарты лаунчер неделю рисует без WebGL', () => {
  expect(g.gpuLite()).toBe(false)
  g.noteGpuCrash()
  expect(g.gpuLite()).toBe(true)
  const at = Number(store.get('m-gpu-lite'))
  expect(g.liteFrom(at, at + 6 * 24 * 3600 * 1000)).toBe(true)
  expect(g.liteFrom(at, at + 8 * 24 * 3600 * 1000)).toBe(false)
  expect(g.liteFrom(0, Date.now())).toBe(false)
})

test('одна потеря контекста — не сбой, вторая за сеанс — лёгкая графика', () => {
  let flips = 0
  const off = g.onGpuLite(() => flips++)
  g.noteContextLost()
  expect(g.gpuLite()).toBe(false)
  g.noteContextLost()
  expect(g.gpuLite()).toBe(true)
  expect(flips).toBe(1)
  off()
})
