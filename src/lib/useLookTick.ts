import { useEffect, useState } from 'react'
import { LOOK_EVENT } from './gameProfile'

/** Растёт при каждой смене скина, плаща или аккаунта (LOOK_EVENT): зависимость эффектов, что читают вид игрока. */
export function useLookTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((n) => n + 1)
    window.addEventListener(LOOK_EVENT, on)
    return () => window.removeEventListener(LOOK_EVENT, on)
  }, [])
  return tick
}
