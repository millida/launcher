import { expect, test } from 'bun:test'
import { hedged } from './api'

const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms))

test('быстрый ответ — один запрос', async () => {
  let calls = 0
  const v = await hedged(() => (calls++, later(5, 'ok')), 40)
  expect(v).toBe('ok')
  await later(60, 0)
  expect(calls).toBe(1)
})

test('соединение зависло — уходит второй запрос, берём его ответ', async () => {
  let calls = 0
  const v = await hedged(() => (++calls === 1 ? new Promise<string>(() => {}) : later(5, 'second')), 30)
  expect(v).toBe('second')
  expect(calls).toBe(2)
})

test('быстрая ошибка возвращается сразу и без повтора', async () => {
  let calls = 0
  await expect(hedged(() => (calls++, Promise.reject(new Error('http 404'))), 30)).rejects.toThrow('http 404')
  await later(50, 0)
  expect(calls).toBe(1)
})

test('первый завис и потом упал, второй упал — ошибка', async () => {
  let calls = 0
  await expect(
    hedged(() => (++calls === 1 ? later(60, 0).then(() => Promise.reject(new Error('slow'))) : Promise.reject(new Error('fast'))), 20),
  ).rejects.toThrow()
  expect(calls).toBe(2)
})
