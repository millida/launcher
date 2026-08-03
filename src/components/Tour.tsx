import { useEffect, useState } from 'react'
import { TOUR_STEPS, stopTour, tourNext, tourPrev, useTour } from '../state/tour'

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const PAD = 8
const CARD_W = 320
const GAP = 16

const same = (a: Box | null, b: Box | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1)

function measure(sel: string): Box | null {
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  return { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

function cardPos(box: Box | null): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!box) return { left: Math.max(GAP, (vw - CARD_W) / 2), top: Math.max(GAP, vh / 2 - 90) }
  const right = box.left + box.width + GAP
  const fitsRight = right + CARD_W + GAP <= vw
  const left = fitsRight ? right : Math.min(Math.max(GAP, box.left), vw - CARD_W - GAP)
  const rawTop = fitsRight ? box.top : box.top + box.height + GAP
  return { left, top: Math.min(Math.max(GAP, rawTop), Math.max(GAP, vh - 210)) }
}

export function Tour() {
  const active = useTour((s) => s.active)
  const index = useTour((s) => s.index)
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    if (!active) return
    const step = TOUR_STEPS[index]
    // The target can arrive late: a screen chunk may still be loading when the
    // step opens, and the sidebar animates its width.
    const tick = () => setBox((cur) => (same(cur, measure(step.sel)) ? cur : measure(step.sel)))
    tick()
    const t = setInterval(tick, 200)
    window.addEventListener('resize', tick)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', tick)
    }
  }, [active, index])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopTour()
      if (e.key === 'ArrowRight' || e.key === 'Enter') tourNext()
      if (e.key === 'ArrowLeft') tourPrev()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active])

  if (!active) return null
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1
  const pos = cardPos(box)

  return (
    <div className="tour-layer" onClick={(e) => e.stopPropagation()}>
      {box ? (
        <div className="tour-hole" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={{ left: pos.left, top: pos.top, width: CARD_W }}>
        <div className="tour-step">
          Шаг {index + 1} из {TOUR_STEPS.length}
        </div>
        <h4>{step.title}</h4>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button className="btn sm ghost" onClick={stopTour}>
            Пропустить
          </button>
          <span className="tour-spacer"></span>
          {index > 0 ? (
            <button className="btn sm secondary" onClick={tourPrev}>
              Назад
            </button>
          ) : null}
          <button className="btn sm primary" onClick={tourNext}>
            {last ? 'Готово' : 'Далее'}
          </button>
        </div>
      </div>
    </div>
  )
}
