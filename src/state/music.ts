import { create } from 'zustand'
import { listenWindowVisibility } from '../ipc/events'
import { showToast, useUi } from './ui'
import { hydratePrefs, readPref, writePref } from '../lib/prefs'
import { hasTauri } from '../ipc/tauri'
import { convertFileSrc, musicAdd, musicRemove, musicTracks, openMusicFolder } from '../ipc/commands'

const DEFAULT_LEVEL = 5

function storedLevel(): number {
  const v = parseInt(readPref('m-mus-vol', String(DEFAULT_LEVEL)), 10)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_LEVEL
}

const storedMuted = () => readPref('m-mus-muted', '0') === '1'

const storedPlaying = () => readPref('m-mus-play', '1') !== '0'

const storedRadio = () => readPref('m-mus-radio', '1') !== '0'

export interface Track {
  src: string
  title: string
  author?: string
  /** Лицензия и страница трека — для экрана «Авторы музыки» (CC BY требует указать автора). */
  license?: 'CC0 1.0' | 'CC BY 4.0'
  url?: string
  /** Имя файла в папке music — есть только у своих треков игрока. */
  file?: string
}

const SKIFF = 'https://ericskiff.com/music/'
const PPEAK = 'https://opengameart.org/content/free-action-chiptune-music-pack'
const JUNKALA = 'https://opengameart.org/content/5-chiptunes-action'
const ZANE = 'https://opengameart.org/content/starlight-city-loop-included'

/**
 * Радио Millida: чиптюн 115–160 BPM, мажор, громкость выровнена до −18 LUFS.
 * Первым всегда идёт «Starlight City» — с него лаунчер звучит при первом
 * запуске. Откуда треки и почему они — docs/MUSIC.md.
 */
