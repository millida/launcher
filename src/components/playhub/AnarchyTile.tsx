import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { fmtN } from '../../lib/format'
import { ANARCHY } from '../../lib/ownServer'
import { useAnarchy } from '../../lib/anarchy'
import { ANARCHY_BANNER, ANARCHY_SPRITES, LAVA_STRIP, OBSIDIAN_TILE } from './anarchyArt'
import type { AnarchySprite } from './anarchyArt'

const FLOAT: Array<{ id: AnarchySprite; cls: string }> = [
  { id: 'plateEpic', cls: 'a1' },
  { id: 'chest', cls: 'a2' },
  { id: 'drop', cls: 'a3' },
  { id: 'key', cls: 'a4' },
  { id: 'shard', cls: 'a5' },
  { id: 'plateRed', cls: 'a6' },
]

const EMBERS = 12

/** The players line follows the shelf rule: a number only when it is live and at least 20. */
export const anarchyOnlineShown = (online: number | null | undefined): online is number => typeof online === 'number' && online >= 20

/** Still art for cards: obsidian, lava edge, loot. */
export function AnarchyArt({ className }: { className?: string }) {
  return (
    <span className={'an-art' + (className ? ' ' + className : '')}>
      <img src={ANARCHY_BANNER} alt="" draggable={false} />
    </span>
  )
}

/**
 * The exclusive tile of "Режимы", two cells wide: obsidian wall, a lava edge
 * that flows and glows in steps, embers rising from it and the server's loot
 * floating over the wall. Pressing it starts the game.
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
      aria-label={'Играть в ' + an.name}
      style={{ '--px-img': 'url("' + OBSIDIAN_TILE + '")' } as CSSProperties}
      onClick={onClick}
    >
      <span className="an-glow" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="an-loot" aria-hidden="true">
        {FLOAT.map((f) => (
          <img key={f.id} className={f.cls} src={ANARCHY_SPRITES[f.id].url} alt="" draggable={false} />
        ))}
      </span>
      <span className="an-embers" aria-hidden="true">
        {Array.from({ length: EMBERS }, (_, i) => (
          <i key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </span>
      <span className="an-lava" aria-hidden="true" style={{ '--lava': 'url("' + LAVA_STRIP + '")' } as CSSProperties}>
        <i />
      </span>
      <span className="ph-card-tag excl">Эксклюзив</span>
      <span className="an-head">
        <b className="an-title">{an.name}</b>
        <span className="an-sub">{an.tagline + ' · ' + an.version}</span>
      </span>
      <span className="an-foot">
        <span className="btn lg primary ph-mt-play" aria-hidden="true">
          <Icon id="i-play" /> Играть
        </span>
        {anarchyOnlineShown(online) ? (
          <span className="ph-mt-on">
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
