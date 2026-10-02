import { useEffect, useRef } from 'react'
import { isRealtimeLive, onRealtime, onRealtimeLiveChange } from './realtime'
import { realtimePaceMs, type RealtimeTopic } from './realtimePace'

interface Options {
  hiddenMs?: number
  enabled?: boolean
  immediate?: boolean
  /** A server poke of this topic refreshes at once, and while the socket is live the timer stops. */
  realtime?: RealtimeTopic
}

export function usePolling(fn: () => void, ms: number, opts: Options = {}) {
  const { hiddenMs = ms * 4, enabled = true, immediate = true, realtime } = opts
  const saved = useRef(fn)
  saved.current = fn

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const pace = () => realtimePaceMs(!!realtime && isRealtimeLive(), ms)
    const delay = () => {
      const p = pace()
      return p === null ? null : document.hidden ? hiddenMs : p
    }
    const arm = (wait: number | null) => {
      clearTimeout(timer)
      timer = wait === null ? undefined : setTimeout(tick, wait)
    }

    const tick = () => {
      if (stopped) return
      if (!document.hidden || hiddenMs > 0) saved.current()
      arm(delay())
    }

    const onVisible = () => {
      if (stopped || document.hidden || pace() === null) return
      saved.current()
      arm(pace())
    }

    const rearm = () => {
      if (stopped) return
      arm(delay())
    }

    const onPoke = () => {
      if (stopped) return
      saved.current()
      arm(delay())
    }

    if (immediate) saved.current()
    arm(delay())
    document.addEventListener('visibilitychange', onVisible)
    const offPoke = realtime ? onRealtime(realtime, onPoke) : () => {}
    const offLive = realtime ? onRealtimeLiveChange(rearm) : () => {}
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      offPoke()
      offLive()
    }
  }, [ms, hiddenMs, enabled, immediate, realtime])
}
