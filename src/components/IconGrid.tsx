import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { BLOCK_ICONS } from '../lib/icons'
import { coverGradient, dominantColor } from '../lib/blockColor'

function IconCell({ src, on, tint, onPick }: { src: string; on: boolean; tint: boolean; onPick: () => void }) {
  const [color, setColor] = useState<string | null>(null)
  useEffect(() => {
    if (!tint) {
      setColor(null)
      return
    }
    let alive = true
    dominantColor(src).then((c) => alive && setColor(c))
    return () => {
      alive = false
    }
  }, [src, tint])
  const bg = color
    ? on
      ? coverGradient(color)
      : 'color-mix(in srgb, ' + color + ' 22%, transparent)'
    : undefined
  return (
    <div
      className={'icon-cell' + (on ? ' on' : '')}
      data-ic={src}
      style={bg ? ({ background: bg, '--cell-color': color } as CSSProperties) : undefined}
      onClick={onPick}
    >
      <img src={src} alt="" loading="lazy" />
    </div>
  )
}

export function IconGrid({
  id,
  current,
  onPick,
  style,
  flat,
}: {
  id: string
  current?: string | null
  onPick: (v: string) => void
  style?: CSSProperties
  /// The icon editor paints its own background behind the symbol, so a
  /// per-symbol tint there would fight the chosen colour.
  flat?: boolean
}) {
  const [sel, setSel] = useState<string | null | undefined>(current)
  useEffect(() => setSel(current), [current])
  return (
    <div className="icon-grid" id={id} style={style}>
      {BLOCK_ICONS.map((src) => (
        <IconCell
          key={src}
          src={src}
          on={src === sel}
          tint={!flat}
          onPick={() => {
            setSel(src)
            onPick(src)
          }}
        />
      ))}
    </div>
  )
}
