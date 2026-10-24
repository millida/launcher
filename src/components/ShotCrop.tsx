import { useEffect, useRef, useState } from 'react'
import { backdropClose } from '../lib/dismiss'
import { cropScreenshot, type Screenshot } from '../ipc/commands'
import { coreErrorText } from '../lib/coreErrors'
import { showToast } from '../state/ui'
import { useT } from '../i18n'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/// Turns a drag on the shown image into a rectangle in the picture's own pixels.
export function toImageRect(box: Box, shownW: number, shownH: number, realW: number, realH: number) {
  const sx = realW / Math.max(1, shownW)
  const sy = realH / Math.max(1, shownH)
  const x = Math.max(0, Math.round(Math.min(box.x, box.x + box.w) * sx))
  const y = Math.max(0, Math.round(Math.min(box.y, box.y + box.h) * sy))
  const width = Math.min(realW - x, Math.round(Math.abs(box.w) * sx))
  const height = Math.min(realH - y, Math.round(Math.abs(box.h) * sy))
  return { x, y, width, height }
}

export function ShotCrop({ shot, src, onClose, onSaved }: { shot: Screenshot; src: string; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const img = useRef<HTMLImageElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [busy, setBusy] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const point = (e: React.PointerEvent) => {
    const r = img.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }
  }

  const save = async () => {
    const el = img.current
    if (!box || !el) return
    const rect = toImageRect(box, el.clientWidth, el.clientHeight, el.naturalWidth || shot.width, el.naturalHeight || shot.height)
    setBusy(true)
    try {
      await cropScreenshot(shot.profile, shot.name, rect)
      showToast(t('Обрезка сохранена рядом с оригиналом'), 'ok')
      onSaved()
      onClose()
    } catch (e) {
      showToast(coreErrorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const norm = box ? { left: Math.min(box.x, box.x + box.w), top: Math.min(box.y, box.y + box.h), width: Math.abs(box.w), height: Math.abs(box.h) } : null

  return (
    <div className="modal-bg open vis" style={{ zIndex: 965 }} {...backdropClose(onClose)}>
      <div className="modal mw-xl shot-crop" role="dialog" aria-modal="true" aria-label={t('Обрезать скриншот')}>
        <h3>{t('Обрезать скриншот')}</h3>
        <div
          className="shot-crop-stage"
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
            const p = point(e)
            start.current = p
            setBox({ x: p.x, y: p.y, w: 0, h: 0 })
          }}
          onPointerMove={(e) => {
            if (!start.current) return
            const p = point(e)
            setBox({ x: start.current.x, y: start.current.y, w: p.x - start.current.x, h: p.y - start.current.y })
          }}
          onPointerUp={() => {
            start.current = null
          }}
        >
          <img ref={img} src={src} alt={shot.name} draggable={false} />
          {norm ? <span className="shot-crop-box" style={{ left: norm.left, top: norm.top, width: norm.width, height: norm.height }} /> : null}
        </div>
        <div className="shot-crop-actions">
          <button className="btn md secondary" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn md primary" disabled={busy || !norm || norm.width < 8 || norm.height < 8} onClick={() => void save()}>
            {t('Сохранить копию')}
          </button>
        </div>
      </div>
    </div>
  )
}
