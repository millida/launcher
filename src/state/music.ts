import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { convertFileSrc, downloadMcMusic, musicTracks } from '../ipc/commands'
import { listenWindowVisibility } from '../ipc/events'
import { showToast, useUi } from './ui'
import { hydratePrefs, readPref, writePref } from '../lib/prefs'

const DEFAULT_LEVEL = 5

function storedLevel(): number {
  const v = parseInt(readPref('m-mus-vol', String(DEFAULT_LEVEL)), 10)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_LEVEL
}

const storedMuted = () => readPref('m-mus-muted', '0') === '1'

const storedPlaying = () => readPref('m-mus-play', '1') !== '0'

export interface Track {
  src: string
  title: string
  author?: string
}

// The file ships from the CDN (assets.json), so a build may legitimately lack it;
// the flag is resolved by vite.config.ts from what is really in public/.
const BUNDLED: Track[] = __HAS_BUNDLED_MUSIC__
  ? [{ src: '/music/ambient.mp3', title: 'Тихий вечер', author: 'Millida' }]
  : []

async function loadPlaylist(): Promise<Track[]> {
  const out: Track[] = [...BUNDLED]
  if (hasTauri()) {
    try {
      const own = await musicTracks()
      own.forEach((t) => out.push({ src: convertFileSrc(t.path), title: t.title, author: 'Своя музыка' }))
    } catch {}
  }
  return out
}

interface MusicState {
  level: number
  muted: boolean
  tracks: Track[]
  index: number
  playing: boolean
  open: boolean
  setOpen: (v: boolean) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  play: (i: number) => void
  refresh: () => Promise<void>
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
      showToast('Треков нет — добавь mp3 в папку с музыкой', 'error')
      return
    }
    writePref('m-mus-muted', '0')
    set({ muted: false })
    setPlaying(!get().playing, FADE_MS)
  },
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
  play: (i) => {
    writePref('m-mus-muted', '0')
    set({ index: i, muted: false })
    setPlaying(true, FADE_MS)
  },
  refresh: async () => {
    const list = await loadPlaylist()
    set({ tracks: list, index: get().index < list.length ? get().index : 0 })
    apply()
    showToast(list.length ? 'Треков в плейлисте: ' + list.length : 'Треков не нашлось', list.length ? 'ok' : 'error')
  },
}))

function pickStart(list: Track[]) {
  if (started || !list.length) return
  started = true
  const first = localStorage.getItem('m-mus-seen') !== '1'
  localStorage.setItem('m-mus-seen', '1')
  useMusic.setState({ index: first ? 0 : Math.floor(Math.random() * list.length) })
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
  return loadPlaylist().then(async (list) => {
    useMusic.setState({ tracks: list })
    pickStart(list)
    autostart()
    if (!hasTauri() || list.length >= 5) return
    try {
      await downloadMcMusic()
    } catch {}
    const full = await loadPlaylist()
    if (full.length !== list.length) {
      useMusic.setState({ tracks: full })
      pickStart(full)
      apply()
    }
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
