import { useRef } from 'react'

/// Latches: false until the value is true once, then true for the life of the component.
export function useEverTrue(value: boolean): boolean {
  const seen = useRef(false)
  if (value) seen.current = true
  return seen.current
}
