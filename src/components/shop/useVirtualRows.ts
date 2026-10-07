import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Виртуальная сетка (QA 06.10.2026, «Что внутри» у «Осколочного» строило ~14 000
 * узлов): сетка `repeat(auto-fill, minmax(minCol, 1fr))` рисует только ряды
 * в окне прокрутки и `overscan` рядов вокруг, остальное — пустые отступы той же
 * высоты. Плитки одной высоты (меряется первая), прокрутка — ближайший предок
 * с overflow auto/scroll. Петли анимаций и снимки вещей живут только у видимых.
 */
export function rowWindow(o: { count: number; cols: number; rowH: number; top: number; height: number; overscan: number }) {
  const rows = Math.ceil(o.count / Math.max(1, o.cols))
  const h = Math.max(1, o.rowH)
  const first = Math.max(0, Math.floor(o.top / h) - o.overscan)
  const last = Math.min(rows, Math.ceil((o.top + o.height) / h) + o.overscan)
  return { start: first, end: Math.max(first, last), rows }
}

export function useVirtualRows(count: number, { minCol, gap, overscan = 2, guess = 230 }: { minCol: number; gap: number; overscan?: number; guess?: number }) {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const ref = useCallback((el: HTMLElement | null) => setBox(el), [])
  const [cols, setCols] = useState(4)
  const [rowH, setRowH] = useState(guess + gap)
  const [view, setView] = useState({ top: 0, height: 900 })
  const raf = useRef(0)

  useEffect(() => {
    if (!box) return
    let scroller: HTMLElement | null = box.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    const measure = () => {
      raf.current = 0
      const w = box.clientWidth
      const n = Math.max(1, Math.floor((w + gap) / (minCol + gap)))
      setCols(n)
      const tile = box.firstElementChild as HTMLElement | null
      if (tile && tile.offsetHeight) setRowH(tile.offsetHeight + gap)
      const sr = scroller ? scroller.getBoundingClientRect() : { top: 0, height: window.innerHeight }
      const br = box.getBoundingClientRect()
      setView({ top: sr.top - br.top, height: sr.height })
    }
    const ask = () => {
      if (!raf.current) raf.current = requestAnimationFrame(measure)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(ask) : null
    ro?.observe(box)
    const target: HTMLElement | Window = scroller ?? window
    target.addEventListener('scroll', ask, { passive: true })
    window.addEventListener('resize', ask)
    return () => {
      ro?.disconnect()
      target.removeEventListener('scroll', ask)
      window.removeEventListener('resize', ask)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [box, minCol, gap])

  const w = rowWindow({ count, cols, rowH, top: view.top, height: view.height, overscan })
  return {
    ref,
    from: w.start * cols,
    to: Math.min(count, w.end * cols),
    padTop: w.start * rowH,
    padBottom: Math.max(0, (w.rows - w.end) * rowH),
  }
}
