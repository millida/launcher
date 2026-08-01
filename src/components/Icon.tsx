import type { CSSProperties } from 'react'

export function Icon({
  id,
  className = 'icon',
  style,
}: {
  id: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg className={className} style={style}>
      <use href={'#' + id} />
    </svg>
  )
}
