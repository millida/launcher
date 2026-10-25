import { useEffect, useRef, useState } from 'react'

/**
 * Бесконечная листалка с автопоказом (та же, что на arcania.fun). Список рисуется трижды,
 * позиция живёт в средней копии; ушла в крайнюю — тихо, без анимации, переставляется
 * обратно: кадры те же, глазу не видно. Автопоказ идёт, пока блок на экране; ручной
 * выбор его не выключает — показ продолжается дальше с выбранного кадра (владелец
 * 22.10.2026). holdMs — время кадра (у видео больше).
 */
export function useLoopCarousel<T extends HTMLElement>(count: number, holdMs: (active: number) => number) {
  const rootRef = useRef<T>(null)
  const [pos, setPos] = useState(count)
  const [animated, setAnimated] = useState(true)
  const [visible, setVisible] = useState(false)
  const autoplay = true
  const active = ((pos % count) + count) % count

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!autoplay || !visible) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setTimeout(() => {
      setAnimated(true)
      setPos((p) => p + 1)
    }, holdMs(active))
    return () => window.clearTimeout(id)
  }, [autoplay, visible, pos, holdMs, active])

  useEffect(() => {
    if (animated) return
    const id = requestAnimationFrame(() => setAnimated(true))
    return () => cancelAnimationFrame(id)
  }, [animated])

  /** По окончании перехода дорожки. */
  const settle = () => {
    if (pos >= 2 * count || pos < count) {
      setAnimated(false)
      setPos(count + active)
    }
  }

  // Таймер кадра заводится заново от выбранного кадра: эффект выше зависит от pos.
  const go = (row: number) => {
    setAnimated(true)
    setPos(row)
  }

  return { rootRef, pos, active, animated, playing: autoplay && visible, settle, go }
}
