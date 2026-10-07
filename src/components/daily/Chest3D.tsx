import { useEffect, useRef, useState } from 'react'
import type { ChestTier } from '../../lib/rubies'
import type { ChestLook, ChestMode, ChestScene } from './chestScene'
import { ChestArt } from './ChestArt'
import { gpuLite } from '../../lib/gpuLite'

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
  flatSize = 96,
  // Один вид сундуков во всём лаунчере (06.10.2026): модель, а не кубик.
  look = 'model',
  tint,
  onOpened,
  noFlat,
}: {
  tier: ChestTier
  mode: ChestMode
  framing?: 'hero' | 'reveal'
  className?: string
  flatSize?: number
  look?: ChestLook
  /** Свой цвет сундука: модель перекрашивается (ящики магазина). */
  tint?: string
  onOpened?: () => void
  /** Пока грузится 3D — пусто, а не плоский рисунок (иначе в открытии мелькал чужой сундук). */
  noFlat?: boolean
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
          look,
          tint,
          onOpened: () => openedRef.current?.(),
          onLost: () => {
            if (!alive) return
            sceneRef.current?.dispose()
            sceneRef.current = null
            setState('failed')
          },
        })
        if (!scene) {
          setState('failed')
          return
        }
        sceneRef.current = scene
        // Потерю общего контекста сундуков ловит chestGl (onLost выше):
        // дальше рисунок, второй раз за сеанс — лёгкая графика (lib/gpuLite).
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
      {state === 'failed' || (state !== 'ready' && !noFlat) ? (
        <span className={'c3d-flat' + (mode === 'shake' ? ' shake' : '')}>
          <ChestArt ready={mode === 'ready'} opening={mode === 'shake' || mode === 'open'} tier={tier} tint={tint} size={flatSize} />
        </span>
      ) : null}
    </div>
  )
}
