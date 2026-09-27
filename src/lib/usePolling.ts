import { useEffect, useRef } from 'react'
import { isRealtimeLive, onRealtime, onRealtimeLiveChange } from './realtime'
import { realtimePaceMs, type RealtimeTopic } from './realtimePace'

interface Options {
  hiddenMs?: number
  enabled?: boolean
  immediate?: boolean
  /** A server poke of this topic refreshes at once, and the timer becomes a slow safety net while it is live. */
  realtime?: RealtimeTopic
}

export function usePolling(fn: () => void, ms: number, opts: Options = {}) {
  const { hiddenMs = ms * 4, enabled = true, immediate = true, realtime } = opts
  const saved = useRef(fn)
  saved.current = fn

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    let stopped = false

    const pace = () => realtimePaceMs(!!realtime && isRealtimeLive(), ms)
    const delay = () => (document.hidden ? hiddenMs : pace())

    const tick = () => {
      if (stopped) return
      if (!document.hidden || hiddenMs > 0) saved.current()
      timer = setTimeout(tick, delay())
    }

    const onVisible = () => {
      if (stopped || document.hidden) return
      clearTimeout(timer)
      saved.current()
      timer = setTimeout(tick, pace())
    }

    const rearm = () => {
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(tick, delay())
    }

    const onPoke = () => {
      if (stopped) return
      clearTimeout(timer)
      saved.current()
      timer = setTimeout(tick, delay())
    }

    if (immediate) saved.current()
    timer = setTimeout(tick, delay())
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
