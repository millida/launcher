import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { convertFileSrc, downloadMcMusic, musicTracks } from '../ipc/commands'
import { showToast, useUi } from './ui'
import { hydratePrefs, readPref, writePref } from '../lib/prefs'

const DEFAULT_LEVEL = 5

function storedLevel(): number {
  const v = parseInt(readPref('m-mus-vol', String(DEFAULT_LEVEL)), 10)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_LEVEL
}

const storedMuted = () => readPref('m-mus-muted', '0') === '1'

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

const getAudio = () => {
  if (!audio) {
    audio = new Audio()
    audio.addEventListener('ended', () => useMusic.getState().next())
  }
  return audio
}

function apply() {
  const s = useMusic.getState()
  const a = getAudio()
  const cur = s.tracks[s.index]
  if (!cur) {
    a.pause()
    return
  }
  if (a.src !== new URL(cur.src, location.href).href) {
    a.src = cur.src
    a.currentTime = 0
  }
  a.volume = s.muted ? 0 : Math.max(0, Math.min(1, s.level / 100))
  if (s.playing && !s.muted && s.level > 0) a.play().catch(() => useMusic.setState({ playing: false }))
  else a.pause()
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
    apply()
    showToast(v ? 'Музыка выключена' : 'Музыка включена')
  },
  togglePlay: () => {
    if (!get().tracks.length) {
      showToast('Треков нет — добавь mp3 в папку с музыкой', 'error')
      return
    }
    set({ muted: false, playing: !get().playing })
    apply()
  },
  next: () => {
    const { tracks, index } = get()
    set({ index: tracks.length ? (index + 1) % tracks.length : 0 })
    apply()
  },
  prev: () => {
    const { tracks, index } = get()
    set({ index: tracks.length ? (index - 1 + tracks.length) % tracks.length : 0 })
    apply()
  },
  play: (i) => {
    set({ index: i, muted: false, playing: true })
    apply()
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

  let wasPlaying = false
  window.addEventListener('mc-started', () => {
    const s = useMusic.getState()
    wasPlaying = s.playing
    if (!s.playing) return
    useMusic.setState({ playing: false })
    apply()
  })
  window.addEventListener('mc-stopped', () => {
    if (!wasPlaying) return
    wasPlaying = false
    useMusic.setState({ playing: true })
    apply()
  })
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
  useMusic.setState({ playing: true })
  apply()
  // Webviews block playback until a user gesture, so retry on the first click.
  const once = () => {
    const a = getAudio()
    const cur = useMusic.getState()
    if (a.paused && cur.playing && !cur.muted && cur.level > 0) a.play().catch(() => {})
  }
  document.addEventListener('click', once, { once: true })
}

export function startMusicAfterLogin() {
  if (!inited) initMusic()
  autostart()
}
