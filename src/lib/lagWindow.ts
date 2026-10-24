/*
 * Устойчиво низкий FPS, а не разовая просадка. Мод раз в 5 с шлёт медиану
 * кадров за окно; лаг — когда за минуту в мире медиана ниже порога. Не
 * считаются: меню и загрузка (world=false), кадры, которые игрок сам ограничил
 * (фон, батарея), игра за другим окном и первые 45 с после входа в мир — там
 * подгружаются чанки, и низкий FPS нормален.
 */
import type { GamePerf } from '../ipc/events'

export const LAG_FPS = 30
const SPAN_MS = 60_000
const MIN_SAMPLES = 10
const SETTLE_MS = 45_000
const LEFT_WORLD_SAMPLES = 3
const GC_HEAVY_PCT = 10
const HEAP_FULL = 0.9

export interface LagVerdict {
  fps: number
  /** Сборщик мусора съедает время или куча почти полна: дело в памяти. */
  memory: boolean
}

interface Row {
  at: number
  fps: number
  heap: number
  gc: number
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

export class LagWindow {
  private rows: Row[] = []
  private worldSince: number | null = null
  private outside = 0

  push(p: Pick<GamePerf, 'fps' | 'world' | 'throttled' | 'focused' | 'heapMb' | 'maxMb' | 'gcPct'>, at: number): LagVerdict | null {
    if (!p.world) {
      // Inventory or chest for a few seconds is not leaving the world; a loading screen or the menu for 15 s is.
      if (++this.outside >= LEFT_WORLD_SAMPLES) {
        this.worldSince = null
        this.rows = []
      }
      return null
    }
    this.outside = 0
    this.worldSince ??= at
    if (p.throttled || !p.focused || at - this.worldSince < SETTLE_MS) return null
    this.rows = this.rows.filter((r) => at - r.at < SPAN_MS)
    this.rows.push({ at, fps: p.fps, heap: p.maxMb > 0 ? p.heapMb / p.maxMb : 0, gc: p.gcPct })
    if (this.rows.length < MIN_SAMPLES) return null
    const fps = median(this.rows.map((r) => r.fps))
    if (fps >= LAG_FPS) return null
    const gcKnown = this.rows.filter((r) => r.gc >= 0)
    const memory =
      (gcKnown.length >= MIN_SAMPLES / 2 && median(gcKnown.map((r) => r.gc)) >= GC_HEAVY_PCT) ||
      this.rows.filter((r) => r.heap >= HEAP_FULL).length * 2 >= this.rows.length
    this.rows = []
    return { fps, memory }
  }
}
