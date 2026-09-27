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
  const at = Number(store.get('m-gpu-lite-at'))
  expect(g.liteFrom(at, at + 6 * 24 * 3600 * 1000)).toBe(true)
  expect(g.liteFrom(at, at + 8 * 24 * 3600 * 1000)).toBe(false)
  expect(g.liteFrom(0, Date.now())).toBe(false)
})

const MIN = 60 * 1000
const HOUR = 60 * MIN

// 27.09.2026: у владельца пропали анимации и звуки сундуков — лёгкая графика
// включилась без сбоя видеокарты. Вторая потеря контекста за сеанс считалась
// сбоем, а контексты теряются и без него: сон ноутбука (лаунчер живёт в трее
// сутками), вытеснение старого контекста браузером при создании нового.
test('сбоем считается только вторая потеря контекста за минуты, не вытеснение и не сон', () => {
  const cases: [string, [number, 'lost' | 'created'][], boolean][] = [
    ['одна потеря — не сбой', [[0, 'lost']], false],
    ['сон ночью и утром: два пробуждения часами врозь', [[0, 'lost'], [8 * HOUR, 'lost']], false],
    ['пробуждение теряет все холсты сразу — это одно событие', [[0, 'lost'], [200, 'lost'], [900, 'lost']], false],
    ['новый холст вытеснил старый — не сбой', [[0, 'lost'], [2 * MIN, 'created'], [2 * MIN + 300, 'lost']], false],
    ['вытеснения при каждом заходе в гардероб', [[0, 'created'], [100, 'lost'], [MIN, 'created'], [MIN + 100, 'lost']], false],
    ['видеокарта падает снова через минуту — сбой', [[0, 'lost'], [MIN, 'lost']], true],
    ['лобби пересоздало холст, видеокарта упала позже — сбой', [[0, 'lost'], [100, 'created'], [MIN, 'lost']], true],
  ]
  for (const [why, steps, lite] of cases) {
    store.clear()
    g._resetGpuLite()
    const base = 1_000_000_000_000
    for (const [at, what] of steps) {
      if (what === 'lost') g.noteContextLost(base + at)
      else g.noteContextCreated(base + at)
    }
    expect([why, g.gpuLite()]).toEqual([why, lite])
  }
})

test('старая отметка лёгкой графики, поставленная прежним правилом, снимается', () => {
  store.set('m-gpu-lite', String(Date.now()))
  expect(g.gpuLite()).toBe(false)
  expect(store.has('m-gpu-lite')).toBe(false)
})

test('включение лёгкой графики будит подписчиков один раз', () => {
  let flips = 0
  const off = g.onGpuLite(() => flips++)
  g.noteContextLost(1000)
  g.noteContextLost(1000 + 2 * MIN)
  g.noteContextLost(1000 + 3 * MIN)
  expect(flips).toBe(1)
  off()
})
