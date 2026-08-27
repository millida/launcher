import { hasTauri } from '../ipc/tauri'
import { setWebviewLowMemory, takeWebviewFailure } from '../ipc/commands'
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

/**
 * The page that comes back after a dead render process reports what killed the
 * previous one. Sent as `error` rather than a type of its own so it lands in the
 * dashboards that already exist.
 */
export async function reportWebviewFailure(): Promise<void> {
  if (!hasTauri()) return
  const f = await takeWebviewFailure().catch(() => null)
  if (!f) return
  track(
    'error',
    { where: 'renderer_gone', code: f.reason, kind: f.kind, freeMb: f.freeMb, totalMb: f.totalMb, reloaded: f.reloaded },
    { ok: false },
  )
  if (f.reason === 'out_of_memory') {
    showToast('Машине не хватило памяти — окно лаунчера перезапустилось само. Уменьши память сборке или закрой лишние программы', 'error')
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
