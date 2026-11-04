import { useEffect, useRef, useState } from 'react'
import { dayPhase, particleStyle, seasonOf, type DayPhase, type Season } from '../../lib/ambience'
import { useAmbience } from '../../state/ambience'
import { useViewPrefs } from '../../state/viewPrefs'
import { liveInterval } from '../../lib/liveInterval'

const CLOCK_TICK_MS = 60_000
const PIXEL = 2

interface Flake {
  x: number
  y: number
  size: number
  speed: number
  phase: number
  color: string
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    return liveInterval(() => setNow(new Date()), CLOCK_TICK_MS)
  }, [enabled])
  return now
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)] ?? list[0]

function SeasonLayer({ season, on }: { season: Season; on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g || !on) return
    const style = particleStyle(season)
    let raf = 0
    let last = performance.now()
    let nextBurst = 0
    let flakes: Flake[] = []
    const sparks: Spark[] = []

    const fit = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth / PIXEL))
      const h = Math.max(1, Math.floor(canvas.clientHeight / PIXEL))
      if (canvas.width === w && canvas.height === h) return
      canvas.width = w
      canvas.height = h
      flakes = Array.from({ length: style.count }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        size: Math.round(rand(style.size[0], style.size[1]) / PIXEL) || 1,
        speed: rand(style.fall[0], style.fall[1]) / PIXEL,
        phase: rand(0, Math.PI * 2),
        color: pick(style.colors),
      }))
    }

    const burst = (w: number, h: number) => {
      const x = rand(w * 0.15, w * 0.85)
      const y = rand(h * 0.1, h * 0.45)
      const color = pick(style.colors)
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2
        const v = rand(14, 30)
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color })
      }
    }

    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      fit()
      const w = canvas.width
      const h = canvas.height
      g.clearRect(0, 0, w, h)
      for (const f of flakes) {
        f.y += f.speed * dt
        f.x += Math.sin(t / 1000 + f.phase) * style.drift * dt * 0.2
        if (f.y > h) {
          f.y = -f.size
          f.x = rand(0, w)
        }
        g.fillStyle = f.color
        g.fillRect(Math.round(f.x), Math.round(f.y), f.size, f.size)
        if (season === 'halloween' && f.size > 1) {
          g.fillStyle = style.colors[2] ?? f.color
          g.fillRect(Math.round(f.x + f.size / 2), Math.round(f.y) - 1, 1, 1)
        }
      }
      if (season === 'newyear') {
        if (t > nextBurst) {
          burst(w, h)
          nextBurst = t + rand(900, 1800)
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]
          if (!s) continue
          s.x += s.vx * dt
          s.y += s.vy * dt
          s.vy += 12 * dt
          s.life -= dt * 0.7
          if (s.life <= 0) {
            sparks.splice(i, 1)
            continue
          }
          g.globalAlpha = Math.max(0, s.life)
          g.fillStyle = s.color
          g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1)
        }
        g.globalAlpha = 1
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onVisible = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [season, on])

  return <canvas ref={ref} className="lobby-season" aria-hidden="true" />
}

/// Lobby extras over the scene: a light that follows the clock and seasonal particles.
/// Both stay still when the player turned background animation off or asked the OS for less motion.
export function LobbyAmbience({ on }: { on: boolean }) {
  const daytime = useAmbience((s) => s.daytime)
  const seasonal = useAmbience((s) => s.seasonal)
  const bgAnim = useViewPrefs((s) => s.bgAnim)
  const perf = useViewPrefs((s) => s.perf)
  const now = useNow(daytime || seasonal)
  const phase: DayPhase = dayPhase(now)
  const season = seasonal ? seasonOf(now) : null
  const animate = on && bgAnim && perf !== 'low' && !reducedMotion()
  return (
    <>
      {daytime ? <div className={'lobby-daylight ' + phase} aria-hidden="true" /> : null}
      {season && animate ? <SeasonLayer season={season} on={animate} /> : null}
    </>
  )
}
