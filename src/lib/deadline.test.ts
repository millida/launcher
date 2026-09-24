import { expect, test } from 'bun:test'
import { inTime } from './deadline'

test('ответ в срок проходит как есть', async () => {
  expect(await inTime(Promise.resolve(7), 50)).toBe(7)
})

test('ошибка в срок остаётся той же ошибкой', async () => {
  await expect(inTime(Promise.reject(new Error('http 502')), 50)).rejects.toThrow('http 502')
})

test('зависший запрос превращается в ошибку, а не в вечные скелетоны', async () => {
  await expect(inTime(new Promise(() => {}), 20)).rejects.toThrow('timed out')
})
