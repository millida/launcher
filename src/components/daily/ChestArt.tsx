import type { CSSProperties } from 'react'
import type { ChestTier } from '../../lib/rubies'

/** Снимок 3D-сундука (scripts/chest-shots.mjs → public/chests): уровень и свой цвет ящика. */
export const chestShot = (tier: ChestTier, tint?: string) =>
  '/chests/' + tier.toLowerCase() + (tint ? '-' + tint.replace('#', '').toLowerCase() : '') + '.png'

/**
 * Сундук без живого холста — тот же 3D-сундук снимком (06.10.2026: плоский
 * «картонный» рисунок убран отовсюду). Клетки пропуска, плитки, запасной вид
 * без WebGL и пока 3D грузится. Готовый — подпрыгивает, за ним свет и искры.
 */
export function ChestArt({
  ready,
  size,
  opening,
  tier = 'COMMON',
  tint,
}: {
  ready: boolean
  size: number
  opening?: boolean
  tier?: ChestTier
  tint?: string
}) {
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
        <img src={chestShot(tier, tint)} alt="" draggable={false} />
      </span>
    </span>
  )
}
