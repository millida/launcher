import { useEffect, useMemo, useRef } from 'react'

/*
 * Число прокручивается разрядами, как на arcania.fun: у каждой цифры своя лента под маской,
 * старшие разряды садятся раньше младших. Двигает один CSS-переход на колонку, не JS по кадрам.
 */

const TURNS = [2, 2, 2, 1, 1]
const BASE_MS = 1600
const STAGGER_MS = 200
const EASE = 'cubic-bezier(0.25, 1, 0.5, 1)'

const rest = (cells: number) => `translateY(-${(((cells - 1) / cells) * 100).toFixed(5)}%)`

export function RollingNumber({ value }: { value: number }) {
  const text = String(value)
  const strips = useMemo(
    () =>
      text.split('').map((ch, i) => {
        const turns = TURNS[text.length - 1 - i] ?? 1
        const strip: number[] = []
        for (let t = 0; t < turns; t++) for (let d = 0; d < 10; d++) strip.push(d)
        for (let d = 0; d <= Number(ch); d++) strip.push(d)
        return strip
      }),
    [text],
  )
  const tracks = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const live = tracks.current.filter((el): el is HTMLSpanElement => !!el)
    for (const el of live) {
      el.style.transition = 'none'
      el.style.transform = 'translateY(0)'
    }
    // Один пересчёт на всех, чтобы сброс и запуск не склеились в один кадр.
    void live[0]?.offsetHeight
    live.forEach((el, j) => {
      el.style.transition = `transform ${BASE_MS + j * STAGGER_MS}ms ${EASE}`
      el.style.transform = rest(Number(el.dataset.cells))
    })
  }, [text])

  return (
    <span className="arc-rn" aria-label={text}>
      {strips.map((strip, i) => (
        <span key={i} className="arc-rn-col" aria-hidden>
          <span ref={(el) => void (tracks.current[i] = el)} data-cells={strip.length} style={{ transform: rest(strip.length) }}>
            {strip.map((d, j) => (
              <span key={j}>{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}
