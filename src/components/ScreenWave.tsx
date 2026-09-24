import { useEffect, useRef } from 'react'
import { useUi } from '../state/ui'
import type { ScreenId } from '../state/ui'
import { ACCENT_EVENT, accentBase, shade } from '../lib/accent'

/**
 * Переход между экранами — пиксельное растворение, как у заставки «С
 * возвращением», в цвет экрана, куда идёшь (правка владельца 23.09.2026).
 * Экран уже сменился под слоем; слой из клеток 36 px гаснет волной от
 * центра, на фронте клетка вспыхивает светлее. ~380 мс, клики не держит.
 */

const CELL = 36
const DISSOLVE_MS = 380
const FLASH_MS = 60

/** Цвет экрана: плотный тон и вспышка фронта. */
const TONE: Record<ScreenId, [string, string]> = {
  play: ['#155f2a', '#3fbf5c'],
  playhub: ['#155f2a', '#3fbf5c'],
  builds: ['#155f2a', '#3fbf5c'],
  mods: ['#155f2a', '#3fbf5c'],
  servers: ['#155f2a', '#3fbf5c'],
  premium: ['#7a4a06', '#f2b23a'],
  rubies: ['#8a1030', '#ff4d6d'],
  skins: ['#1c5a8f', '#4cb8f5'],
  friends: ['#2d2f6b', '#7b82ff'],
  chat: ['#2d2f6b', '#7b82ff'],
  hosting: ['#0f5a3a', '#35d49a'],
  settings: ['#23272b', '#5d6670'],
}

export function ScreenWave() {
  const screen = useUi((s) => s.screen)
  const prev = useRef<ScreenId | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  const stop = useRef<(() => void) | null>(null)

  const run = (tone: string, flash: string) => {
    stop.current?.()
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cols = Math.ceil(w / CELL)
    const rows = Math.ceil(h / CELL)
    const order = new Float32Array(cols * rows)
    let max = 1
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot((x + 0.5) * CELL - w / 2, (y + 0.5) * CELL - h / 2) * 0.72 + Math.random() * CELL * 3
        order[y * cols + x] = d
        if (d > max) max = d
      }
    cv.style.display = 'block'
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = now - t0
      ctx.clearRect(0, 0, w, h)
      let left = 0
      for (let i = 0; i < order.length; i++) {
        const at = (order[i] / max) * DISSOLVE_MS
        if (t >= at + FLASH_MS) continue
        left++
        ctx.fillStyle = t >= at ? flash : tone
        ctx.fillRect((i % cols) * CELL, Math.floor(i / cols) * CELL, CELL, CELL)
      }
      if (left) raf = requestAnimationFrame(tick)
      else cv.style.display = 'none'
    }
    raf = requestAnimationFrame(tick)
    stop.current = () => {
      cancelAnimationFrame(raf)
      cv.style.display = 'none'
    }
  }

  useEffect(() => {
    const was = prev.current
    prev.current = screen
    if (!was || was === screen) return
    // Зелёные экраны (лобби, сборки, серверы) — в цвет кнопок: он же у фона.
    const own = TONE[screen]
    const green = !own || own[0] === TONE.play[0]
    const base = accentBase()
    run(green ? shade(base, -0.55) : own[0], green ? shade(base, -0.1) : own[1])
  }, [screen])

  // Сменили цвет кнопок — волна в новый цвет (правка владельца 23.09.2026).
  useEffect(() => {
    let last = accentBase().toLowerCase()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Свой цвет тянут ползунком — событий десятки в секунду. Волна одна,
    // когда цвет перестал меняться (баг 23.09.2026: волна мешала смотреть).
    const on = (e: Event) => {
      const c = String((e as CustomEvent).detail || '').toLowerCase()
      if (!c) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (c === last) return
        last = c
        run(shade(c, -0.55), shade(c, -0.1))
      }, 450)
    }
    window.addEventListener(ACCENT_EVENT, on)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(ACCENT_EVENT, on)
      stop.current?.()
    }
  }, [])

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 8000, pointerEvents: 'none', display: 'none' }}
    />
  )
}
