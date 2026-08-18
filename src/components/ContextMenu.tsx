import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface ContextItem {
  id: string
  label: string
  icon: string
  danger?: boolean
  /// The separator is drawn ABOVE the item, so a destructive action stands
  /// apart from the ordinary ones and is not hit by accident.
  separated?: boolean
  onPick: () => void
}

interface Props {
  x: number
  y: number
  items: ContextItem[]
  onClose: () => void
}

/// Right-click menu. Closes on an outside click, Escape, scrolling and a window
/// resize — everything after which its coordinates stop meaning anything.
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Position is computed before paint: a menu opened near the bottom edge
  // would otherwise flash outside the window first.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const pad = 8
    setPos({
      x: Math.max(pad, Math.min(x, window.innerWidth - box.width - pad)),
      y: Math.max(pad, Math.min(y, window.innerHeight - box.height - pad)),
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return (
    <div
      className="ctx-menu"
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          className={'msg-menu-item' + (item.danger ? ' danger' : '') + (item.separated ? ' ctx-sep' : '')}
          onClick={() => {
            onClose()
            item.onPick()
          }}
        >
          <Icon id={item.icon} /> {item.label}
        </button>
      ))}
    </div>
  )
}
