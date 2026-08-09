import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Icon } from './Icon'
import { backdropClose } from '../lib/dismiss'

interface LightboxState {
  src: string
  open: (src: string) => void
  close: () => void
}

export const useLightbox = create<LightboxState>((set) => ({
  src: '',
  open: (src) => set({ src }),
  close: () => set({ src: '' }),
}))

export const openImage = (src: string) => useLightbox.getState().open(src)

const MIN_SCALE = 1
const MAX_SCALE = 6
const STEP = 1.35

const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))

export function ImageLightbox() {
  const src = useLightbox((s) => s.src)
  const close = useLightbox((s) => s.close)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [src])

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === '+' || e.key === '=') setScale((s) => clamp(s * STEP))
      if (e.key === '-') setScale((s) => clamp(s / STEP))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, close])

  if (!src) return null

  // Zooming out to the fit size must also drop the pan, otherwise the picture
  // stays parked off-screen with no way to bring it back.
  const zoomTo = (next: number) => {
    const v = clamp(next)
    setScale(v)
    if (v === MIN_SCALE) setPan({ x: 0, y: 0 })
  }

  return (
    <div
      className="lightbox"
      {...backdropClose(close)}
      onWheel={(e) => zoomTo(scale * (e.deltaY < 0 ? STEP : 1 / STEP))}
    >
      <div className="lightbox-top" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-bar">
          <button className="lightbox-btn" title="Отдалить" onClick={() => zoomTo(scale / STEP)}>
            <Icon id="i-minus" />
          </button>
          <span className="lightbox-zoom">{Math.round(scale * 100) + '%'}</span>
          <button className="lightbox-btn" title="Приблизить" onClick={() => zoomTo(scale * STEP)}>
            <Icon id="i-plus" />
          </button>
        </div>
        <button className="lightbox-close" title="Закрыть (Esc)" data-sound="close" onClick={close}>
          <Icon id="i-x" />
          <span>Закрыть</span>
        </button>
      </div>
      <img
        src={src}
        alt=""
        draggable={false}
        className={'lightbox-img' + (scale > MIN_SCALE ? ' zoomed' : '')}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
        onDoubleClick={() => zoomTo(scale > MIN_SCALE ? MIN_SCALE : 2.5)}
        onPointerDown={(e) => {
          if (scale <= MIN_SCALE) return
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
        }}
        onPointerUp={(e) => {
          drag.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
      />
    </div>
  )
}
