import type { CSSProperties } from 'react'
import '../styles/pixel/currency.css'

/**
 * Значки валют — воксельные рендеры в стиле сундуков (scripts/voxel-art,
 * 06.10.2026): рубин, осколок, фрагмент цвета редкости. Три плотности
 * (48/96/192 px), браузер берёт ближайшую к размеру показа — значок резкий
 * и на 14 px в цене, и на 150 px в награде.
 */
export type CurrencyArt = 'ruby' | 'shard' | `fragment-${'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'relic'}`

export function CurrencyIcon({ art, size = 20, className, style }: { art: CurrencyArt; size?: number; className?: string; style?: CSSProperties }) {
  const base = '/currency/' + art
  return (
    <img
      src={base + (size <= 24 ? '-48' : size <= 48 ? '-96' : '') + '.png'}
      srcSet={base + '-48.png 48w, ' + base + '-96.png 96w, ' + base + '.png 192w'}
      sizes={size + 'px'}
      width={size}
      height={size}
      className={'cur-ic' + (className ? ' ' + className : '')}
      style={style}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
