import { useEffect, useState } from 'react'
import { useUi } from '../state/ui'
import { tabTransitionMs } from '../state/viewPrefs'

/**
 * Heavy one-off work (shader compilation, snapshot encoding, recolouring)
 * waits until the screen transition has played out: run on the same frames,
 * it stalls the dissolve wave and the entry animations.
 */

const SETTLE_PAD_MS = 120
const IDLE_TIMEOUT_MS = 250

let changedAt = Number.NEGATIVE_INFINITY

useUi.subscribe((next, prev) => {
  if (next.screen !== prev.screen) changedAt = performance.now()
})

export function settleDelay(now: number, since: number, transitionMs: number, pad = SETTLE_PAD_MS): number {
  if (!Number.isFinite(since)) return 0
  return Math.max(0, since + Math.max(0, transitionMs) + pad - now)
}

type IdleWindow = { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }

function whenIdle(): Promise<void> {
  return new Promise((done) => {
    const idle = typeof window === 'undefined' ? undefined : (window as unknown as IdleWindow).requestIdleCallback
    if (idle) idle(() => done(), { timeout: IDLE_TIMEOUT_MS })
    else setTimeout(done, 0)
  })
}

export async function screenSettled(): Promise<void> {
  for (;;) {
    const wait = settleDelay(performance.now(), changedAt, tabTransitionMs())
    if (wait <= 0) break
    await new Promise((r) => setTimeout(r, wait))
  }
  await whenIdle()
}

export function useScreenSettled(): boolean {
  const [settled, setSettled] = useState(() => settleDelay(performance.now(), changedAt, tabTransitionMs()) <= 0)
  useEffect(() => {
    if (settled) return
    let alive = true
    void screenSettled().then(() => alive && setSettled(true))
    return () => {
      alive = false
    }
  }, [settled])
  return settled
}
