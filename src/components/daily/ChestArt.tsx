import { useMemo, type CSSProperties } from 'react'
import type { ChestTier } from '../../lib/rubies'
import { chestSprite } from './chestSprite'

/**
 * 2D-сундук: клетки трека, плашка лобби и запасной вид, если WebGL недоступен.
 * Рисунок — пиксель-арт уровня (chestSprite.ts, 40×46 клеток без
 * сглаживания): тот же, что в «Моих сундуках» и в окне открытия, чтобы
 * сундук из клетки узнавался в витрине. Готовый сундук подпрыгивает
 * ступенями, за ним мигает плитка цвета редкости и загораются искры.
 */
export function ChestArt({
  ready,
  size,
  opening,
  tier = 'COMMON',
}: {
  ready: boolean
  size: number
  opening?: boolean
  tier?: ChestTier
}) {
  const src = useMemo(() => chestSprite(tier), [tier])
  return (
    <span
      className={'dc-art tier-' + tier.toLowerCase() + (ready ? ' ready' : '') + (opening ? ' opening' : '')}
      style={{ '--dc-size': size + 'px' } as CSSProperties}
      aria-hidden="true"
    >
      {ready || opening ? (
        <>
          <span className="dc-halo" />
          <i className="dc-spark s1" />
          <i className="dc-spark s2" />
          <i className="dc-spark s3" />
          <i className="dc-spark s4" />
        </>
      ) : null}
      <span className="dc-bob">
        {src ? <img src={src} alt="" draggable={false} /> : null}
      </span>
    </span>
  )
}
