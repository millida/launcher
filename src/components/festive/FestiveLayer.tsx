import { useEffect, useRef, useSyncExternalStore } from 'react'
import '../../styles/pixel/festive.css'
import { particleStyle } from '../../lib/ambience'
import { currentSceneFpsCap } from '../../lib/deviceTier'
import { festiveActive, useFestive, type FestiveScene } from '../../lib/festiveStore'
import { useLiteMode } from '../../lib/liteMode'
import { onRenderGate, renderLive } from '../../lib/renderGate'
import { drawScene, makeScene, stepScene, type Scene } from '../../lib/seasonParticles'
import { readPref } from '../../lib/prefs'

/** Экранных пикселей в клетке снега: как в лобби. */
const PIXEL = 2
/** Самый высокий сугроб, экранных пикселей. */
const DRIFT_PX = 24

const REDUCE = '(prefers-reduced-motion: reduce)'
function subscribeReduce(cb: () => void): () => void {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(REDUCE) : undefined
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}
const reduceNow = () => typeof window !== 'undefined' && !!window.matchMedia?.(REDUCE).matches

/** «Живой фон» в настройках. Прямо из настроек, без state/viewPrefs: иначе сборщик выносит его
 *  в отдельный стартовый чанк, и стартовый бюджет растёт ради ленивого слоя. Событие то же. */
const VIEW_PREFS_EVENT = 'm-view-prefs'
function subscribeBg(cb: () => void): () => void {
  window.addEventListener(VIEW_PREFS_EVENT, cb)
  return () => window.removeEventListener(VIEW_PREFS_EVENT, cb)
}
const bgAnimNow = () => readPref('m-anim-bg', '1') !== '0'

/**
 * Снег во всём окне, сугробы у нижнего края, в новогоднюю ночь — фейерверки.
 * Холст в половину разрешения; кадры не чаще потолка сцены (30 на встроенной
 * графике, 60 на остальных); замирает в трее и пока поверх идёт игра (renderGate).
 */
function Snow({ scene }: { scene: FestiveScene }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const style = particleStyle(scene)
    const frameMs = 1000 / currentSceneFpsCap()
    let raf = 0
    let last = 0
    let sc: Scene | null = null

    const fit = (): Scene => {
      const w = Math.max(1, Math.floor(canvas.clientWidth / PIXEL))
      const h = Math.max(1, Math.floor(canvas.clientHeight / PIXEL))
      if (sc && canvas.width === w && canvas.height === h) return sc
      canvas.width = w
      canvas.height = h
      sc = makeScene(style, w, h, { pixel: PIXEL, drift: Math.round(DRIFT_PX / PIXEL), spark: 2 })
      return sc
    }

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (last && t - last < frameMs - 1) return
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0
      last = t
      const s = fit()
      stepScene(s, style, dt, t)
      drawScene(g, s, style, scene)
    }
    const start = () => {
      if (raf) return
      last = 0
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    if (renderLive()) start()
    const off = onRenderGate(() => (renderLive() ? start() : stop()))
    return () => {
      off()
      stop()
    }
  }, [scene])

  return <canvas ref={ref} className="fx-snow" />
}

/** Новогодняя тема поверх окна (lib/festive). Лёгкий режим, «меньше движения» и выключенный живой фон — без холста. */
export function FestiveLayer() {
  const scene = useFestive(festiveActive)
  const bgAnim = useSyncExternalStore(subscribeBg, bgAnimNow, bgAnimNow)
  const lite = useLiteMode()
  const reduced = useSyncExternalStore(subscribeReduce, reduceNow, reduceNow)
  if (!scene) return null
  return (
    <div className="fx-layer" aria-hidden="true">
      <div className="fx-garland" />
      {bgAnim && !lite && !reduced ? <Snow scene={scene} /> : null}
    </div>
  )
}
