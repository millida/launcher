import type { MusicLink } from './musicLinks'

export interface EmbedNow {
  title: string
  author: string
}

export interface EmbedHooks {
  onNow: (now: EmbedNow) => void
  onEnded: () => void
  onError: (text: string) => void
}

const ORIGIN = { youtube: 'https://www.youtube-nocookie.com', soundcloud: 'https://w.soundcloud.com' } as const
const CHANNEL = { id: 'millida-music', channel: 'widget' }
const HANDSHAKE_MS = 250
const READY_TIMEOUT_MS = 20000
const SC_FINISH_CHECK_MS = 900
const YT_ENDED = 0

const NO_ANSWER = 'Плеер не ответил. Проверь интернет: без VPN YouTube и SoundCloud могут не открываться'
const YT_REFUSED = 'YouTube не отдал это видео: оно закрыто, удалено или автор запретил играть его вне YouTube'
const SC_REFUSED = 'SoundCloud не отдал этот плейлист — проверь, что он открыт по ссылке'

let frame: HTMLIFrameElement | null = null
let link: MusicLink | null = null
let hooks: EmbedHooks | null = null
let ready = false
let wantPlay = false
let volume = 0
let at = -1
let count = 0
let lastState = -1
let nowKey = ''
let soundId: unknown = null
let handshake: ReturnType<typeof setInterval> | null = null
let readyTimer: ReturnType<typeof setTimeout> | null = null
let listening = false

function clearTimers() {
  if (handshake !== null) clearInterval(handshake)
  if (readyTimer !== null) clearTimeout(readyTimer)
  handshake = null
  readyTimer = null
}

function send(body: unknown) {
  if (!frame?.contentWindow || !link) return
  frame.contentWindow.postMessage(JSON.stringify(body), ORIGIN[link.service])
}

const yt = (func: string, args: unknown[] = []) => send({ event: 'command', func, args, ...CHANNEL })
const sc = (method: string, value?: unknown) => send(value === undefined ? { method } : { method, value })

function sync() {
  if (!ready || !link) return
  if (link.service === 'youtube') {
    yt('setVolume', [volume])
    yt('unMute')
    yt(wantPlay ? 'playVideo' : 'pauseVideo')
    return
  }
  sc('setVolume', volume)
  sc(wantPlay ? 'play' : 'pause')
}

function becomeReady() {
  if (ready || !link) return
  ready = true
  clearTimers()
  if (link.service === 'youtube') {
    yt('addEventListener', ['onError'])
  } else {
    for (const ev of ['play', 'finish', 'error']) sc('addEventListener', ev)
    sc('getSounds')
  }
  sync()
}

function tellNow(title: unknown, author: unknown) {
  const now = { title: typeof title === 'string' ? title : '', author: typeof author === 'string' ? author : '' }
  if (!now.title || now.title + '\n' + now.author === nowKey) return
  nowKey = now.title + '\n' + now.author
  hooks?.onNow(now)
}

const hasNext = () => at >= 0 && at < count - 1

function onYoutube(msg: Record<string, unknown>) {
  becomeReady()
  if (msg.event === 'onError') {
    if (hasNext()) yt('nextVideo')
    else hooks?.onError(YT_REFUSED)
    return
  }
  const info = msg.info
  if (!info || typeof info !== 'object') return
  const i = info as Record<string, unknown>
  if (Array.isArray(i.playlist)) count = i.playlist.length
  if (typeof i.playlistIndex === 'number') at = i.playlistIndex
  const data = i.videoData
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    tellNow(d.title, d.author)
  }
  if (typeof i.playerState !== 'number') return
  const ended = i.playerState === YT_ENDED && lastState !== YT_ENDED
  lastState = i.playerState
  if (ended && !hasNext()) hooks?.onEnded()
}

