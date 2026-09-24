import { loadPlus, type PlusStatus } from '../lib/gameProfile'

const EVERY = 5_000
const GIVE_UP = 15 * 60_000

/**
 * Payment happens in the browser, so the launcher learns about it only by
 * asking. A failed poll is retried on the next tick: one lost answer must not
 * end the wait for a purchase that is still in progress.
 */
export function watchPlusPurchase(onActive: (status: PlusStatus) => void): () => void {
  const started = Date.now()
  let stopped = false
  let timer: number | undefined

  const tick = async () => {
    if (stopped) return
    const status = await loadPlus().catch(() => null)
    if (stopped) return
    if (status?.active) {
      stopped = true
      onActive(status)
      return
    }
    if (Date.now() - started < GIVE_UP) timer = window.setTimeout(() => void tick(), EVERY)
  }

  timer = window.setTimeout(() => void tick(), EVERY)
  return () => {
    stopped = true
    window.clearTimeout(timer)
  }
}
