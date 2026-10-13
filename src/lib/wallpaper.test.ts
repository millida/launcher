import { beforeAll, expect, test } from 'bun:test'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const stored = new Map<string, string>()
const storage = {
  getItem: (k: string) => (stored.has(k) ? (stored.get(k) as string) : null),
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
}

let stills: typeof import('./wallpaper')
let state: typeof import('../state/wallpaper')

beforeAll(async () => {
  const scope = globalThis as unknown as Record<string, unknown>
  scope.__BUNDLED_VIDEOS__ = []
  scope.localStorage = storage
  scope.matchMedia = () => ({ matches: false })
  stored.set('m-wp', 'bg2')
  stored.set('m-wp-mode', 'random')
  stored.set('m-wp-seen', '1')
  stills = await import('./wallpaper')
  state = await import('../state/wallpaper')
})

const publicFile = (path: string) => fileURLToPath(new URL('../../public' + path, import.meta.url))

test('у каждой картинки галереи лежат и превью, и полный кадр', () => {
  for (const s of stills.STILLS) {
    expect(existsSync(publicFile(s.thumb)), s.name + ': без превью плитка в настройках пустая').toBe(true)
    expect(existsSync(publicFile(s.src)), s.name + ': без кадра игрок получит «Фон не открылся»').toBe(true)
    expect(
      statSync(publicFile(s.src)).size,
      s.name + ': кадр во всё окно, превью 480x270 на его месте даёт мыло',
    ).toBeGreaterThan(40_000)
  }
})

test('имена картинок галереи не пересекаются со сценой и своим фоном', () => {
  const ids = stills.STILLS.map((s) => s.id)
  expect(new Set(ids).size, 'две картинки под одним именем — выбрана будет первая').toBe(ids.length)
  for (const reserved of ['pixels', 'custom']) {
    expect(ids, reserved + ' занято: так хранится сцена и свой фон').not.toContain(reserved)
  }
})

test('возврат картинок не достаёт на экран выбор, забытый три недели назад', () => {
  expect(stored.get('m-wp'), 'после обновления у всех стоит сцена, как и было до него').toBe('pixels')
  expect(stored.get('m-wp-mode'), 'случайный фон при запуске тоже остался в прошлом').toBe('fixed')
  expect(state.useWallpaper.getState().wpCur).toBe('pixels')
})

test('какая картинка ложится под сцену', () => {
  const own = { kind: 'image', path: 'data:image/jpeg;base64,AAAA', name: 'моя' }
  const clip = { kind: 'video', path: 'C:/wallpaper/wp_1.mp4', name: 'ролик' }
  const cases: [string, { wpCur: string; custom: typeof own | null }, string | null, string][] = [
    ['сцена', { wpCur: 'pixels', custom: null }, null, 'сцена в цвет кнопок рисуется без картинки'],
    ['галерея', { wpCur: 'bg5', custom: null }, '/lobby/world.webp', 'картинка галереи берётся полным кадром, не превью'],
    ['убранная из галереи', { wpCur: 'bg1', custom: null }, null, 'имя, которого в галерее нет, даёт сцену, а не пустой экран'],
    ['свой фон', { wpCur: 'custom', custom: own }, own.path, 'своя картинка идёт как есть'],
    ['свой ролик', { wpCur: 'custom', custom: clip }, null, 'ролик холст не рисует: стоит сцена, а не чёрный фон'],
    ['свой фон без файла', { wpCur: 'custom', custom: null }, null, 'запись стёрта — стоит сцена'],
    ['своя картинка при выбранной галерее', { wpCur: 'bg4', custom: own }, '/bg/bg4-wide.webp', 'загруженная картинка не перебивает выбранную из галереи'],
  ]
  for (const [name, input, verdict, why] of cases) {
    expect(state.backdropOf(input), name + ': ' + why).toBe(verdict)
  }
})

test('удалён единственный свой фон — в лобби возвращается сцена', () => {
  const own = { kind: 'image', path: 'data:image/jpeg;base64,BBBB', name: 'моя' }
  state.useWallpaper.setState({ gallery: [own], custom: own, wpCur: 'custom' })
  state.useWallpaper.getState().removeCustom(own.path)
  expect(state.useWallpaper.getState().wpCur, 'раньше вставала картинка «У камина», которую никто не выбирал').toBe('pixels')
  expect(stored.get('m-wp')).toBe('pixels')
})
