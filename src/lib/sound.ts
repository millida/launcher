import { convertFileSrc, downloadUiSounds, uiSounds } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

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
  try {
    localStorage.setItem(MODE_KEY, mode)
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
const files = new Map<SoundEvent, HTMLAudioElement>()
let ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = ctx || new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

async function collect(list: { event: string; path: string }[]) {
  const ac = audioCtx()
  await Promise.all(
    list.map(async (f) => {
      const ev = f.event as SoundEvent
      if (!(ev in GAIN) || buffers.has(ev)) return
      const src = convertFileSrc(f.path)
      if (ac) {
        try {
          const raw = await (await fetch(src)).arrayBuffer()
          buffers.set(ev, await ac.decodeAudioData(raw))
          return
        } catch {}
      }
      const el = new Audio(src)
      el.preload = 'auto'
      files.set(ev, el)
    }),
  )
}

const lastAt: Partial<Record<SoundEvent, number>> = {}
const MIN_GAP: Partial<Record<SoundEvent, number>> = { click: 45, nav: 45, toggle: 45, open: 90, close: 90 }

const GESTURE_MS = 400
let gestureUntil = 0

const gestureBusy = () => performance.now() < gestureUntil

export function playSound(ev: SoundEvent) {
  if (!soundEnabled()) return
  if (UI_EVENTS.includes(ev) && !uiClicksEnabled()) return
  if (gestureBusy()) return
  emit(ev)
}

function emit(ev: SoundEvent) {
  const vol = soundVolume()
  if (vol <= 0) return
  const now = performance.now()
  const gap = MIN_GAP[ev] ?? 60
  if (lastAt[ev] && now - (lastAt[ev] as number) < gap) return
  lastAt[ev] = now

  const level = Math.max(0, Math.min(1, (vol / 100) * GAIN[ev]))
  const buf = buffers.get(ev)
  if (buf) {
    const ac = audioCtx()
    if (ac) {
      try {
        const node = ac.createBufferSource()
        const gain = ac.createGain()
        node.buffer = buf
        gain.gain.value = level
        node.connect(gain)
        gain.connect(ac.destination)
        node.start()
        return
      } catch {}
    }
  }
  const src = files.get(ev)
  if (!src) return
  try {
    // Cloned so overlapping plays do not cut each other off.
    const a = src.cloneNode(true) as HTMLAudioElement
    a.volume = level
    void a.play().catch(() => {})
  } catch {}
}

export const playNotifySound = () => playSound('notify')

async function load(force: boolean): Promise<number> {
  if (!hasTauri()) return 0
  const have = await uiSounds().catch(() => [])
  if (have.length) await collect(have)
  if (!force && have.length >= Object.keys(GAIN).length) return ready()
  const full = await downloadUiSounds().catch(() => have)
  if (full.length) await collect(full)
  return ready()
}

const ready = () => buffers.size + files.size

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
  gestureUntil = 0
  const t = e.target as HTMLElement | null
  if (!t || typeof t.closest !== 'function') return
  const el = t.closest('button, a[href], .tgl, .nav-item, [role="button"], [data-sound]') as HTMLElement | null
  if (!el) return
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

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('mc-started', onGameStart)
      w[INIT_FLAG] = false
    })
  }
}
