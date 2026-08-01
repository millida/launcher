import { useCallback, useEffect, useRef } from 'react'

/// Custom slider instead of the native <input type="range"> OS control.
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  width,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  width?: number | string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100))

  const fromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return value
      const r = el.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)))
      const raw = min + ratio * (max - min)
      const snapped = Math.round(raw / step) * step
      return Math.max(min, Math.min(max, snapped))
    },
    [min, max, step, value],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const move = (e: PointerEvent) => {
      if (!dragging.current) return
      onChange(fromClientX(e.clientX))
    }
    const up = () => {
      dragging.current = false
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [fromClientX, onChange])

  return (
    <div
      className="m-slider"
      style={{ width: width || '100%' }}
      role="slider"
      tabIndex={0}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(min, value - step))
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(max, value + step))
      }}
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        onChange(fromClientX(e.clientX))
      }}
    >
      <div className="m-slider-track" ref={trackRef}>
        <div className="m-slider-fill" style={{ width: pct + '%' }}></div>
        <div className="m-slider-thumb" style={{ left: pct + '%' }}></div>
      </div>
    </div>
  )
}
