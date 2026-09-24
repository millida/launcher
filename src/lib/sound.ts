import { convertFileSrc, downloadUiSounds, uiSounds } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { writePref } from './prefs'

export type SoundEvent =
  | 'click'
  | 'nav'
  | 'toggle'
  | 'open'
  | 'close'
  | 'notify'
  | 'success'
  | 'install'
  | 'achievement'
  | 'error'
  | 'delete'
  | 'login'
  | 'launch'
  | 'crash'
  | 'chest_hit'
  | 'chest_crack'
  | 'chest_open'
  | 'chest_card'
  | 'chest_rare'
  | 'chest_epic'
  | 'chest_gold'

const GAIN: Record<SoundEvent, number> = {
  click: 0.5,
  nav: 0.5,
  toggle: 0.45,
  open: 0.45,
  close: 0.45,
  notify: 0.75,
  success: 0.6,
  install: 0.55,
  achievement: 0.6,
  error: 0.6,
  delete: 0.5,
  login: 0.6,
  launch: 0.5,
  crash: 0.45,
  chest_hit: 0.7,
  chest_crack: 0.55,
  chest_open: 0.7,
  chest_card: 0.55,
  chest_rare: 0.6,
  chest_epic: 0.6,
  chest_gold: 0.6,
}

const UI_EVENTS: SoundEvent[] = ['click', 'nav', 'toggle', 'open', 'close']

export type SoundMode = 'off' | 'notify' | 'all'

const MODE_KEY = 'm-sound-mode'

export function soundMode(): SoundMode {
  try {
    const v = localStorage.getItem(MODE_KEY)
    if (v === 'off' || v === 'notify' || v === 'all') return v
    if (localStorage.getItem('m-sound') === '0') return 'off'
    if (localStorage.getItem('m-sound-ui') === '0') return 'notify'
    if (localStorage.getItem('m-sound') === '1') return 'all'
    return 'notify'
  } catch {
    return 'notify'
  }
}

export function setSoundMode(mode: SoundMode) {
  writePref(MODE_KEY, mode)
  try {
    localStorage.removeItem('m-sound')
    localStorage.removeItem('m-sound-ui')
  } catch {}
}

export function soundEnabled(): boolean {
  return soundMode() !== 'off'
}

export function uiClicksEnabled(): boolean {
  return soundMode() === 'all'
}

export function soundVolume(): number {
  try {
    const v = parseInt(localStorage.getItem('m-sound-vol') || '60', 10)
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 60
  } catch {
    return 60
  }
}

// Decoded into memory once: <audio> refetches through the asset protocol and drops rapid clicks.
const buffers = new Map<SoundEvent, AudioBuffer>()
const urls = new Map<SoundEvent, string>()
let ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = ctx || new AC()
    return ctx
  } catch {
    return null
  }
}

// Autoplay policy only lets resume() through while a real gesture is being handled;
// without this the context stays suspended and background notifications are silent.
function unlockAudio() {
  const ac = audioCtx()
  if (!ac || ac.state === 'running') return
  void ac.resume().catch(() => {})
}

async function collect(list: { event: string; path: string }[]) {
  const ac = audioCtx()
  await Promise.all(
    list.map(async (f) => {
      const ev = f.event as SoundEvent
      if (!(ev in GAIN) || buffers.has(ev)) return
      const src = convertFileSrc(f.path)
      urls.set(ev, src)
      if (!ac) return
      try {
        const raw = await (await fetch(src)).arrayBuffer()
        buffers.set(ev, await ac.decodeAudioData(raw))
      } catch {}
    }),
  )
}

const lastAt: Partial<Record<SoundEvent, number>> = {}
const MIN_GAP: Partial<Record<SoundEvent, number>> = { click: 45, nav: 45, toggle: 45, open: 90, close: 90 }

const GESTURE_MS = 400
let gestureUntil = 0

const gestureBusy = () => performance.now() < gestureUntil

/// Only the primary button activates a control, so only it may sound and press
/// it: a right, middle or thumb click used to play the click and run the :active
/// animation for an action that never happened on release.
export function isPrimaryPress(e: { button: number; isPrimary: boolean }): boolean {
  return e.button === 0 && e.isPrimary
}

export function soundAllowed(ev: SoundEvent, mode: SoundMode, gestureActive: boolean): boolean {
  if (mode === 'off') return false
  if (!UI_EVENTS.includes(ev)) return true
  return mode === 'all' && !gestureActive
}

export function playSound(ev: SoundEvent) {
  if (!soundAllowed(ev, soundMode(), gestureBusy())) return
  emit(ev)
}

/** Высота звука: одна нота нотного блока звучит разными ступенями. */
const RATE: Partial<Record<SoundEvent, number>> = { nav: 1.19, open: 1.335, close: 1, notify: 1.12, login: 1.26 }
/** Клики — по пентатонике по кругу: подряд складываются в мелодию, а не долбят одну ноту. */
const CLICK_STEPS = [1, 1.122, 1.26, 1.498, 1.682]
let clickStep = 0
/** Потолок длины: звуки короткие, хвост гасится плавно (владелец 24.09.2026). */
const MAX_S: Partial<Record<SoundEvent, number>> = {
  click: 0.22,
  nav: 0.22,
  toggle: 0.2,
  open: 0.32,
  close: 0.32,
  delete: 0.3,
  error: 0.4,
  notify: 0.6,
  login: 0.6,
  install: 0.7,
  success: 0.6,
}

