import { expect, test } from 'bun:test'
import { sharedGet } from './api'

const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms))

test('два одинаковых запроса хостинга в пути — один вызов', async () => {
  let calls = 0
  const run = () => (calls++, later(10, 'ok'))
  const [a, b] = await Promise.all([sharedGet('/hosting/servers/me', '|', run), sharedGet('/hosting/servers/me', '|', run)])
  expect([a, b, calls]).toEqual(['ok', 'ok', 1])
  await sharedGet('/hosting/servers/me', '|', run)
  expect(calls).toBe(2)
})

test('чужие адреса не склеиваются', async () => {
  let calls = 0
  const run = () => (calls++, later(5, 'x'))
  await Promise.all([sharedGet('/catalog/packs', '|', run), sharedGet('/catalog/packs', '|', run)])
  expect(calls).toBe(2)
})

test('отказ не залипает', async () => {
  let n = 0
  const run = () => (++n === 1 ? Promise.reject(new Error('boom')) : later(1, 'ok'))
  await expect(sharedGet('/vds/me/machines', '|', run)).rejects.toThrow('boom')
  expect(await sharedGet('/vds/me/machines', '|', run)).toBe('ok')
})
