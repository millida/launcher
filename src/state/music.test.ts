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

mock.module('../ipc/tauri', () => ({ hasTauri: () => false, tauri: () => null }))
mock.module('../ipc/commands', () => ({
  convertFileSrc: (p: string) => p,
  downloadMcMusic: () => Promise.resolve(),
  musicTracks: () => Promise.resolve([]),
  musicAdd: () => Promise.resolve({ added: 0, too_big: [] }),
  musicRemove: () => Promise.resolve(),
  openMusicFolder: () => Promise.resolve(),
}))
mock.module('../ipc/events', () => ({ listenWindowVisibility: () => Promise.resolve(null) }))
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

mus.initMusic()
await new Promise((r) => setTimeout(r, 500))
const el = () => audios[0]
const fire = (name: string) => (handlers[name] || []).forEach((fn) => fn())

function ready() {
  useMusic.setState({
    tracks: [{ src: '/music/ambient.mp3', title: 'test' }],
    index: 0,
    level: 50,
    muted: false,
    playing: false,
  })
}

// Вход → вердикт. Каждый кейс закреплён за реальной жалобой: пауза, которую
// нажал пользователь, обязана пережить любое автоматическое возобновление.
test('пауза срабатывает и после того, как трек уже ставили на паузу', async () => {
  mus.stopMusicNow()
  ready()

  useMusic.getState().togglePlay()
  await wait(1100)
  expect(el().paused).toBe(false)

  useMusic.getState().togglePlay()
  await wait(1100)
  expect(el().paused).toBe(true)

  useMusic.getState().togglePlay()
  await wait(1100)
  expect(el().paused).toBe(false)

  useMusic.getState().togglePlay()
  await wait(1100)
  expect(el().paused, 'вторая пауза обязана остановить проигрывание').toBe(true)
}, 20000)

test('ручная пауза не отменяется возвратом окна из трея', async () => {
  mus.stopMusicNow()
  ready()

  useMusic.getState().togglePlay()
  await wait(1100)
  mus.suspendMusic()
  await wait(400)
  expect(el().paused, 'уход в трей глушит музыку').toBe(true)

  useMusic.getState().togglePlay()
  await wait(1100)
  useMusic.getState().togglePlay()
  await wait(1100)
  expect(el().paused).toBe(true)

  mus.resumeMusic()
  await wait(1100)
  expect(el().paused, 'показ окна не должен снимать паузу, которую поставил пользователь').toBe(true)
  expect(useMusic.getState().playing).toBe(false)
}, 20000)

test('ручная пауза во время игры не отменяется выходом из игры', async () => {
  mus.stopMusicNow()
  ready()

  useMusic.getState().togglePlay()
  await wait(1100)
  fire('mc-started')
  await wait(1100)
  expect(el().paused, 'запуск игры глушит музыку').toBe(true)

  useMusic.getState().togglePlay()
  await wait(1100)
  useMusic.getState().togglePlay()
  await wait(1100)

  fire('mc-stopped')
  await wait(1100)
  expect(el().paused, 'выход из игры не должен снимать ручную паузу').toBe(true)
  expect(useMusic.getState().playing).toBe(false)
}, 20000)

test('автопауза игры возвращает музыку, если пользователь её не трогал', async () => {
  mus.stopMusicNow()
  ready()

  useMusic.getState().togglePlay()
  await wait(1100)
  fire('mc-started')
  await wait(1100)
  expect(el().paused).toBe(true)

  fire('mc-stopped')
  await wait(1100)
  expect(el().paused, 'после игры музыка обязана вернуться').toBe(false)

  useMusic.getState().togglePlay()
  await wait(1100)
}, 20000)

test('пауза переживает перезапуск: автостарт молчит', async () => {
  mus.stopMusicNow()
  ready()

  useMusic.getState().togglePlay()
  await wait(1100)
  useMusic.getState().togglePlay()
  await wait(1100)
  expect(prefs['m-mus-play']).toBe('0')

  mus.startMusicAfterLogin()
  await wait(1100)
  expect(el().paused, 'автостарт не должен включать музыку после ручной паузы').toBe(true)

  useMusic.getState().togglePlay()
  await wait(1100)
  expect(prefs['m-mus-play']).toBe('1')
  mus.startMusicAfterLogin()
  await wait(1100)
  expect(el().paused, 'после ручного запуска автостарт снова разрешён').toBe(false)
}, 20000)

// Радио Millida и своя музыка: вход (радио, свои треки, что играло) → какой
// плейлист и что звучит. Закреплено за просьбой владельца 05.10.2026: дефолт
// можно выключить и крутить только своё.
test('радио выключено — в плейлисте только свои треки, играющий свой трек не сбивается', async () => {
  mus.stopMusicNow()
  const own = [
    { src: 'asset://own/a.mp3', title: 'a', file: 'a.mp3' },
    { src: 'asset://own/b.mp3', title: 'b', file: 'b.mp3' },
  ]
  useMusic.setState({ radio: true, own, tracks: [...mus.RADIO, ...own], index: mus.RADIO.length + 1, level: 50, muted: false, playing: true, loaded: true })

  useMusic.getState().setRadio(false)
  const s = useMusic.getState()
  expect(prefs['m-mus-radio'], 'выбор должен пережить перезапуск').toBe('0')
  expect(s.tracks.map((t) => t.src), 'встроенные треки должны уйти из плейлиста').toEqual(['asset://own/a.mp3', 'asset://own/b.mp3'])
  expect(s.tracks[s.index]?.src, 'смена плейлиста не должна перебивать трек, который сейчас слушают').toBe('asset://own/b.mp3')
  expect(s.playing).toBe(true)
})

test('радио выключено и своих треков нет — музыка честно выключена', async () => {
  mus.stopMusicNow()
  useMusic.setState({ radio: true, own: [], tracks: [...mus.RADIO], index: 2, level: 50, muted: false, playing: true, loaded: true })

  useMusic.getState().setRadio(false)
  expect(useMusic.getState().tracks).toEqual([])
  expect(mus.radioOn(useMusic.getState()), 'кнопка музыки не должна гореть, когда играть нечего').toBe(false)

  useMusic.getState().setRadio(true)
  expect(useMusic.getState().tracks.length, 'включение радио возвращает встроенный плейлист').toBe(mus.RADIO.length)
  expect(prefs['m-mus-radio']).toBe('1')
})

test('«предыдущий» с первого трека уходит на последний, а не в пустоту', () => {
  mus.stopMusicNow()
  useMusic.setState({ tracks: [...mus.RADIO], index: 0, level: 50, muted: false, playing: false, loaded: true })
  useMusic.getState().prev()
  expect(useMusic.getState().index, 'плейлист идёт по кругу в обе стороны').toBe(mus.RADIO.length - 1)
  useMusic.getState().prev()
  expect(useMusic.getState().index).toBe(mus.RADIO.length - 2)
})
