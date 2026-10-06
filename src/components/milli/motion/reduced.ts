import { useSyncExternalStore } from 'react'

/*
 * prefers-reduced-motion: один MediaQueryList на всё приложение. CSS гасит
 * анимации сам (milli-motion.css), хуки спрашивают `reducedMotion()` и делают
 * всё мгновенно.
 */

const QUERY = '(prefers-reduced-motion: reduce)'
let mql: MediaQueryList | null | undefined

function list(): MediaQueryList | null {
  if (mql === undefined) mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null
  return mql
}

/** Сейчас включено «уменьшить движение» (или нет окна — тесты/SSR). */
export function reducedMotion(): boolean {
  const m = list()
  return m ? m.matches : true
}

function subscribe(cb: () => void): () => void {
  const m = list()
  if (!m) return () => {}
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedMotion, () => true)
}
