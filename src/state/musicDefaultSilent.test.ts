import { expect, mock, test } from 'bun:test'

class FakeAudio {
  src = ''
  volume = 1
  currentTime = 0
  paused = true
  addEventListener() {}
  play() {
    this.paused = false
    return new Promise<void>((res) => setTimeout(res, 60))
  }
  pause() {
    this.paused = true
  }
}

const audios: FakeAudio[] = []
const prefs: Record<string, string> = {}
const handlers: Record<string, Array<() => void>> = {}

Object.defineProperty(globalThis, '__HAS_BUNDLED_MUSIC__', { value: true, configurable: true })
Object.defineProperty(globalThis, 'location', { value: { href: 'http://localhost/' }, configurable: true })
Object.defineProperty(globalThis, 'Audio', {
  value: class {
    constructor() {
      const a = new FakeAudio()
      audios.push(a)
      return a as unknown as HTMLAudioElement
    }
  },
  configurable: true,
})
Object.defineProperty(globalThis, 'document', { value: { addEventListener() {}, removeEventListener() {} }, configurable: true })
Object.defineProperty(globalThis, 'window', {
  value: {
    addEventListener(name: string, fn: () => void) {
      handlers[name] = (handlers[name] || []).concat(fn)
    },
    removeEventListener() {},
  },
  configurable: true,
})
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (k in prefs ? prefs[k] : null),
    setItem: (k: string, v: string) => {
      prefs[k] = v
    },
    removeItem: (k: string) => {
      delete prefs[k]
    },
  },
  configurable: true,
})

let tauriPresent = false
let showWindow: ((visible: boolean) => void) | null = null

mock.module('../ipc/tauri', () => ({ hasTauri: () => tauriPresent, tauri: () => null }))
mock.module('../ipc/commands', () => ({
  convertFileSrc: (p: string) => p,
  downloadMcMusic: () => Promise.resolve(),
  musicTracks: () => Promise.resolve([]),
  musicAdd: () => Promise.resolve({ added: 0, too_big: [] }),
  musicRemove: () => Promise.resolve(),
  openMusicFolder: () => Promise.resolve(),
  mainWindowVisible: () => Promise.resolve(false),
  mediaFetch: () => Promise.resolve({}),
  mediaReady: () => Promise.resolve({}),
}))
mock.module('../ipc/events', () => ({
  listenWindowVisibility: (fn: (visible: boolean) => void) => {
    showWindow = fn
    return Promise.resolve(null)
  },
}))
mock.module('./ui', () => ({ showToast() {}, useUi: { getState: () => ({ logged: true }) } }))
mock.module('../lib/prefs', () => ({
  hydratePrefs: () => Promise.resolve(),
  readPref: (k: string, d: string) => (k in prefs ? prefs[k] : d),
  writePref: (k: string, v: string) => {
    prefs[k] = v
  },
}))

const mus = await import('./music')
const { useMusic } = mus
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Новый игрок ничего не нажимал: радио не включается само ни на старте, ни при показе окна (WEAK-11,
// «лёгкий» лаунчер не должен играть сам). Выбор игрока запоминается и потом включает его.
tauriPresent = true
mus.initMusic()
await wait(400)

test('без выбора игрока радио молчит на старте и при показе окна', async () => {
  expect(useMusic.getState().playing).toBe(false)
  expect(audios[0]?.paused ?? true, 'аудио-элемент не играет').toBe(true)
  showWindow?.(true)
  await wait(1100)
  expect(useMusic.getState().playing, 'показ окна не запускает музыку, которую игрок не просил').toBe(false)
  expect(mus.musicAutostartOn()).toBe(false)
}, 10000)

test('первый запуск радио игроком запоминается: следующий старт играет сам', async () => {
  useMusic.setState({ tracks: [{ src: '/music/a.mp3', title: 'a' }], index: 0, level: 50, muted: false })
  useMusic.getState().togglePlay()
  await wait(300)
  expect(prefs['m-mus-play']).toBe('1')
  expect(mus.musicAutostartOn(), 'игрок запускал радио сам — выбор запомнен').toBe(true)
  useMusic.getState().togglePlay()
  await wait(1100)
  expect(mus.musicAutostartOn(), 'пауза игрока — автозапуска нет').toBe(false)
}, 10000)
