import { useEffect, useRef, useState } from 'react'

// Kept in step with the frMenuOut keyframes: the panel is unmounted once the
// exit animation has played, not while it is still on screen.
const EXIT_MS = 130

export interface Popover<T extends HTMLElement> {
  open: boolean
  closing: boolean
  mounted: boolean
  ref: React.RefObject<T | null>
  toggle: () => void
  close: () => void
}

/// Dropdown panel that closes on outside click or Escape and keeps rendering
/// itself long enough to animate out.
export function usePopover<T extends HTMLElement>(): Popover<T> {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const ref = useRef<T>(null)
  const exit = useRef<ReturnType<typeof setTimeout>>(undefined)

  const close = () => {
    if (!open) return
    setOpen(false)
    setClosing(true)
    clearTimeout(exit.current)
    exit.current = setTimeout(() => setClosing(false), EXIT_MS)
  }

  const toggle = () => {
    if (open) {
      close()
      return
    }
    clearTimeout(exit.current)
    setClosing(false)
    setOpen(true)
  }

  useEffect(() => () => clearTimeout(exit.current), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, closing, mounted: open || closing, ref, toggle, close }
}
