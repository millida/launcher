import { useEffect, useState } from 'react'

/**
 * Сколько миллисекунд осталось до `target`. Тикает раз в секунду и только
 * пока нужен (`on`); на нуле зовёт `onZero` один раз — окно само узнаёт,
 * что сундук снова готов.
 */
export function useCountdown(target: number, on: boolean, onZero?: () => void): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    let fired = false
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (!fired && t >= target) {
        fired = true
        onZero?.()
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [target, on])
  return Math.max(0, target - now)
}
