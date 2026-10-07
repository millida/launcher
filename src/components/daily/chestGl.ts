import { WebGLRenderer, type Camera, type Scene } from 'three'
import { noteContextCreated, noteContextLost } from '../../lib/gpuLite'

/**
 * Один WebGL-контекст на все 3D-сундуки (06.10.2026). Раньше каждый сундук
 * заводил свой WebGLRenderer: в магазине их десяток (ящики, бонусы, пропуск),
 * вместе с лобби, снимками и соседними вкладками браузер упирался в предел
 * контекстов и отбирал самый старый — персонаж лобби пропадал.
 *
 * Теперь сундуки рисуются по очереди в один невидимый холст и копируются в
 * свои 2D-холсты (drawImage сразу после кадра). Контекст живёт, пока есть
 * хотя бы один сундук, и отдаётся через 3 с после последнего.
 */

type Shared = { r: WebGLRenderer; canvas: HTMLCanvasElement; w: number; h: number; onLost: (e: Event) => void }
let shared: Shared | null = null
let users = 0
let idle = 0
const lostSubs = new Set<() => void>()

function drop() {
  if (!shared) return
  const s = shared
  shared = null
  s.canvas.removeEventListener('webglcontextlost', s.onLost)
  try {
    s.r.dispose()
    s.r.forceContextLoss()
  } catch {}
}

function get(): Shared | null {
  if (shared) return shared
  try {
    noteContextCreated()
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const r = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true })
    r.setPixelRatio(1)
    r.setClearColor(0x000000, 0)
    const onLost = (e: Event) => {
      e.preventDefault()
      noteContextLost()
      drop()
      for (const f of [...lostSubs]) f()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    shared = { r, canvas, w: 2, h: 2, onLost }
    return shared
  } catch {
    return null
  }
}

export interface ChestGl {
  /** Нарисовать сцену в холст сундука размером w×h пикселей. */
  draw(scene: Scene, camera: Camera, target: CanvasRenderingContext2D, w: number, h: number): void
  release(): void
}

export function acquireChestGl(onLost: () => void): ChestGl | null {
  window.clearTimeout(idle)
  const s0 = get()
  if (!s0) return null
  users++
  lostSubs.add(onLost)
  let done = false
  return {
    draw(scene, camera, target, w, h) {
      const s = shared
      if (!s || w < 1 || h < 1) return
      // Общий холст только растёт: смена размера сбрасывает буфер кадра.
      if (w > s.w || h > s.h) {
        s.w = Math.max(s.w, w)
        s.h = Math.max(s.h, h)
        s.r.setSize(s.w, s.h, false)
      }
      s.r.setViewport(0, 0, w, h)
      s.r.setScissor(0, 0, w, h)
      s.r.setScissorTest(true)
      s.r.render(scene, camera)
      // Начало координат WebGL — снизу слева: кадр лежит в нижней части холста.
      target.clearRect(0, 0, w, h)
      target.drawImage(s.canvas, 0, s.h - h, w, h, 0, 0, w, h)
    },
    release() {
      if (done) return
      done = true
      lostSubs.delete(onLost)
      users = Math.max(0, users - 1)
      if (!users) {
        window.clearTimeout(idle)
        idle = window.setTimeout(() => !users && drop(), 3000)
      }
    },
  }
}
