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

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// 25.09.2026: окно 2.0.x падало на сбое видеокарты и после перезагрузки снова
// создавало WebGL — у одного игрока 8–11 падений подряд.
// 05.10.2026: с первого же сбоя 2D-скин стоял неделю у ~1050 установок, у 858
// сбой был единственным (часто — запуск или выход из игры).
test('без WebGL — только когда процесс видеокарты падает снова за минуты', () => {
  const cases: [string, number[], boolean][] = [
    ['один сбой, например при запуске игры — 3D остаётся', [0], false],
    ['сбои при запуске и выходе из игры часами врозь — не повтор', [0, 3 * HOUR], false],
    ['вчера и сегодня — не повтор', [0, DAY], false],
    ['окно перезагрузилось и упало снова через минуту — сбой', [0, MIN], true],
    ['петля падений после перезагрузки — сбой', [0, 5000, 10000], true],
  ]
  for (const [why, exits, lite] of cases) {
    store.clear()
    g._resetGpuLite()
    const base = 1_000_000_000_000
    for (const at of exits) g.noteGpuProcessExit(base + at)
    expect([why, g.gpuLite()]).toEqual([why, lite])
  }
})

test('время прошлого сбоя переживает перезагрузку страницы', () => {
  const base = 1_000_000_000_000
  expect(g.noteGpuProcessExit(base)).toBe(false)
  g._resetGpuLite()
  expect(g.noteGpuProcessExit(base + MIN)).toBe(true)
})

test('лёгкая графика держится неделю', () => {
  const at = 1_000_000_000_000
  expect(g.liteFrom(at, at + 6 * DAY)).toBe(true)
  expect(g.liteFrom(at, at + 8 * DAY)).toBe(false)
  expect(g.liteFrom(0, Date.now())).toBe(false)
})

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

test('отметки лёгкой графики, поставленные прежними правилами, снимаются', () => {
  for (const key of ['m-gpu-lite', 'm-gpu-lite-at']) {
    store.clear()
    g._resetGpuLite()
    store.set(key, String(Date.now()))
    expect([key, g.gpuLite()]).toEqual([key, false])
    expect([key, store.has(key)]).toEqual([key, false])
  }
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
