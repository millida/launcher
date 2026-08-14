import type { CSSProperties } from 'react'
import { headNick, useHead } from '../lib/heads'

export function Head({
  nick,
  size = 32,
  src,
  kind,
  className,
  style,
  alt = '',
  title,
  id,
}: {
  nick?: string
  size?: number
  src?: string | null
  kind?: string
  className?: string
  style?: CSSProperties
  alt?: string
  title?: string
  id?: string
}) {
  const url = useHead(headNick(nick, kind), size, src || null)
  return (
    <img
      id={id}
      src={url}
      alt={alt}
      title={title}
      className={className}
      width={size}
      height={size}
      // The render is requested at exactly twice the box (see headPx), so the
      // ratio is whole on every display and nearest-neighbour keeps it sharp.
      style={{ imageRendering: 'pixelated', ...style }}
    />
  )
}
