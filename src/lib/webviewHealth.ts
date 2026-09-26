import { noteGpuCrash } from './gpuLite'
import { hasTauri } from '../ipc/tauri'
import { appVersion, setWebviewLowMemory, takeWebviewFailure } from '../ipc/commands'
import { showToast } from '../state/ui'
import { track } from './telemetry'
import { heapEventDue } from './heapPressure'

/// Chromium-only: the heap the UI holds and the ceiling the renderer dies at.
interface HeapInfo {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

const SAMPLE_MS = 60_000
const MB = 1024 * 1024

function heap(): HeapInfo | null {
  const m = (performance as unknown as { memory?: HeapInfo }).memory
  if (!m || !m.jsHeapSizeLimit) return null
  return m
}

let sampleTimer: ReturnType<typeof setInterval> | null = null

export function watchHeap(): void {
  if (sampleTimer || !heap()) return
  let lastAt = Date.now()
  let highSent = false
  sampleTimer = setInterval(() => {
    const m = heap()
    if (!m) return
    const usedMb = Math.round(m.usedJSHeapSize / MB)
    const limitMb = Math.round(m.jsHeapSizeLimit / MB)
    const pct = Math.round((m.usedJSHeapSize / m.jsHeapSizeLimit) * 100)
    const due = heapEventDue(pct, Date.now() - lastAt, highSent)
    if (!due) return
    if (due === 'high') highSent = true
    lastAt = Date.now()
    track('perf', { what: 'memory', level: due, usedMb, limitMb, pct, upMin: Math.round(performance.now() / 60000) })
  }, SAMPLE_MS)
}

// Где был человек, когда умер процесс отрисовки: событие уходит уже со
// следующей страницы (часто — со следующего запуска и другой версии), поэтому
// экран, число холстов и версия пишутся на диск заранее.
const CTX_KEY = 'm-webview-ctx'
const CTX_EVERY_MS = 30_000
const CTX_FRESH_MS = 7 * 24 * 3600_000

export interface WebviewContext {
  screen: string
  canvases: number
  lobby: boolean
  ver: string
  at: number
}

function readContext(): WebviewContext | null {
  try {
    const raw = localStorage.getItem(CTX_KEY)
    const c = raw ? (JSON.parse(raw) as WebviewContext) : null
    return c && typeof c.screen === 'string' && Date.now() - Number(c.at) < CTX_FRESH_MS ? c : null
  } catch {
    return null
  }
}

// Снимок прошлой страницы читается при загрузке модуля — до того, как эта
// страница перепишет его своим.
const previousContext = typeof localStorage !== 'undefined' ? readContext() : null

let ctxVersion = ''
let ctxTimer: ReturnType<typeof setInterval> | null = null

function noteContext(screen: string) {
  try {
    const canvases = document.getElementsByTagName('canvas').length
    const lobby = !!document.querySelector('canvas.pixel-field')
    const c: WebviewContext = { screen: String(screen).slice(0, 24), canvases, lobby, ver: ctxVersion, at: Date.now() }
    localStorage.setItem(CTX_KEY, JSON.stringify(c))
  } catch {}
}

/// Пишет на диск текущий экран и сколько холстов (лобби, 3D-скин) смонтировано.
export function watchWebviewContext(getScreen: () => string, subscribe: (cb: (s: string) => void) => () => void): void {
  if (ctxTimer) return
  if (hasTauri()) void appVersion().then((v) => void (ctxVersion = v)).catch(() => {})
  // Холсты нового экрана появляются после отрисовки — замер чуть позже смены.
  subscribe((s) => void setTimeout(() => noteContext(s), 1500))
  ctxTimer = setInterval(() => noteContext(getScreen()), CTX_EVERY_MS)
  setTimeout(() => noteContext(getScreen()), 1500)
}

/// Поля контекста для события renderer_gone.
export function contextFields(c: WebviewContext | null): Record<string, string | number | boolean> {
  if (!c) return {}
  const out: Record<string, string | number | boolean> = { screen: c.screen, canvases: c.canvases, lobby: c.lobby }
  if (c.ver) out.prevVersion = c.ver
  return out
}

/**
 * The page that comes back after a dead render process reports what killed the
 * previous one. Sent as `error` rather than a type of its own so it lands in the
 * dashboards that already exist.
 */
let failure: ReturnType<typeof takeWebviewFailure> | null = null
/** Причину прошлой смерти окна забираем один раз и как можно раньше: сбой
 *  видеокарты должен выключить WebGL до того, как лобби его создаст. */
export function webviewFailure(): ReturnType<typeof takeWebviewFailure> {
  if (!failure) {
    failure = hasTauri() ? takeWebviewFailure().catch(() => null) : Promise.resolve(null)
    void failure.then((f) => {
      if (f && f.kind === 'gpu') noteGpuCrash()
    })
  }
  return failure
}

export async function reportWebviewFailure(): Promise<void> {
  if (!hasTauri()) return
  const f = await webviewFailure()
  if (!f) return
  track(
    'error',
    {
      where: 'renderer_gone',
      code: f.reason,
      kind: f.kind,
      freeMb: f.freeMb,
      totalMb: f.totalMb,
      reloaded: f.reloaded,
      ...contextFields(previousContext),
    },
    { ok: false },
  )
  if (f.reason === 'out_of_memory') {
    showToast('Машине не хватило памяти — окно лаунчера перезапустилось само. Уменьши память сборке или закрой лишние программы', 'error')
    return
  }
  if (f.kind === 'gpu') {
    showToast('Видеокарта сбросила окно — включили лёгкую графику без 3D', 'error')
    return
  }
  showToast('Окно лаунчера подвисло и перезапустилось само', 'error')
}

/// Called around the game, when the machine is tightest: out of sight the webview
/// gives its caches back instead of competing with the game for RAM.
export function setLauncherIdleMemory(on: boolean): void {
  if (!hasTauri()) return
  void setWebviewLowMemory(on).catch(() => {})
}
