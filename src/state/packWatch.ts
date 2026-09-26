import { loadPremiumPack, type PremiumPackDetail } from '../lib/premium'

const EVERY = 5_000
const GIVE_UP = 15 * 60_000

/**
 * Payment for a pack subscription happens in the browser, so the launcher
 * learns about it only by asking, the same way it waits for PLUS. A failed
 * poll is retried on the next tick: one lost answer must not end the wait for
 * a purchase that is still in progress.
 */
export function watchPackPurchase(id: string, onOwned: (detail: PremiumPackDetail) => void): () => void {
  const started = Date.now()
  let stopped = false
  let timer: number | undefined

  const tick = async () => {
    if (stopped) return
    const detail = await loadPremiumPack(id).catch(() => null)
    if (stopped) return
    if (detail?.owned) {
      stopped = true
      onOwned(detail)
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
