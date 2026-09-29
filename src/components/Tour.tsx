import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(min, v), Math.max(min, max))

export function cardPos(
  box: Box | null,
  cardH: number,
  vw: number = window.innerWidth,
  vh: number = window.innerHeight,
): { left: number; top: number } {
  if (!box) return { left: Math.max(GAP, (vw - CARD_W) / 2), top: Math.max(GAP, (vh - cardH) / 2) }
  const maxTop = vh - cardH - GAP
  const right = box.left + box.width + GAP
  if (right + CARD_W + GAP <= vw) return { left: right, top: clamp(box.top, GAP, maxTop) }
  const left = clamp(box.left, GAP, vw - CARD_W - GAP)
  const below = box.top + box.height + GAP
  if (below <= maxTop) return { left, top: below }
  const above = box.top - GAP - cardH
  if (above >= GAP) return { left, top: above }
  const beside = box.left - GAP - CARD_W
  if (beside >= GAP) return { left: beside, top: clamp(box.top, GAP, maxTop) }
  return { left, top: clamp(below, GAP, maxTop) }
}

export function Tour() {
  const active = useTour((s) => s.active)
  const index = useTour((s) => s.index)
  const [box, setBox] = useState<Box | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(200)

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight
    if (h && Math.abs(h - cardH) >= 1) setCardH(h)
  })

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
  const pos = cardPos(box, cardH)

  return (
    <div className="tour-layer" onClick={(e) => e.stopPropagation()}>
      {box ? (
        <div className="tour-hole" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div ref={cardRef} className="tour-card" style={{ left: pos.left, top: pos.top, width: CARD_W }}>
        {/* Счётчик шагов — полоской, как в первой настройке: видно без чтения. */}
        <div className="tour-bar" aria-label={'Шаг ' + (index + 1) + ' из ' + TOUR_STEPS.length}>
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={'tour-bar-seg' + (i <= index ? ' on' : '')}></span>
          ))}
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
