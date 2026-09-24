import { beforeEach, expect, test } from 'bun:test'

import { cachedCatalog, clearCatalogCache, peekCatalog } from './catalogCache'

beforeEach(() => clearCatalogCache())

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Вход → вердикт: два одинаковых запроса подряд → апстрим спрошен один раз.
// Закреплено потому, что ради этого кэш и заводился: переключение вкладки
// каталога — это повтор запроса, который лаунчер уже делал минуту назад.
test('повторный запрос за тем же ключом идёт из кэша', async () => {
  let calls = 0
  const load = async () => {
    calls++
    return 'ответ'
  }

  expect(await cachedCatalog('k', load)).toBe('ответ')
  expect(await cachedCatalog('k', load)).toBe('ответ')
  expect(calls).toBe(1)
})

// Вход → вердикт: два запроса в одном кадре, ответа ещё нет → одно обращение.
// Кэш начинает помогать только ПОСЛЕ первого ответа: вкладка и предзагрузка
// соседних вкладок легко просят одно и то же до него.
test('одновременные запросы склеиваются в один', async () => {
  let calls = 0
  const load = async () => {
    calls++
    await wait(20)
    return calls
  }

  const [a, b] = await Promise.all([cachedCatalog('k', load), cachedCatalog('k', load)])

  expect(calls).toBe(1)
  expect([a, b]).toEqual([1, 1])
})

// Вход → вердикт: разные ключи → разные ответы. Иначе вкладка «Моды» показала
// бы выдачу вкладки «Сборки», а это хуже любого ожидания.
test('разные ключи не путаются между собой', async () => {
  expect(await cachedCatalog('mod', async () => 'моды')).toBe('моды')
  expect(await cachedCatalog('modpack', async () => 'сборки')).toBe('сборки')
  expect(peekCatalog<string>('mod')).toBe('моды')
})

// Вход → вердикт: первый запрос упал, второй прошёл → второй идёт в сеть и
// отдаёт ответ. Сбой в кэше запер бы вкладку до перезапуска лаунчера.
test('сбой не кэшируется и не запирает ключ', async () => {
  await expect(
    cachedCatalog('k', async () => {
      throw new Error('сеть недоступна')
    }),
  ).rejects.toThrow('сеть недоступна')

  expect(peekCatalog('k')).toBeUndefined()
  expect(await cachedCatalog('k', async () => 'ответ')).toBe('ответ')
})
