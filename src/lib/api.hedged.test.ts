import { expect, test } from 'bun:test'
import { HEDGE_WINDOW_MS, HedgeBudget, hedged } from './api'

const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const fresh = () => new HedgeBudget()

test('быстрый ответ — один запрос', async () => {
  let calls = 0
  const v = await hedged(() => (calls++, later(5, 'ok')), 40, fresh())
  expect(v).toBe('ok')
  await later(60, 0)
  expect(calls).toBe(1)
})

test('соединение зависло — уходит второй запрос, берём его ответ', async () => {
  let calls = 0
  const v = await hedged(() => (++calls === 1 ? new Promise<string>(() => {}) : later(5, 'second')), 30, fresh())
  expect(v).toBe('second')
  expect(calls).toBe(2)
})

test('быстрая ошибка возвращается сразу и без повтора', async () => {
  let calls = 0
  await expect(hedged(() => (calls++, Promise.reject(new Error('http 404'))), 30, fresh())).rejects.toThrow('http 404')
  await later(50, 0)
  expect(calls).toBe(1)
})

test('первый завис и потом упал, второй упал — ошибка', async () => {
  let calls = 0
  await expect(
    hedged(
      () => (++calls === 1 ? later(60, 0).then(() => Promise.reject(new Error('slow'))) : Promise.reject(new Error('fast'))),
      20,
      fresh(),
    ),
  ).rejects.toThrow()
  expect(calls).toBe(2)
})

test('API тормозит целиком — повторов не больше бюджета, нагрузка не удваивается', async () => {
  const budget = fresh()
  let calls = 0
  const slow = () => (calls++, later(40, 'late'))
  await Promise.all(Array.from({ length: 10 }, () => hedged(slow, 10, budget)))
  expect(calls, 'при общем замедлении каждый GET уходил дважды: 18.10 это удвоило поток и держало 503 полчаса').toBeLessThanOrEqual(12)
})

const budgetCases: { why: string; reads: number; hedgesBefore: number; advanceMs: number; allowed: boolean }[] = [
  { why: 'одиночный зависший запрос всё ещё спасается повтором', reads: 1, hedgesBefore: 0, advanceMs: 0, allowed: true },
  { why: 'пять чтений в минуту дают право только на один повтор', reads: 5, hedgesBefore: 1, advanceMs: 0, allowed: false },
  { why: 'двадцать процентов от десяти чтений — два повтора', reads: 10, hedgesBefore: 1, advanceMs: 0, allowed: true },
  { why: 'бюджет исчерпан на десяти чтениях', reads: 10, hedgesBefore: 2, advanceMs: 0, allowed: false },
  { why: 'через окно старые повторы забываются', reads: 5, hedgesBefore: 1, advanceMs: HEDGE_WINDOW_MS + 1, allowed: true },
]

for (const c of budgetCases) {
  test('бюджет повторов: ' + c.why, () => {
    let now = 1_000_000
    const budget = new HedgeBudget(() => now)
    for (let i = 0; i < c.reads; i++) budget.noteRead()
    for (let i = 0; i < c.hedgesBefore; i++) expect(budget.tryHedge(), 'подготовка кейса: ' + c.why).toBe(true)
    now += c.advanceMs
    if (c.advanceMs > 0) for (let i = 0; i < c.reads; i++) budget.noteRead()
    expect(budget.tryHedge(), c.why).toBe(c.allowed)
  })
}
