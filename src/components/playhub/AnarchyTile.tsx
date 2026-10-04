import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { fmtN } from '../../lib/format'
import { ANARCHY } from '../../lib/ownServer'
import { useAnarchy } from '../../lib/anarchy'
import { ANARCHY_BANNER, ANARCHY_HERO, LAVA_STRIP, OBSIDIAN_TILE } from './anarchyArt'

/** The players line follows the shelf rule: a number only when it is live and at least 20. */
export const anarchyOnlineShown = (online: number | null | undefined): online is number => typeof online === 'number' && online >= 20

/** Still art for cards: the player render on the obsidian wall over lava. */
export function AnarchyArt({ className }: { className?: string }) {
  return (
    <span className={'an-art' + (className ? ' ' + className : '')}>
      <img src={ANARCHY_BANNER} alt="" draggable={false} />
      <img className="an-art-hero" src={ANARCHY_HERO} alt="" draggable={false} />
      <span className="an-art-lava" style={{ '--lava': 'url("' + LAVA_STRIP + '")' } as CSSProperties} />
    </span>
  )
}

/**
 * The anarchy tile of "Режимы", two cells wide, in the palette of the lobby
 * banner: obsidian, lava and white, with only the lava moving. Pressing it
 * starts the game.
 */
export function AnarchyTile({ online, on, index, onClick }: { online: number | null; on?: boolean; index: number; onClick: () => void }) {
  const an = useAnarchy()
  return (
    <button
      className={'ph-card ph-mt ph-mt-an' + (on ? ' on' : '')}
      data-sound="open"
      data-kind="own_server"
      data-id={ANARCHY.mode}
      data-pos={index}
      data-src="mode"
      aria-pressed={on}
      aria-label={'Играть: ' + an.fullName}
      style={{ '--px-img': 'url("' + OBSIDIAN_TILE + '")' } as CSSProperties}
      onClick={onClick}
    >
      <img className="an-hero" src={ANARCHY_HERO} alt="" draggable={false} />
      <span className="an-lava" aria-hidden="true" style={{ '--lava': 'url("' + LAVA_STRIP + '")' } as CSSProperties}>
        <i />
      </span>
      <span className="an-head">
        <span className="an-co">MCRU.ME × Millida</span>
        <b className="an-title">
          Полная
          <br />
          <em>анархия</em>
        </b>
      </span>
      <span className="an-foot">
        <span className="an-play" aria-hidden="true">
          <Icon id="i-play" /> Играть
        </span>
        {anarchyOnlineShown(online) ? (
          <span className="an-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {fmtN(online)} играют
          </span>
        ) : null}
      </span>
      {on ? (
        <span className="ph-card-on" aria-hidden="true">
          <Icon id="i-check" />
        </span>
      ) : null}
    </button>
  )
}
