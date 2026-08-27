import { expect, mock, test } from 'bun:test'

mock.module('../ipc/tauri', () => ({ hasTauri: () => false }))
mock.module('../ipc/commands', () => ({
  cfSearch: async () => [],
  listContent: async () => [],
  listWorldInstalls: async () => [],
}))
mock.module('../lib/api', () => ({ MODRINTH_API: 'https://modrinth.test', mirrorAsset: (u: string) => u }))
mock.module('./profiles', () => ({ useProfiles: { getState: () => ({ profiles: [], selected: '' }) } }))

const { useMods } = await import('./mods')

const hit = (title: string) => ({
  title,
  author: 'a',
  description: 'd',
  downloads: 0,
  icon_url: '',
  display_categories: [],
  slug: title,
  project_id: title,
})

const answer = (title: string, delayMs: number) =>
  new Promise((resolve) =>
    setTimeout(() => resolve({ json: async () => ({ hits: [hit(title)], total_hits: 1 }) }), delayMs),
  )

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Вход → вердикт: медленный ответ набранного запроса приходит ПОСЛЕ быстрого
// ответа очищенного. Закреплено потому, что без сторожа последовательности
// каталог возвращал находки в пустой поиск, и это чинилось только перезапуском.
test('поздний ответ набранного запроса не перетирает результат очищенного поиска', async () => {
  globalThis.fetch = ((url: string) =>
    url.includes('&query=') ? answer('находка старого запроса', 120) : answer('лента без запроса', 5)) as never

  useMods.setState({ modSource: 'modrinth', modTab: 'mod', mq: 'iris', hits: [] })
  const typed = useMods.getState().load()
  await wait(20)

  useMods.setState({ mq: '' })
  await useMods.getState().load()
  await typed

  expect(useMods.getState().hits.map((h) => h.title)).toEqual(['лента без запроса'])
})
