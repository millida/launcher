import { useEffect, useRef } from 'react'

interface Options {
  hiddenMs?: number
  enabled?: boolean
  immediate?: boolean
}

export function usePolling(fn: () => void, ms: number, opts: Options = {}) {
  const { hiddenMs = ms * 4, enabled = true, immediate = true } = opts
  const saved = useRef(fn)
  saved.current = fn

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    let stopped = false

    const delay = () => (document.hidden ? hiddenMs : ms)

    const tick = () => {
      if (stopped) return
      if (!document.hidden || hiddenMs > 0) saved.current()
      timer = setTimeout(tick, delay())
    }

    const onVisible = () => {
      if (stopped || document.hidden) return
      clearTimeout(timer)
      saved.current()
      timer = setTimeout(tick, ms)
    }

    if (immediate) saved.current()
    timer = setTimeout(tick, delay())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms, hiddenMs, enabled, immediate])
}
