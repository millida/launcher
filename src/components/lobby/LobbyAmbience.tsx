import { useEffect, useRef, useState } from 'react'
import { dayPhase, particleStyle, seasonOf, type DayPhase, type Season } from '../../lib/ambience'
import { useAmbience } from '../../state/ambience'
import { useViewPrefs } from '../../state/viewPrefs'
import { liveInterval } from '../../lib/liveInterval'
import { drawScene, makeScene, stepScene, type Scene } from '../../lib/seasonParticles'
import { festiveActive, useFestive } from '../../lib/festiveStore'

const CLOCK_TICK_MS = 60_000
const PIXEL = 2

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    return liveInterval(() => setNow(new Date()), CLOCK_TICK_MS)
  }, [enabled])
  return now
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function SeasonLayer({ season, on }: { season: Season; on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g || !on) return
    const style = particleStyle(season)
    let raf = 0
    let last = performance.now()
    let scene: Scene | null = null

    const fit = (): Scene => {
      const w = Math.max(1, Math.floor(canvas.clientWidth / PIXEL))
      const h = Math.max(1, Math.floor(canvas.clientHeight / PIXEL))
      if (scene && canvas.width === w && canvas.height === h) return scene
      canvas.width = w
      canvas.height = h
      scene = makeScene(style, w, h, { pixel: PIXEL })
      return scene
    }

    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const sc = fit()
      stepScene(sc, style, dt, t)
      drawScene(g, sc, style, season)
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
  // Новогодняя тема рисует снег во всём окне (components/festive): второй слой в лобби задвоил бы его.
  const festive = useFestive((s) => festiveActive(s) !== null)
  const animate = on && bgAnim && perf !== 'low' && !reducedMotion() && !festive
  return (
    <>
      {daytime ? <div className={'lobby-daylight ' + phase} aria-hidden="true" /> : null}
      {season && animate ? <SeasonLayer season={season} on={animate} /> : null}
    </>
  )
}
