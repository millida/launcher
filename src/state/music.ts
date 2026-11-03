import { create } from 'zustand'
import { listenWindowVisibility } from '../ipc/events'
import { showToast, useUi } from './ui'
import { hydratePrefs, readPref, writePref } from '../lib/prefs'
import { hasTauri } from '../ipc/tauri'
import { convertFileSrc, mainWindowVisible, musicAdd, musicRemove, musicTracks, openMusicFolder } from '../ipc/commands'
import { MAX_LINKS, SERVICE_NAME, parseMusicLink, restoreLinks, type MusicLink } from '../lib/musicLinks'
import { embedKey, embedPause, embedPlay, embedRestart, embedStep, embedStop, type EmbedHooks, type EmbedNow } from '../lib/musicEmbed'
import { t } from '../i18n'
import { ensureMedia, mediaUrl } from '../lib/media'

const DEFAULT_LEVEL = 5

function storedLevel(): number {
  const v = parseInt(readPref('m-mus-vol', String(DEFAULT_LEVEL)), 10)
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_LEVEL
}

const storedMuted = () => readPref('m-mus-muted', '0') === '1'

/// Музыка начинает играть сама только по выбору игрока: включил «Музыку при запуске» или сам запускал радио
/// и не ставил на паузу. Без выбора лаунчер молчит до первого нажатия «играть».
export function autostartChosen(auto: string, play: string): boolean {
  return auto === '1' || (auto !== '0' && play === '1')
}

export const musicAutostartOn = () => autostartChosen(readPref('m-mus-auto', ''), readPref('m-mus-play', ''))

/// Выбранный автозапуск уступает паузе, которую игрок нажал сам.
const storedPlaying = () => readPref('m-mus-play', '1') !== '0'

const storedRadio = () => readPref('m-mus-radio', '1') !== '0'

// One address per setting: the core caps a stored value at 256 bytes, a list
// of addresses in one value would not fit.
const LINK_SLOTS = ['m-mus-link-0', 'm-mus-link-1', 'm-mus-link-2', 'm-mus-link-3', 'm-mus-link-4', 'm-mus-link-5', 'm-mus-link-6', 'm-mus-link-7'] as const

const storedLinks = () => restoreLinks(LINK_SLOTS.map((k) => readPref(k, '')).filter(Boolean))

const saveLinks = (links: MusicLink[]) => LINK_SLOTS.forEach((k, i) => writePref(k, links[i]?.url || ''))

export interface Track {
  src: string
  title: string
  author?: string
  /** Лицензия и страница трека — для экрана «Авторы музыки» (CC BY требует указать автора). */
  license?: 'CC0 1.0' | 'CC BY 4.0'
  url?: string
  /** Имя файла в папке music — есть только у своих треков игрока. */
  file?: string
  /** Имя в media/manifest.json: трек радио качается ядром при первом обращении (src — только его опознавательный знак). */
  media?: string
  /** Плейлист по ссылке: играет встроенный плеер сервиса, а не наш audio. */
  link?: MusicLink
}

const SKIFF = 'https://ericskiff.com/music/'
const PPEAK = 'https://opengameart.org/content/free-action-chiptune-music-pack'
const JUNKALA = 'https://opengameart.org/content/5-chiptunes-action'
const ZANE = 'https://opengameart.org/content/starlight-city-loop-included'

/**
 * Радио Millida: чиптюн 115–160 BPM, мажор, громкость выровнена до −18 LUFS.
 * Первым всегда идёт «Starlight City» — с него радио начинает, когда игрок
 * его включил (само оно не стартует). Откуда треки и почему они — docs/MUSIC.md.
 */
