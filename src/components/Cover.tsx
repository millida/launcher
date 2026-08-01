import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { coverGradient, dominantColor, isBlockIcon } from '../lib/blockColor'

export function Cover({ url }: { url?: string | null }) {
  const block = !!url && isBlockIcon(url)
  const [bg, setBg] = useState<string | null>(null)

  useEffect(() => {
    if (!url || !block) {
      setBg(null)
      return
    }
    let alive = true
    dominantColor(url).then((c) => {
      if (alive) setBg(c ? coverGradient(c) : null)
    })
    return () => {
      alive = false
    }
  }, [url, block])

  if (!url) {
    return (
      <span className="cover-ph">
        <Icon id="i-box2" />
      </span>
    )
  }
  return (
    <img
      className={block ? 'cover-img block' : 'cover-img'}
      src={url}
      loading="lazy"
      style={bg ? { background: bg } : undefined}
    />
  )
}