export const RADIO: Track[] = [
  { src: '/music/01-starlight-city.mp3', title: 'Starlight City', author: 'Zane Little', license: 'CC0 1.0', url: ZANE },
  { src: '/music/02-chibi-ninja.mp3', title: 'Chibi Ninja', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
  { src: '/music/03-secret-base.mp3', title: 'Secret Base', author: 'PPEAK', license: 'CC BY 4.0', url: PPEAK },
  { src: '/music/04-jumpshot.mp3', title: 'Jumpshot', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
  { src: '/music/05-level-2.mp3', title: 'Level 2', author: 'Juhani Junkala', license: 'CC0 1.0', url: JUNKALA },
  { src: '/music/06-hhavok.mp3', title: 'HHavok', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
  { src: '/music/07-dizzy-spells.mp3', title: 'A Night Of Dizzy Spells', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
]

// Файлы лежат в public/music; сборка без медиа (чистый checkout) должна
// собираться — флаг ставит vite.config.ts по тому, что реально лежит на диске.
const BUNDLED: Track[] = __HAS_BUNDLED_MUSIC__ ? RADIO : []

/**
 * Свои треки игрока из папки music. Музыку Minecraft (C418, Lena Raine) радио
 * само не подмешивает: она спокойная и растворяла энергию лобби (docs/MUSIC.md,
 * 24.09.2026); команда ядра download_mc_music осталась, но не вызывается.
 */
async function loadOwn(): Promise<Track[]> {
  if (!hasTauri()) return []
  const list = await musicTracks()
  return list.map((t) => ({ src: convertFileSrc(t.path), title: t.title, author: 'Своя музыка', file: t.file }))
}

const playlist = (radio: boolean, own: Track[]) => [...(radio ? BUNDLED : []), ...own]

interface MusicState {
  level: number
  muted: boolean
  tracks: Track[]
  /** Встроенное радио Millida в плейлисте. Выключено — играют только свои треки. */
  radio: boolean
  own: Track[]
  /** Плейлист собран хотя бы раз: пустой список до этого — «загружается», после — «нет треков». */
  loaded: boolean
  index: number
  playing: boolean
  /** Остался для совместимости: Play.tsx закрывает им старый поповер. Радио поповера не имеет. */
  open: boolean
  setOpen: (v: boolean) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  togglePlay: () => void
  /** Радио: один тумблер. Включает с того места, где плейлист остановился. */
  toggleRadio: () => void
  next: () => void
  prev: () => void
  play: (index: number) => void
  setRadio: (on: boolean) => void
  refreshOwn: () => Promise<void>
  addOwn: () => Promise<void>
  removeOwn: (file: string) => Promise<void>
  openFolder: () => void
}

// The player lives outside the React tree so navigation cannot unmount audio.
let audio: HTMLAudioElement | null = null
let started = false

const FADE_MS = 900
const FADE_QUICK_MS = 180
const FADE_STEP_MS = 40

const getAudio = () => {
  if (!audio) {
    audio = new Audio()
    audio.addEventListener('ended', () => useMusic.getState().next())
  }
  return audio
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

let fadeTimer: ReturnType<typeof setInterval> | null = null

function clearFade() {
  if (fadeTimer === null) return
  clearInterval(fadeTimer)
  fadeTimer = null
}

function fadeTo(to: number, ms: number, after?: () => void) {
  clearFade()
  const a = getAudio()
  const from = a.volume
  if (ms <= 0 || Math.abs(to - from) < 0.01) {
    a.volume = to
    if (after) after()
    return
  }
  const start = Date.now()
  fadeTimer = setInterval(() => {
    const p = Math.min(1, (Date.now() - start) / ms)
    a.volume = clamp01(from + (to - from) * p)
    if (p < 1) return
    clearFade()
    if (after) after()
  }, FADE_STEP_MS)
}

function apply(fadeMs = 0) {
  const s = useMusic.getState()
  const a = getAudio()
  const cur = s.tracks[s.index]
  const vol = s.muted ? 0 : clamp01(s.level / 100)
  if (!cur) {
    clearFade()
    a.pause()
    return
  }
  const changed = a.src !== new URL(cur.src, location.href).href
  if (changed) {
    clearFade()
    a.src = cur.src
    a.currentTime = 0
  }
  const want = s.playing && !s.muted && s.level > 0
  if (!want) {
    if (a.paused) {
      clearFade()
      a.volume = vol
    } else if (fadeMs > 0) {
      fadeTo(0, fadeMs, () => a.pause())
    } else {
      clearFade()
      a.pause()
      a.volume = vol
    }
    return
  }
  if (!a.paused && !changed) {
    fadeTo(vol, fadeMs)
    return
  }
  clearFade()
  a.volume = fadeMs > 0 ? 0 : vol
  a.play()
    .then(() => fadeTo(vol, fadeMs))
    .catch(() => {
      a.volume = vol
      useMusic.setState({ playing: false })
    })
}

// Game start and the tray both stop the music on their own. They share one flag,
// so playback comes back only when it was us who stopped it: a pause the user
// asked for is never undone by a later automatic resume.
let autoPaused = false

function setPlaying(playing: boolean, fadeMs: number) {
  autoPaused = false
  writePref('m-mus-play', playing ? '1' : '0')
  useMusic.setState({ playing })
  apply(fadeMs)
}

// The current track keeps playing when the list changes around it; a track
// that left the list hands over to the start of the new one.
function rebuild(radio: boolean, own: Track[]) {
  const s = useMusic.getState()
  const cur = s.tracks[s.index]
  const tracks = playlist(radio, own)
  const at = cur ? tracks.findIndex((t) => t.src === cur.src) : -1
  useMusic.setState({ radio, own, tracks, index: Math.max(0, at), loaded: true })
  if (!tracks.length) useMusic.setState({ playing: false })
  apply(FADE_MS)
}

const emptyHint = () =>
  useMusic.getState().loaded ? 'Нет треков: включи радио Millida или добавь свою музыку' : 'Радио ещё загружается'

function autoPause(fadeMs: number) {
  if (!useMusic.getState().playing) return
  autoPaused = true
  useMusic.setState({ playing: false })
  apply(fadeMs)
}

function autoResume(fadeMs: number) {
  if (!autoPaused) return
  autoPaused = false
  useMusic.setState({ playing: true })
  apply(fadeMs)
}

export const useMusic = create<MusicState>((set, get) => ({
  level: storedLevel(),
  muted: storedMuted(),
  tracks: [],
  radio: storedRadio(),
  own: [],
  loaded: false,
  index: 0,
  playing: false,
  open: false,
  setOpen: (v) => set({ open: v }),
  setVolume: (v) => {
    const level = Math.max(0, Math.min(100, Math.round(v)))
    writePref('m-mus-vol', String(level))
    writePref('m-mus-muted', '0')
    set({ level, muted: false })
    apply()
  },
  toggleMute: () => {
    const v = !get().muted
    writePref('m-mus-muted', v ? '1' : '0')
    set({ muted: v })
    apply(FADE_MS)
    showToast(v ? 'Музыка выключена' : 'Музыка включена')
  },
  togglePlay: () => {
    if (!get().tracks.length) {
      showToast(emptyHint(), 'error')
      return
    }
    writePref('m-mus-muted', '0')
    set({ muted: false })
    setPlaying(!get().playing, FADE_MS)
  },
  toggleRadio: () => {
    const s = get()
    if (radioOn(s)) {
      setPlaying(false, FADE_MS)
      return
    }
    if (!s.tracks.length) {
      showToast(emptyHint(), 'error')
      return
    }
    // Выключенный звук или нулевая громкость — это тоже «радио выключено»:
    // включение обязано быть слышно, поэтому громкость возвращается к базовой.
    if (s.level === 0) {
      writePref('m-mus-vol', String(DEFAULT_LEVEL))
      set({ level: DEFAULT_LEVEL })
    }
    writePref('m-mus-muted', '0')
    set({ muted: false })
    setPlaying(true, FADE_MS)
  },
  // Плейлист идёт по кругу: после последнего трека снова первый.
  next: () => {
    const { tracks, index } = get()
    set({ index: tracks.length ? (index + 1) % tracks.length : 0 })
    apply(FADE_MS)
  },
  prev: () => {
    const { tracks, index } = get()
    set({ index: tracks.length ? (index - 1 + tracks.length) % tracks.length : 0 })
    apply(FADE_MS)
  },
  play: (index) => {
    const s = get()
    if (!s.tracks[index]) return
    set({ index })
    if (s.level === 0) {
      writePref('m-mus-vol', String(DEFAULT_LEVEL))
      set({ level: DEFAULT_LEVEL })
    }
    writePref('m-mus-muted', '0')
    set({ muted: false })
    setPlaying(true, FADE_MS)
  },
  setRadio: (on) => {
    writePref('m-mus-radio', on ? '1' : '0')
    rebuild(on, get().own)
  },
  refreshOwn: async () => {
    if (!hasTauri()) return
    try {
      rebuild(get().radio, await loadOwn())
    } catch (e) {
      showToast('Не удалось прочитать папку с музыкой: ' + errText(e), 'error')
    }
  },
  addOwn: async () => {
    try {
      const res = await musicAdd()
      if (res.too_big.length) showToast('Больше 100 МБ, не добавлено: ' + res.too_big.join(', '), 'error')
      if (!res.added) return
      rebuild(get().radio, await loadOwn())
      showToast(res.added === 1 ? 'Трек добавлен' : 'Добавлено треков: ' + res.added)
    } catch (e) {
      showToast('Музыку не добавили: ' + errText(e), 'error')
    }
  },
  removeOwn: async (file) => {
    try {
      await musicRemove(file)
      rebuild(get().radio, await loadOwn())
    } catch (e) {
      showToast('Трек не удалён: ' + errText(e), 'error')
    }
  },
  openFolder: () => {
    openMusicFolder().catch((e: unknown) => showToast('Папка не открылась: ' + errText(e), 'error'))
  },
}))

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Каждый запуск открывается одной и той же темой (как меню Brawl Stars):
// повтор первых секунд и делает её «звуком Millida». Дальше — по кругу.
function pickStart(list: Track[]) {
  if (started || !list.length) return
  started = true
  useMusic.setState({ index: 0 })
}

let inited = false

export function initMusic() {
  if (inited) return
  inited = true

  // The store was built from web storage, which can be a start behind the disk
  // copy; the volume the user actually set is applied before anything plays.
  void hydratePrefs().then(() => {
    useMusic.setState({ level: storedLevel(), muted: storedMuted() })
    apply()
    return boot()
  })

  window.addEventListener('mc-started', () => autoPause(FADE_MS))
  window.addEventListener('mc-stopped', () => autoResume(FADE_MS))

  // Hidden in the tray the webview keeps running, so audio has to be stopped
  // explicitly — otherwise the launcher looks closed but still plays.
  void listenWindowVisibility((visible) => (visible ? resumeMusic() : suspendMusic()))
}

/** Радио играет: слышно прямо сейчас (или ждёт жеста пользователя, чтобы начать). */
export function radioOn(s: Pick<MusicState, 'playing' | 'muted' | 'level'>): boolean {
  return s.playing && !s.muted && s.level > 0
}

export function suspendMusic() {
  autoPause(FADE_QUICK_MS)
}

export function resumeMusic() {
  autoResume(FADE_MS)
}

// Turning autostart on is an explicit "play on launch", so an old manual pause
// must not keep the player silent forever.
export function setMusicAutostart(on: boolean) {
  writePref('m-mus-auto', on ? '1' : '0')
  if (on) writePref('m-mus-play', '1')
}

export function stopMusicNow() {
  autoPaused = false
  clearFade()
  if (!audio) return
  audio.pause()
  audio.volume = 0
}

function boot() {
  return loadOwn()
    .catch((e: unknown) => {
      showToast('Своя музыка не загрузилась: ' + errText(e), 'error')
      return [] as Track[]
    })
    .then((own) => {
      const radio = storedRadio()
      const list = playlist(radio, own)
      useMusic.setState({ radio, own, tracks: list, loaded: true })
      pickStart(list)
      autostart()
    })
}

function autostart() {
  if (!useUi.getState().logged) return
  const s = useMusic.getState()
  if (!s.tracks.length || s.muted || s.level === 0) return
  if (localStorage.getItem('m-mus-auto') === '0') return
  // A pause the user asked for outlives the restart, so autostart stays quiet.
  if (!storedPlaying()) return
  autoPaused = false
  useMusic.setState({ playing: true })
  apply(FADE_MS)
  // Webviews block playback until a user gesture, so retry on the first click.
  const once = () => {
    const a = getAudio()
    const cur = useMusic.getState()
    if (a.paused && cur.playing && !cur.muted && cur.level > 0) apply(FADE_MS)
  }
  document.addEventListener('click', once, { once: true })
}

export function startMusicAfterLogin() {
  if (!inited) initMusic()
  autostart()
}
