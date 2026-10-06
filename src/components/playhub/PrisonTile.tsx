import { Icon } from '../Icon'
import { fmtN } from '../../lib/format'
import { anarchyOnlineShown } from './AnarchyTile'
import { PRISON_SLUG } from './featured'

export const PRISON_BANNER = 'https://cdn.millida.trade/catalog/launcher-packs/prisonrpg/2026-10-05/prisonrpg-banner.webp'
export const PRISON_CO = 'MetaLabs × Millida'

export interface PrisonFace {
  title: string
  coverUrl?: string | null
  online?: number | null
}

const cover = (p: PrisonFace) => p.coverUrl || PRISON_BANNER

/**
 * PrisonRPG on «Режимы»: the anarchy's CTA over the partner's full banner,
 * whose logo already is the title, so a second drawn title would only repeat
 * it. In one cell the banner keeps its width above the CTA instead of losing
 * the logo to a crop. Pressing it opens the pack page, never a Minecraft join.
 */
export function PrisonTile({ pack, index, cell, onClick }: { pack: PrisonFace; index: number; cell?: boolean; onClick: () => void }) {
  return (
    <button
      className={'ph-card ph-mt ph-mt-pr' + (cell ? ' is-cell' : '')}
      data-sound="open"
      data-kind="pack"
      data-id={PRISON_SLUG}
      data-pos={index}
      data-src="mode"
      aria-label={'Открыть: ' + pack.title}
      onClick={onClick}
    >
      <img className="pr-art" src={cover(pack)} alt="" draggable={false} />
      <span className="pr-co">{PRISON_CO}</span>
      <span className="an-foot">
        <span className="an-play" aria-hidden="true">
          <Icon id="i-play" /> Играть
        </span>
        {anarchyOnlineShown(pack.online) ? (
          <span className="an-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {fmtN(pack.online)} играют
          </span>
        ) : null}
      </span>
    </button>
  )
}