function playBuffer(ac: AudioContext, ev: SoundEvent, level: number): boolean {
  const buf = buffers.get(ev)
  if (!buf) return false
  try {
    const node = ac.createBufferSource()
    const gain = ac.createGain()
    node.buffer = buf
    node.playbackRate.value = ev === 'click' ? CLICK_STEPS[clickStep++ % CLICK_STEPS.length]! : RATE[ev] ?? 1
    gain.gain.value = level
    node.connect(gain)
    gain.connect(ac.destination)
    const max = MAX_S[ev]
    const t = ac.currentTime
    node.start()
    if (max) {
      gain.gain.setValueAtTime(level, t + max * 0.6)
      gain.gain.linearRampToValueAtTime(0, t + max)
      node.stop(t + max + 0.02)
    }
    return true
  } catch {
    return false
  }
}

function playFile(ev: SoundEvent, level: number, onFail: () => void): boolean {
  const url = urls.get(ev)
  if (!url) return false
  try {
    // A fresh element per play so overlapping sounds do not cut each other off.
    const a = new Audio(url)
    a.volume = level
    void a.play().catch(onFail)
    return true
  } catch {
    return false
  }
}

/// Звуки — ТОЛЬКО из Minecraft (нотный блок, опыт; с 24.09.2026 — мелодичные) (приказ владельца 22.09.2026). Синтезированные
/// тоны-пищалки как запасной вариант убраны: чужой звук в интерфейсе слышно
/// сразу, лучше тишина. Нет файлов — молчим и качаем их при первой возможности.

function emit(ev: SoundEvent) {
  const vol = soundVolume()
  if (vol <= 0) return
  const now = performance.now()
  const gap = MIN_GAP[ev] ?? 60
  if (lastAt[ev] && now - (lastAt[ev] as number) < gap) return
  lastAt[ev] = now

  const level = Math.max(0, Math.min(1, (vol / 100) * GAIN[ev]))
  const ac = audioCtx()

  if (ac && ac.state === 'running') {
    if (playBuffer(ac, ev, level)) return
    playFile(ev, level, () => {})
    return
  }

  const resumeAndPlay = () => {
    if (!ac) return
    void ac
      .resume()
      .then(() => {
        if (ac.state !== 'running') return
        playBuffer(ac, ev, level)
      })
      .catch(() => {})
  }
  if (!playFile(ev, level, resumeAndPlay)) resumeAndPlay()
}

export const playNotifySound = () => playSound('notify')

/** Звук-образец с высотой (сундук: каждый удар выше). Уважает режим звука. */
export function playSample(ev: SoundEvent, rate = 1) {
  if (soundMode() === 'off') return
  const vol = soundVolume()
  if (vol <= 0) return
  const ac = audioCtx()
  const buf = buffers.get(ev)
  if (!ac || !buf) return
  try {
    if (ac.state !== 'running') void ac.resume()
    const node = ac.createBufferSource()
    const gain = ac.createGain()
    node.buffer = buf
    node.playbackRate.value = rate
    gain.gain.value = Math.max(0, Math.min(1, (vol / 100) * GAIN[ev]))
    node.connect(gain)
    gain.connect(ac.destination)
    node.start()
  } catch {}
}

async function load(force: boolean): Promise<number> {
  if (!hasTauri()) return 0
  const have = await uiSounds().catch(() => [])
  if (have.length) await collect(have)
  if (!force && have.length >= Object.keys(GAIN).length) return ready()
  const full = await downloadUiSounds().catch(() => have)
  if (full.length) await collect(full)
  return ready()
}

const ready = () => urls.size

export const fetchSounds = () => load(true)

async function ensure(attempt: number) {
  const n = await load(false).catch(() => 0)
  if (n >= Object.keys(GAIN).length || attempt >= 3) return
  setTimeout(() => void ensure(attempt + 1), 20000 * (attempt + 1))
}

const INIT_FLAG = '__millidaSoundsInit'

function onGameStart() {
  playSound('launch')
}

function onDown(e: PointerEvent) {
  unlockAudio()
  const t = e.target as HTMLElement | null
  if (!t || typeof t.closest !== 'function') return
  const primary = isPrimaryPress(e)
  if (primary) gestureUntil = 0
  const el = t.closest('button, a[href], .tgl, .nav-item, [role="button"], [data-sound]') as HTMLElement | null
  if (!el) return
  if (!primary) {
    // Suppressing the compatibility mouse events is what keeps :active off the
    // control: nothing happens on release, so nothing may look pressed either.
    if (e.cancelable) e.preventDefault()
    return
  }
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return
  if (t.closest('[data-nosound]')) return
  if (!soundEnabled() || !uiClicksEnabled()) return

  if (el.classList.contains('nav-item') && el.classList.contains('active')) return

  const marked = el.getAttribute('data-sound') as SoundEvent | null
  if (marked && marked in GAIN) emit(marked)
  else if (el.classList.contains('tgl')) emit('toggle')
  else if (el.classList.contains('nav-item') || el.classList.contains('side-collapse')) emit('nav')
  else emit('click')
  gestureUntil = performance.now() + GESTURE_MS
}

export function initSounds() {
  // The flag lives on window, not the module: dev HMR re-creates the module and listeners stack.
  const w = window as unknown as Record<string, boolean>
  if (w[INIT_FLAG]) return
  w[INIT_FLAG] = true
  void ensure(0)

  window.addEventListener('mc-started', onGameStart)

  // Delegated on the document, pointerdown only: playing on release would double every action.
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', unlockAudio, true)
  window.addEventListener('focus', unlockAudio)

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', unlockAudio, true)
      window.removeEventListener('focus', unlockAudio)
      window.removeEventListener('mc-started', onGameStart)
      w[INIT_FLAG] = false
    })
  }
}
