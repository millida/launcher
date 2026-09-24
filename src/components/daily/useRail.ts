import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Лента прокрутки: колесо листает вбок, мышью можно тащить, стрелки —
 * на `step` пикселей. Клик после перетаскивания гасится, чтобы не открыть PLUS
 * или сундук случайно.
 */
export function useRail(focus: unknown, step: number, focusSel?: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })

  const sync = () => {
    const el = ref.current
    if (!el) return
    setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft < el.scrollWidth - el.clientWidth - 2 })
  }

  // Первая клетка, которую можно забрать (или ближайшая закрытая), — по
  // центру: при открытии и после раскрытия награды.
  useLayoutEffect(() => {
    const el = ref.current
    const now = focusSel ? el?.querySelector<HTMLElement>(focusSel) : null
    if (el && now) el.scrollLeft = now.offsetLeft + now.offsetWidth / 2 - el.clientWidth / 2
    sync()
  }, [focus])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    let x0 = 0
    let s0 = 0
    let id = -1
    let moved = false
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      id = e.pointerId
      x0 = e.clientX
      s0 = el.scrollLeft
      moved = false
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      const dx = e.clientX - x0
      if (!moved && Math.abs(dx) < 5) return
      if (!moved) {
        moved = true
        el.setPointerCapture(id)
        el.classList.add('drag')
      }
      el.scrollLeft = s0 - dx
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      id = -1
      el.classList.remove('drag')
    }
    const click = (e: MouseEvent) => {
      if (!moved) return
      moved = false
      e.stopPropagation()
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('click', click, true)
    el.addEventListener('scroll', sync, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('click', click, true)
      el.removeEventListener('scroll', sync)
    }
  }, [])

  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * step, behavior: 'smooth' })
  return { ref, edge, page }
}
