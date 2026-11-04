import { useEffect, useRef, type RefObject } from 'react'

/**
 * Бесконечные анимации блока стоят, пока его не видно (06.10.2026): элемент
 * получает `data-off`, и shop-motion.css ставит всем потомкам
 * animation-play-state: paused. Так блики, вылеты и ленты не жгут кадры за
 * экраном и в свёрнутом окне. A block that already has a ref passes it here.
 */
export function useOffscreenPause<T extends HTMLElement>(existing?: RefObject<T | null>) {
  const own = useRef<T>(null)
  const ref = existing ?? own
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => {
      for (const e of es) e.target.toggleAttribute('data-off', !e.isIntersecting)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return ref
}
