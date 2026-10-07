import { loadPlus, type PlusStatus } from '../lib/gameProfile'
import { isRealtimeLive, onRealtime } from '../lib/realtime'
import { pokeGate, purchaseWaitMs } from '../lib/realtimePace'

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
    const status = await loadPlus().catch(() => null)
    busy = false
    if (stopped) return
    if (status?.active) {
      stop()
      // Премиум-тема включается сама один раз после оплаты (lib/premiumTheme).
      window.dispatchEvent(new CustomEvent('m-plus-bought', { detail: status.tier ?? 'PLUS' }))
      onActive(status)
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
