import { expect, mock, test } from 'bun:test'

let hasTauriNow = false
let cfDelayMs = 0
let packsNow: unknown[] = []

mock.module('../ipc/tauri', () => ({ hasTauri: () => hasTauriNow }))
mock.module('../ipc/commands', () => ({
  cfSearch: async () => {
    if (cfDelayMs) await new Promise((r) => setTimeout(r, cfDelayMs))
    return []
  },
  listContent: async () => [],
  listWorldInstalls: async () => [],
  millidaPacks: async () => packsNow,
  packReviewQueue: async () => [],
}))
mock.module('../lib/api', () => ({ MODRINTH_API: 'https://modrinth.test', mirrorAsset: (u: string) => u }))
mock.module('./profiles', () => ({ useProfiles: { getState: () => ({ profiles: [], selected: '' }) } }))

const { useMods } = await import('./mods')
const { clearCatalogCache } = await import('../lib/catalogCache')

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

// Вход → вердикт: та же вкладка с теми же фильтрами открыта второй раз →
// в сеть не ходим. Закреплено потому, что каждое такое хождение шло через щит,
// где рукопожатие TLS временами застревает на секунды: игрок ждал шесть секунд
// ради выдачи, которую лаунчер уже показывал.
test('повторное открытие вкладки берёт выдачу из кэша', async () => {
  clearCatalogCache()
  let requests = 0
  globalThis.fetch = (() => {
    requests++
    return Promise.resolve({ json: async () => ({ hits: [hit('первая строка')], total_hits: 1 }) })
  }) as never

  useMods.setState({ modSource: 'modrinth', modTab: 'resourcepack', mq: '', hits: [] })
  await useMods.getState().load()
  useMods.setState({ hits: [] })
  await useMods.getState().load()

  expect(requests).toBe(1)
  expect(useMods.getState().hits.map((h) => h.title)).toEqual(['первая строка'])
})

// Вход → вердикт: оба чужих каталога отвечают по 120 мс → выдача готова
// примерно через 120 мс, а не через 240. Закреплено потому, что раньше
// CurseForge дожидались до конца и только потом начинали Modrinth, и ожидание
// игрока было суммой двух походов в сеть.
test('CurseForge и Modrinth спрашиваются разом, а не по очереди', async () => {
  clearCatalogCache()
  cfDelayMs = 120
  hasTauriNow = true
  globalThis.fetch = (() =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ json: async () => ({ hits: [hit('modrinth')], total_hits: 1 }) }), 120),
    )) as never

  useMods.setState({ modSource: 'all', modTab: 'mod', mq: '', hits: [] })
  const started = Date.now()
  await useMods.getState().load()
  const spent = Date.now() - started

  hasTauriNow = false
  cfDelayMs = 0
  expect(spent).toBeLessThan(220)
  expect(useMods.getState().hits.length).toBeGreaterThan(0)
})

// Вход → вердикт: чья работа, того и подпись. Сборки каталога собирали не мы, и
// своё имя под ними было бы присвоением чужого труда; у кого автор не указан,
// подписи нет вовсе, а не «Millida» по умолчанию.
test('сборка подписана своим автором, а без автора не подписана никем', async () => {
  hasTauriNow = true
  packsNow = [
    { slug: 'komam', title: 'KoMaM', summary: '', cover: null, downloads: 0, game: '1.20.1', loader: 'forge', accessRequired: true, hasServer: false, author: 'MCSborki' },
    { slug: 'arcania', title: 'Arcania', summary: '', cover: null, downloads: 0, game: '1.20.1', loader: 'forge', accessRequired: true, hasServer: false, author: null },
  ]
  clearCatalogCache()
  useMods.setState({ modTab: 'millida', mq: '', hits: [] })
  await useMods.getState().load()
  await wait(30)

  const by = new Map(useMods.getState().hits.map((h) => [h.title, h.author]))
  expect(by.get('KoMaM')).toBe('MCSborki')
  expect(by.get('Arcania'), 'без автора подпись пустая, а не наше имя').toBe('')
  hasTauriNow = false
  packsNow = []
})

// Вход → вердикт: во вкладке премиума видна только сборка по ключу. Иначе слово
// «премиум» стоит над бесплатными сборками, а платная теряется среди них.
test('во вкладке премиума только сборка по ключу доступа', async () => {
  hasTauriNow = true
  packsNow = [
    { slug: 'arcania', title: 'Arcania', summary: '', cover: null, downloads: 0, game: '1.20.1', loader: 'forge', accessRequired: true, hasServer: false },
    { slug: 'free', title: 'Обычная сборка', summary: '', cover: null, downloads: 0, game: '1.20.1', loader: 'fabric', accessRequired: false, hasServer: false },
  ]
  clearCatalogCache()
  useMods.setState({ modTab: 'millida', mq: '', hits: [] })
  await useMods.getState().load()
  await wait(30)

  const shown = useMods.getState().hits.map((h) => h.title)
  expect(shown, 'бесплатная сборка не должна называться премиумом').toEqual(['Arcania'])
  hasTauriNow = false
  packsNow = []
})