export const RADIO: Track[] = [
  { src: '/music/01-starlight-city.mp3', media: 'music/01-starlight-city.mp3', title: 'Starlight City', author: 'Zane Little', license: 'CC0 1.0', url: ZANE },
  { src: '/music/02-chibi-ninja.mp3', media: 'music/02-chibi-ninja.mp3', title: 'Chibi Ninja', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
  { src: '/music/03-secret-base.mp3', media: 'music/03-secret-base.mp3', title: 'Secret Base', author: 'PPEAK', license: 'CC BY 4.0', url: PPEAK },
  { src: '/music/04-jumpshot.mp3', media: 'music/04-jumpshot.mp3', title: 'Jumpshot', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
  { src: '/music/05-level-2.mp3', media: 'music/05-level-2.mp3', title: 'Level 2', author: 'Juhani Junkala', license: 'CC0 1.0', url: JUNKALA },
  { src: '/music/06-hhavok.mp3', media: 'music/06-hhavok.mp3', title: 'HHavok', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
  { src: '/music/07-dizzy-spells.mp3', media: 'music/07-dizzy-spells.mp3', title: 'A Night Of Dizzy Spells', author: 'Eric Skiff', license: 'CC BY 4.0', url: SKIFF },
]

// Файлы лежат в media/music: внутри сборки или (MEDIA_REMOTE=1) на CDN, откуда их качает ядро при первом
// обращении (media/manifest.json, src/lib/media.ts); сборка без медиа (чистый checkout) должна собираться —
// флаг ставит vite.config.ts.
const BUNDLED: Track[] = __HAS_BUNDLED_MUSIC__ ? RADIO : []

/**
 * Свои треки игрока из папки music. Музыку Minecraft (C418, Lena Raine) радио
 * само не подмешивает: она спокойная и растворяла энергию лобби (docs/MUSIC.md,
 * 24.09.2026); команда ядра download_mc_music осталась, но не вызывается.
 */
async function loadOwn(): Promise<Track[]> {
  if (!hasTauri()) return []
  const list = await musicTracks()
  return list.map((track) => ({ src: convertFileSrc(track.path), title: track.title, author: t('Своя музыка'), file: track.file }))
}

const linkTrack = (link: MusicLink): Track => ({ src: link.url, title: link.title, author: SERVICE_NAME[link.service], link })

const playlist = (radio: boolean, own: Track[], links: MusicLink[]) => [...(radio ? BUNDLED : []), ...own, ...links.map(linkTrack)]

interface MusicState {
  level: number
  muted: boolean
  tracks: Track[]
  /** Встроенное радио Millida в плейлисте. Выключено — играют только свои треки. */
  radio: boolean
  own: Track[]
  links: MusicLink[]
  /** Что сейчас играет плейлист по ссылке: название приходит от плеера сервиса. */
  now: EmbedNow | null
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
  /** Ложь — ссылку не взяли, причина уже показана. */
  addLink: (raw: string) => boolean
  removeLink: (key: string) => void
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

const embedHooks: EmbedHooks = {
  onNow: (now) => useMusic.setState({ now }),
  onEnded: () => useMusic.getState().next(),
  onError: (text) => {
    showToast(text, 'error')
    const s = useMusic.getState()
    if (s.tracks.length > 1) s.next()
    else setPlaying(false, 0)
  },
}

function dropEmbed() {
  if (embedKey() === null) return
  embedStop()
  useMusic.setState({ now: null })
}

function applyLink(link: MusicLink) {
  const s = useMusic.getState()
  const a = getAudio()
  clearFade()
  if (!a.paused) a.pause()
  if (embedKey() !== link.key) useMusic.setState({ now: null })
  if (s.playing && !s.muted && s.level > 0) embedPlay(link, s.level, embedHooks)
  else embedPause()
}

let wroteWaiting = false

function waitForTrack(cur: Track, want: boolean) {
  if (!cur.media || !want) return
  if (!wroteWaiting) {
    wroteWaiting = true
    showToast(t('Радио ещё загружается'))
  }
  void ensureMedia([cur.media]).then(() => {
    const s = useMusic.getState()
    const now = s.tracks[s.index]
    if (now && now.src === cur.src && mediaUrl(cur.media as string)) apply(FADE_MS)
  })
}

/// Следующий трек качается заранее, пока играет этот: к его началу он уже в кэше.
function prefetchNext() {
  const { tracks, index } = useMusic.getState()
  const next = tracks[(index + 1) % Math.max(tracks.length, 1)]
  if (next && next.media && next !== tracks[index]) void ensureMedia([next.media])
}

function apply(fadeMs = 0) {
  const s = useMusic.getState()
  const a = getAudio()
  const cur = s.tracks[s.index]
  const vol = s.muted ? 0 : clamp01(s.level / 100)
  if (!cur) {
    clearFade()
    a.pause()
    dropEmbed()
    return
  }
  if (cur.link) {
    applyLink(cur.link)
    return
  }
  dropEmbed()
  const want = s.playing && !s.muted && s.level > 0
  // Трек радио ещё не скачан: ядро качает, пока играть нечем; как только файл лёг — доигрываем с этого места.
  const playSrc = cur.media ? mediaUrl(cur.media) : cur.src
  if (!playSrc) {
    clearFade()
    if (!a.paused) a.pause()
    waitForTrack(cur, want)
    return
  }
  const changed = a.src !== new URL(playSrc, location.href).href
  if (changed) {
    clearFade()
    a.src = playSrc
    a.currentTime = 0
    prefetchNext()
  }
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
function rebuild(radio: boolean, own: Track[], links: MusicLink[] = useMusic.getState().links) {
  const s = useMusic.getState()
  const cur = s.tracks[s.index]
  const tracks = playlist(radio, own, links)
  const at = cur ? tracks.findIndex((t) => t.src === cur.src) : -1
  useMusic.setState({ radio, own, links, tracks, index: Math.max(0, at), loaded: true })
  if (!tracks.length) useMusic.setState({ playing: false })
  apply(FADE_MS)
}

const emptyHint = () =>
  useMusic.getState().loaded ? t('Нет треков: включи радио Millida или добавь свою музыку') : t('Радио ещё загружается')

function autoPause(fadeMs: number) {
  if (!useMusic.getState().playing) return
  autoPaused = true
  useMusic.setState({ playing: false })
  apply(fadeMs)
}

// The launcher started by the OS sits in the tray from its first frame, and the
// hide event fires before anyone listens, so the starting state is asked for.
let windowHidden = false
let visibilityReported = false

function startVisibility(): Promise<void> {
  if (!hasTauri()) return Promise.resolve()
  return mainWindowVisible()
    .then((visible) => {
      if (!visibilityReported) windowHidden = !visible
    })
    .catch((e: unknown) => console.error('[music] window visibility', e))
}

function onWindowVisibility(visible: boolean) {
  visibilityReported = true
  windowHidden = !visible
  if (visible) resumeMusic()
  else suspendMusic()
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
  links: [],
  now: null,
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
    showToast(v ? t('Музыка выключена') : t('Музыка включена'))
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
    const inLink = Boolean(tracks[index]?.link)
    if (inLink && embedStep(1)) return
    if (inLink && tracks.length === 1) {
      embedRestart()
      return
    }
    set({ index: tracks.length ? (index + 1) % tracks.length : 0 })
    apply(FADE_MS)
  },
  prev: () => {
    const { tracks, index } = get()
    if (tracks[index]?.link && embedStep(-1)) return
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
      showToast(t('Не удалось прочитать папку с музыкой: {error}', { error: errText(e) }), 'error')
    }
  },
  addOwn: async () => {
    try {
      const res = await musicAdd()
      if (res.too_big.length) showToast(t('Больше 100 МБ, не добавлено: {list}', { list: res.too_big.join(', ') }), 'error')
      if (!res.added) return
      rebuild(get().radio, await loadOwn())
      showToast(res.added === 1 ? t('Трек добавлен') : t('Добавлено треков: {n}', { n: res.added }))
    } catch (e) {
      showToast(t('Музыку не добавили: {error}', { error: errText(e) }), 'error')
    }
  },
  removeOwn: async (file) => {
    try {
      await musicRemove(file)
      rebuild(get().radio, await loadOwn())
    } catch (e) {
      showToast(t('Трек не удалён: {error}', { error: errText(e) }), 'error')
    }
  },
  addLink: (raw) => {
    const v = parseMusicLink(raw)
    if (!v.ok) {
      showToast(v.error, 'error')
      return false
    }
    const s = get()
    const known = s.tracks.findIndex((t) => t.link?.key === v.link.key)
    if (known >= 0) {
      s.play(known)
      return true
    }
    if (s.links.length >= MAX_LINKS) {
      showToast(t('Плейлистов по ссылке может быть не больше {n} — убери лишний', { n: MAX_LINKS }), 'error')
      return false
    }
    const links = [...s.links, v.link]
    saveLinks(links)
    rebuild(s.radio, s.own, links)
    get().play(get().tracks.findIndex((t) => t.link?.key === v.link.key))
    return true
  },
  removeLink: (key) => {
    const s = get()
    const links = s.links.filter((l) => l.key !== key)
    saveLinks(links)
    rebuild(s.radio, s.own, links)
  },
  openFolder: () => {
    openMusicFolder().catch((e: unknown) => showToast(t('Папка не открылась: {error}', { error: errText(e) }), 'error'))
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
  void Promise.all([hydratePrefs(), startVisibility()]).then(() => {
    useMusic.setState({ level: storedLevel(), muted: storedMuted() })
    apply()
    return boot()
  })

  window.addEventListener('mc-started', () => autoPause(FADE_MS))
  window.addEventListener('mc-stopped', () => autoResume(FADE_MS))

  // Hidden in the tray the webview keeps running, so audio has to be stopped
  // explicitly — otherwise the launcher looks closed but still plays.
  void listenWindowVisibility(onWindowVisibility)
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
  embedPause()
  if (!audio) return
  audio.pause()
  audio.volume = 0
}

function boot() {
  return loadOwn()
    .catch((e: unknown) => {
      showToast(t('Своя музыка не загрузилась: {error}', { error: errText(e) }), 'error')
      return [] as Track[]
    })
    .then((own) => {
      const radio = storedRadio()
      const links = storedLinks()
      const list = playlist(radio, own, links)
      useMusic.setState({ radio, own, links, tracks: list, loaded: true })
      pickStart(list)
      autostart()
    })
}

function autostart() {
  if (!useUi.getState().logged) return
  const s = useMusic.getState()
  if (!s.tracks.length || s.muted || s.level === 0) return
  if (!musicAutostartOn()) return
  // A pause the user asked for outlives the restart, so autostart stays quiet.
  if (!storedPlaying()) return
  if (windowHidden) {
    autoPaused = true
    return
  }
  autoPaused = false
  useMusic.setState({ playing: true })
  apply(FADE_MS)
  // Webviews block playback until a user gesture, so retry on the first click.
  const once = () => {
    const a = getAudio()
    const cur = useMusic.getState()
    const blocked = a.paused || Boolean(cur.tracks[cur.index]?.link)
    if (blocked && cur.playing && !cur.muted && cur.level > 0) apply(FADE_MS)
  }
  document.addEventListener('click', once, { once: true })
}

export function startMusicAfterLogin() {
  if (!inited) initMusic()
  autostart()
}
