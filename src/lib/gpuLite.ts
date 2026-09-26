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
 * После первого сбоя видеокарты (или второй потери контекста WebGL за сеанс)
 * лаунчер на неделю переходит на плоские картинки: персонаж лобби — 2D-фигурка
 * скина, сундуки — рисунок, фон — один статичный кадр. Через неделю пробуем
 * 3D снова (драйвер могли обновить).
 */

const KEY = 'm-gpu-lite'
const TTL_MS = 7 * 24 * 3600 * 1000

let forced = false
const subs = new Set<() => void>()

function stored(): number {
  try {
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

/** Сбой видеокарты: с этого момента и на неделю — без WebGL. */
export function noteGpuCrash(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {}
  if (forced) return
  forced = true
  subs.forEach((f) => f())
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

let lost = 0
/** Контекст WebGL потерян. Раз бывает (сон, смена драйвера), второй — уже сбой. */
export function noteContextLost(): void {
  lost += 1
  if (lost >= 2) noteGpuCrash()
}

/** Только для тестов. */
export function _resetGpuLite() {
  forced = false
  lost = 0
}
