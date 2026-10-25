import { useEffect, useRef, useState } from 'react'

/**
 * Endless carousel: the list is rendered three times and the position lives in the middle copy;
 * when it reaches an outer copy it jumps back without animation, which the eye cannot see.
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

  const settle = () => {
    if (pos >= 2 * count || pos < count) {
      setAnimated(false)
      setPos(count + active)
    }
  }

  const go = (row: number) => {
    setAnimated(true)
    setPos(row)
  }

  return { rootRef, pos, active, animated, playing: autoplay && visible, settle, go }
}