function onSoundcloud(msg: Record<string, unknown>) {
  const value = msg.value
  switch (msg.method) {
    case 'ready':
      becomeReady()
      return
    case 'getSounds':
      if (Array.isArray(value)) count = value.length
      return
    case 'getCurrentSoundIndex':
      if (typeof value === 'number') at = value
      return
    case 'getCurrentSound':
      if (value && typeof value === 'object') {
        const v = value as Record<string, unknown>
        const user = v.user && typeof v.user === 'object' ? (v.user as Record<string, unknown>).username : ''
        tellNow(v.title, user)
      }
      return
    case 'play': {
      const id = value && typeof value === 'object' ? (value as Record<string, unknown>).soundId : null
      if (id === soundId) return
      soundId = id
      sc('getCurrentSound')
      sc('getCurrentSoundIndex')
      return
    }
    case 'finish':
      setTimeout(() => sc('isPaused'), SC_FINISH_CHECK_MS)
      return
    case 'isPaused':
      if (value === true && wantPlay && !hasNext()) hooks?.onEnded()
      return
    case 'error':
      hooks?.onError(SC_REFUSED)
      return
  }
}

function onMessage(e: MessageEvent) {
  if (!frame || !link || e.source !== frame.contentWindow || e.origin !== ORIGIN[link.service]) return
  let msg: unknown
  try {
    msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
  } catch {
    return
  }
  if (!msg || typeof msg !== 'object') return
  if (link.service === 'youtube') onYoutube(msg as Record<string, unknown>)
  else onSoundcloud(msg as Record<string, unknown>)
}

function playerUrl(l: MusicLink): string {
  const sep = l.embed.includes('?') ? '&' : '?'
  const auto = wantPlay ? '1' : '0'
  if (l.service === 'youtube') {
    return l.embed + sep + 'enablejsapi=1&playsinline=1&rel=0&controls=0&autoplay=' + auto + '&origin=' + encodeURIComponent(location.origin)
  }
  return l.embed + sep + 'hide_related=true&show_comments=false&show_reposts=false&visual=false&auto_play=' + (wantPlay ? 'true' : 'false')
}

function mount(l: MusicLink) {
  embedStop()
  link = l
  if (!listening) {
    window.addEventListener('message', onMessage)
    listening = true
  }
  const el = document.createElement('iframe')
  el.title = 'Музыка'
  el.tabIndex = -1
  el.setAttribute('aria-hidden', 'true')
  el.allow = 'autoplay; encrypted-media'
  el.referrerPolicy = 'strict-origin-when-cross-origin'
  // Players refuse to start in a frame that is display:none or smaller than
  // 200x200, so the frame keeps a real size and is moved off screen instead.
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:200px;border:0;opacity:0;pointer-events:none'
  el.addEventListener('load', () => {
    if (frame !== el || ready || l.service !== 'youtube') return
    // The YouTube player answers only after it is told who listens, and it
    // drops the message while it is still booting.
    handshake = setInterval(() => send({ event: 'listening', ...CHANNEL }), HANDSHAKE_MS)
  })
  el.src = playerUrl(l)
  frame = el
  document.body.appendChild(el)
  readyTimer = setTimeout(() => {
    if (frame !== el || ready) return
    hooks?.onError(NO_ANSWER)
  }, READY_TIMEOUT_MS)
}

export function embedPlay(l: MusicLink, level: number, h: EmbedHooks) {
  hooks = h
  wantPlay = true
  volume = Math.max(0, Math.min(100, Math.round(level)))
  if (link?.key !== l.key) mount(l)
  else sync()
}

export function embedPause() {
  wantPlay = false
  sync()
}

export function embedStop() {
  clearTimers()
  frame?.remove()
  frame = null
  link = null
  ready = false
  at = -1
  count = 0
  lastState = -1
  nowKey = ''
  soundId = null
}

/** Moves inside the playlist. False at its edge, so the caller moves on to its own next source. */
export function embedStep(dir: 1 | -1): boolean {
  if (!ready || !link || at < 0) return false
  if (dir === 1 ? !hasNext() : at === 0) return false
  if (link.service === 'youtube') yt(dir === 1 ? 'nextVideo' : 'previousVideo')
  else sc(dir === 1 ? 'next' : 'prev')
  return true
}

export function embedRestart() {
  if (!ready || !link) return
  lastState = -1
  if (link.service === 'youtube') {
    if (count > 1) yt('playVideoAt', [0])
    else {
      yt('seekTo', [0, true])
      yt('playVideo')
    }
    return
  }
  sc('skip', 0)
  sc('play')
}

export const embedKey = (): string | null => link?.key ?? null
