import { beforeEach, expect, mock, test } from 'bun:test'

let tauriPresent = true
const flag = globalThis as unknown as { __MEDIA_REMOTE__?: boolean }
let ready: Record<string, string> = {}
const fetched: string[][] = []
let answer: (names: string[]) => Record<string, string> = () => ({})

mock.module('../ipc/tauri', () => ({ hasTauri: () => tauriPresent, tauri: () => null }))
mock.module('../ipc/commands', () => ({
  convertFileSrc: (p: string) => 'asset://' + p,
  mediaReady: () => Promise.resolve(ready),
  mediaFetch: (names: string[]) => {
    fetched.push(names)
    return Promise.resolve(answer(names))
  },
}))

const media = await import('./media')

beforeEach(() => {
  media.resetMediaForTests()
  flag.__MEDIA_REMOTE__ = true
  tauriPresent = true
  ready = {}
  fetched.length = 0
  answer = () => ({})
})

// Вход → вердикт: окно просит файл, которого нет, — ядро один раз качает, адрес появляется, повторных просьб нет.
test('файл качается один раз, сколько бы компонентов его ни просили', async () => {
  answer = (names) => Object.fromEntries(names.map((n) => [n, '/cache/' + n]))
  expect(media.mediaUrl('music/a.mp3')).toBeNull()
  await Promise.all([media.ensureMedia(['music/a.mp3']), media.ensureMedia(['music/a.mp3'])])
  expect(fetched).toEqual([['music/a.mp3']])
  expect(media.mediaUrl('music/a.mp3')).toBe('asset:///cache/music/a.mp3')
  await media.ensureMedia(['music/a.mp3'])
  expect(fetched.length, 'уже лежит — просить незачем').toBe(1)
})

test('то, что уже в кэше, берётся без скачивания', async () => {
  ready = { 'bg/bg1.mp4': '/cache/bg1.mp4' }
  await media.ensureMedia(['bg/bg1.mp4'])
  expect(fetched).toEqual([])
  expect(media.mediaUrl('bg/bg1.mp4')).toBe('asset:///cache/bg1.mp4')
})

test('неудача не повторяется чаще раза в минуту; адреса нет, окно живёт с заглушкой', async () => {
  await media.ensureMedia(['music/lost.mp3'])
  await media.ensureMedia(['music/lost.mp3'])
  expect(fetched.length).toBe(1)
  expect(media.mediaUrl('music/lost.mp3')).toBeNull()
})

test('пакет картинок просят одним именем, и его файлы появляются все сразу', async () => {
  answer = () => ({ 'packs/arcania/boss-malora.webp': '/c/a.webp', 'packs/arcania/world/map.webp': '/c/m.webp' })
  const before = useTick()
  await media.ensureMedia(['@arcania-art'])
  expect(media.mediaUrl('packs/arcania/boss-malora.webp')).toBe('asset:///c/a.webp')
  expect(media.mediaUrl('packs/arcania/world/map.webp')).toBe('asset:///c/m.webp')
  expect(useTick(), 'перерисовка компонентов запрошена').toBeGreaterThan(before)
  await media.ensureMedia(['@arcania-art'])
  expect(fetched.length, 'выданный пакет повторно не просят').toBe(1)
})

test('вне приложения (браузер разработки) файлы отдаёт vite по /media/', () => {
  tauriPresent = false
  expect(media.mediaUrl('music/a.mp3')).toBe('/media/music/a.mp3')
})

function useTick(): number {
  return media.useMediaStore.getState().tick
}

// Вход → вердикт: пока объекты не залиты на CDN, сборка идёт без MEDIA_REMOTE, и файлы лежат внутри неё.
test('сборка без MEDIA_REMOTE: файлы внутри сборки, ядро не зовут и ничего не ждут', async () => {
  flag.__MEDIA_REMOTE__ = false
  answer = (names) => Object.fromEntries(names.map((n) => [n, '/cache/' + n]))
  expect(media.mediaRemote()).toBe(false)
  expect(media.mediaUrl('music/a.mp3'), 'в приложении тот же адрес, что в браузере: файл в сборке').toBe('/media/music/a.mp3')
  expect(media.mediaUrl('bg/bg1.mp4')).toBe('/media/bg/bg1.mp4')
  await media.ensureMedia(['music/a.mp3', 'bg/', '@arcania-art'])
  await media.primeMedia()
  expect(fetched.length, 'в сборке без MEDIA_REMOTE ядро ничего не качает').toBe(0)
})

test('сборка с MEDIA_REMOTE: в приложении адреса берутся у ядра, пока файла нет — null', () => {
  flag.__MEDIA_REMOTE__ = true
  expect(media.mediaRemote()).toBe(true)
  expect(media.mediaUrl('music/a.mp3')).toBeNull()
})

test('без определения флага (тесты, старые сборки) файлы считаются внутри сборки', () => {
  delete flag.__MEDIA_REMOTE__
  expect(media.mediaRemote()).toBe(false)
  expect(media.mediaUrl('music/a.mp3')).toBe('/media/music/a.mp3')
})

// Н4 второго ревью: после сбоя компонент просит снова сам, а не ждёт пересоздания.
test('askUntilHave повторяет просьбу, пока файла нет, и перестаёт, когда он появился или компонент ушёл', async () => {
  let asked = 0
  let have = false
  const stop = media.askUntilHave(
    async () => {
      asked++
      if (asked === 3) have = true
    },
    () => have,
    5,
  )
  await new Promise((r) => setTimeout(r, 80))
  expect(asked, 'две неудачи, на третьей файл пришёл, дальше тишина').toBe(3)
  stop()

  let again = 0
  const stop2 = media.askUntilHave(async () => void again++, () => false, 5)
  await new Promise((r) => setTimeout(r, 40))
  stop2()
  const atStop = again
  expect(atStop).toBeGreaterThan(2)
  await new Promise((r) => setTimeout(r, 40))
  expect(again, 'ушёл с экрана — больше не просит').toBe(atStop)
})
