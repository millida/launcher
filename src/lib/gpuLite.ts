import { useSyncExternalStore } from 'react'

/**
 * Облегчённая графика: лаунчер без WebGL.
 *
 * 25.09.2026 в 2.0.x окно лаунчера падало вдвое чаще, чем в 1.0.106:
 * renderer_gone kind=gpu, почти всегда на лобби (3D-персонаж на WebGL, два
 * холста фона во всё окно). Процесс видеокарты WebView2 умирал, окно
 * перезагружалось — и снова создавало тот же WebGL: один игрок ловил по
 * 8–11 падений подряд.
 *
 * После двух сбоев видеокарты (или двух потерь контекста WebGL) за минуты
 * лаунчер на неделю переходит на плоские картинки: персонаж лобби — 2D-фигурка
 * скина, сундуки — рисунок, фон — один статичный кадр. Через неделю пробуем 3D
 * снова (драйвер могли обновить).
 *
 * Одиночный сбой процесса видеокарты лёгкую графику не включает (05.10.2026):
 * за неделю он был у ~1050 установок, у 858 — единственный, треть — на запуске
 * или выходе из игры, когда драйвер сбрасывает и окно лаунчера. Такие игроки
 * неделю видели плоский скин, и обновление лаунчера его не возвращало.
 */

const KEY = 'm-gpu-lite-since'
const GPU_EXIT_KEY = 'm-gpu-exit-at'
const LEGACY_KEYS = ['m-gpu-lite', 'm-gpu-lite-at']
const TTL_MS = 7 * 24 * 3600 * 1000

/** A browser holds a few WebGL contexts per page and drops the oldest when a new one is made. */
export const EVICT_MS = 5000
/** One GPU reset loses every live context at once: their events arrive together. */
export const INCIDENT_MS = 1500
/** A GPU that keeps dying does it again within minutes; sleep and driver swaps are hours apart. */
export const REPEAT_MS = 10 * 60 * 1000

let forced = false
let legacyDropped = false
const subs = new Set<() => void>()

function stored(): number {
  try {
    if (!legacyDropped) {
      legacyDropped = true
      for (const k of LEGACY_KEYS) localStorage.removeItem(k)
    }
    return Number(localStorage.getItem(KEY) || 0) || 0
  } catch {
    return 0
  }
}

export const liteFrom = (at: number, now: number) => at > 0 && now - at < TTL_MS

/** Рисовать без WebGL. */
export function gpuLite(): boolean {
  return forced || liteFrom(stored(), Date.now())
}

function enterLite(now: number): void {
  try {
    localStorage.setItem(KEY, String(now))
  } catch {}
  if (forced) return
  forced = true
  subs.forEach((f) => f())
}

export const gpuExitRepeats = (previousAt: number, now: number) =>
  previousAt > 0 && now >= previousAt && now - previousAt < REPEAT_MS

/**
 * Процесс видеокарты окна умер. Страница при этом перезагружается, поэтому
 * время прошлого сбоя хранится на диске. Без WebGL — только если сбой повторился
 * в течение минут: так падает видеокарта, которую добивает сам WebGL.
 * Возвращает, включилась ли лёгкая графика.
 */
export function noteGpuProcessExit(now = Date.now()): boolean {
  let previousAt = 0
  try {
    previousAt = Number(localStorage.getItem(GPU_EXIT_KEY) || 0) || 0
    localStorage.setItem(GPU_EXIT_KEY, String(now))
  } catch {}
  if (!gpuExitRepeats(previousAt, now)) return false
  enterLite(now)
  return true
}

export function onGpuLite(cb: () => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

export function useGpuLite(): boolean {
  return useSyncExternalStore(onGpuLite, gpuLite, gpuLite)
}

export interface LossHistory {
  incidentAt: number
  createdAt: number
}

export type LossVerdict = 'evicted' | 'same-incident' | 'first' | 'repeat'

export function lossVerdict(now: number, h: LossHistory): LossVerdict {
  if (h.createdAt > 0 && now - h.createdAt < EVICT_MS) return 'evicted'
  if (h.incidentAt > 0 && now - h.incidentAt < INCIDENT_MS) return 'same-incident'
  if (h.incidentAt > 0 && now - h.incidentAt < REPEAT_MS) return 'repeat'
  return 'first'
}

const history: LossHistory = { incidentAt: 0, createdAt: 0 }

/** A loss right after a new context is the browser evicting an old one, not a GPU failure. */
export function noteContextCreated(now = Date.now()): void {
  history.createdAt = now
}

/** Sleep, a driver swap or an eviction loses a context once; only a second incident within minutes is a failing GPU. */
export function noteContextLost(now = Date.now()): void {
  const verdict = lossVerdict(now, history)
  if (verdict === 'evicted' || verdict === 'same-incident') return
  history.incidentAt = now
  if (verdict === 'repeat') enterLite(now)
}

/** Только для тестов. */
export function _resetGpuLite() {
  forced = false
  legacyDropped = false
  history.incidentAt = 0
  history.createdAt = 0
}
