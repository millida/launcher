import { loadPremiumPack, type PremiumPackDetail } from '../lib/premium'
import { isRealtimeLive, onRealtime } from '../lib/realtime'
import { pokeGate, purchaseWaitMs } from '../lib/realtimePace'

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
  let busy = false
  let timer: number | undefined

  const stop = () => {
    stopped = true
    window.clearTimeout(timer)
    offPoke()
  }

  const tick = async () => {
    if (stopped) return
    window.clearTimeout(timer)
    busy = true
    const detail = await loadPremiumPack(id).catch(() => null)
    busy = false
    if (stopped) return
    if (detail?.owned) {
      stop()
      onOwned(detail)
      return
    }
    if (gate.take()) {
      void tick()
      return
    }
    if (Date.now() - started < GIVE_UP) timer = window.setTimeout(() => void tick(), purchaseWaitMs(isRealtimeLive(), EVERY))
    else stop()
  }

  const gate = pokeGate(
    () => busy,
    () => void tick(),
  )
  const offPoke = onRealtime('account', gate.poke)

  timer = window.setTimeout(() => void tick(), EVERY)
  return stop
}
