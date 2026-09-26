import { useEffect, useRef, useState } from 'react'
import type { ChestTier } from '../../lib/rubies'
import type { ChestMode, ChestScene } from './chestScene'
import { ChestArt } from './ChestArt'
import { gpuLite, noteContextLost } from '../../lib/gpuLite'

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * 3D-сундук. three грузится отдельным чанком при первом показе; пока он
 * едет или если WebGL недоступен, стоит 2D-рисунок того же сундука.
 */
export function Chest3D({
  tier,
  mode,
  framing = 'hero',
  className,
  onOpened,
}: {
  tier: ChestTier
  mode: ChestMode
  framing?: 'hero' | 'reveal'
  className?: string
  onOpened?: () => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<ChestScene | null>(null)
  const openedRef = useRef(onOpened)
  openedRef.current = onOpened
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    let alive = true
    let ro: ResizeObserver | null = null
    let onLost: ((ev: Event) => void) | null = null
    const cvAtMount = canvas.current
    // Лёгкая графика после сбоя видеокарты — сразу 2D-рисунок, без WebGL.
    if (gpuLite()) {
      setState('failed')
      return
    }
    let io: IntersectionObserver | null = null
    import('./chestScene')
      .then((m) => {
        if (!alive || !canvas.current || !wrap.current) return
        const scene = m.createChestScene(canvas.current, {
          tier,
          mode: modeRef.current,
          reduced: reducedMotion(),
          framing,
          onOpened: () => openedRef.current?.(),
        })
        if (!scene) {
          setState('failed')
          return
        }
        sceneRef.current = scene
        // Видеокарта отобрала контекст — дальше рисунок; второй раз за сеанс
        // включает лёгкую графику (lib/gpuLite).
        const cv = canvas.current
        onLost = (ev: Event) => {
          ev.preventDefault()
          noteContextLost()
          sceneRef.current?.dispose()
          sceneRef.current = null
          setState('failed')
        }
        cv.addEventListener('webglcontextlost', onLost)
        const el = wrap.current
        scene.resize(el.clientWidth, el.clientHeight)
        ro = new ResizeObserver(() => scene.resize(el.clientWidth, el.clientHeight))
        ro.observe(el)
        // Сундук за краем ленты магазина не жжёт кадры.
        io = new IntersectionObserver((es) => scene.setVisible(es.some((e) => e.isIntersecting)))
        io.observe(el)
        setState('ready')
      })
      .catch(() => alive && setState('failed'))
    return () => {
      alive = false
      ro?.disconnect()
      if (onLost) cvAtMount?.removeEventListener('webglcontextlost', onLost)
      io?.disconnect()
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setMode(mode)
  }, [mode])
  useEffect(() => {
    sceneRef.current?.setTier(tier)
  }, [tier])

  // Без WebGL карточки не ждут крышку: «открытие» наступает сразу.
  useEffect(() => {
    if (state === 'failed' && mode === 'open') openedRef.current?.()
  }, [state, mode])

  return (
    <div ref={wrap} className={'c3d' + (className ? ' ' + className : '')} aria-hidden="true">
      <canvas ref={canvas} className={state === 'ready' ? 'on' : ''} />
      {state !== 'ready' ? (
        <span className={'c3d-flat' + (mode === 'shake' ? ' shake' : '')}>
          <ChestArt ready={mode === 'ready'} opening={mode === 'shake' || mode === 'open'} tier={tier} size={96} />
        </span>
      ) : null}
    </div>
  )
}
