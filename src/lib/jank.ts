import { useUi, type ScreenId } from '../state/ui'
import { track } from './telemetry'

export const LONG_FRAME_MS = 50
export const REPORT_WORST_MS = 100
export const ENTRY_WINDOW_MS = 3000
const MAX_REPORTS = 30

export interface LongFrame {
  start: number
  duration: number
  source: string
}

export interface JankSummary {
  n: number
  worstMs: number
  sumMs: number
  src: string
}

type LoafScript = { duration?: number; invoker?: string; sourceURL?: string; sourceFunctionName?: string }
type LoafEntry = PerformanceEntry & { scripts?: LoafScript[] }

const fileOf = (url: string) => url.split(/[?#]/)[0]!.split('/').pop() || ''

export function frameSource(entry: { scripts?: LoafScript[] }): string {
  let top: LoafScript | null = null
  for (const s of entry.scripts ?? []) if (!top || (s.duration ?? 0) > (top.duration ?? 0)) top = s
  if (!top) return 'render'
  const where = [top.sourceFunctionName, fileOf(top.sourceURL || '')].filter(Boolean).join('@')
  return where || top.invoker || 'script'
}

export function summarize(frames: readonly LongFrame[], from: number, until: number): JankSummary | null {
  let worst: LongFrame | null = null
  let n = 0
  let sum = 0
  for (const f of frames) {
    if (f.start < from || f.start >= until) continue
    n += 1
    sum += f.duration
    if (!worst || f.duration > worst.duration) worst = f
  }
  if (!worst) return null
  return { n, worstMs: Math.round(worst.duration), sumMs: Math.round(sum), src: worst.source }
}

let started = false

export function initJankWatch(): void {
  if (started || typeof PerformanceObserver === 'undefined') return
  const types = PerformanceObserver.supportedEntryTypes ?? []
  const type = types.includes('long-animation-frame') ? 'long-animation-frame' : types.includes('longtask') ? 'longtask' : null
  if (!type) return
  started = true

  const seen = new Set<ScreenId>()
  let frames: LongFrame[] = []
  let screen = useUi.getState().screen
  let enteredAt = performance.now()
  let first = true
  let reports = 0
  let flushTimer = 0

  const flush = () => {
    window.clearTimeout(flushTimer)
    const sum = summarize(frames, enteredAt, enteredAt + ENTRY_WINDOW_MS)
    frames = []
    if (!sum || sum.worstMs < REPORT_WORST_MS || reports >= MAX_REPORTS) return
    reports += 1
    track('perf', { what: 'jank', screen, visit: first ? 'first' : 'repeat', ...sum })
  }

  const enter = (next: ScreenId) => {
    flush()
    screen = next
    first = !seen.has(next)
    seen.add(next)
    enteredAt = performance.now()
    flushTimer = window.setTimeout(flush, ENTRY_WINDOW_MS + 500)
  }
  seen.add(screen)
  flushTimer = window.setTimeout(flush, ENTRY_WINDOW_MS + 500)

  useUi.subscribe((next, prev) => {
    if (next.screen !== prev.screen) enter(next.screen)
  })

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LoafEntry[]) {
      if (entry.duration < LONG_FRAME_MS) continue
      const frame = { start: entry.startTime, duration: entry.duration, source: frameSource(entry) }
      if (import.meta.env.DEV) console.warn('[jank]', screen, Math.round(frame.duration) + 'ms', frame.source)
      if (frame.start >= enteredAt && frame.start < enteredAt + ENTRY_WINDOW_MS) frames.push(frame)
    }
  }).observe({ type, buffered: false })
}
