import { useEffect, useRef } from 'react'

/**
 * Бесконечные анимации блока стоят, пока его не видно (06.10.2026): элемент
 * получает `data-off`, и shop-motion.css ставит всем потомкам
 * animation-play-state: paused. Так блики, вылеты и ленты не жгут кадры за
 * экраном и в свёрнутом окне.
 */
export function useOffscreenPause<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => {
      for (const e of es) e.target.toggleAttribute('data-off', !e.isIntersecting)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}
