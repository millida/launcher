import { useEffect, useState, type CSSProperties } from 'react'
import { Icon } from '../Icon'
import { anarchyOnlineShown } from '../playhub/AnarchyTile'
import { ANARCHY_HERO, LAVA_STRIP, OBSIDIAN_TILE } from '../playhub/anarchyArt'
import { ANARCHY, anarchyMode } from '../../lib/ownServer'
import { loadAnarchyOnline, useAnarchy } from '../../lib/anarchy'
import { usePromo } from '../../state/promo'
import { playMode } from '../../lib/lobbyPlay'
import { useLobby } from '../../state/lobbyMode'
import { useProfiles } from '../../state/profiles'
import { fmtN } from '../../lib/format'
import { trackImpression } from '../../lib/uiTrack'
import '../../styles/pixel/playhub.css'

/**
 * The lobby banner of our anarchy in one palette: obsidian, lava and white.
 * Pressing it starts the game right away; the API can take it off the lobby
 * without a release.
 */
export function Recommend({ on }: { on: boolean }) {
  const [online, setOnline] = useState<number | null>(null)
  const shown = usePromo((s) => s.promo.lobby === ANARCHY.mode)
  const an = useAnarchy()

  useEffect(() => {
    if (!on || !shown) return
    let alive = true
    void loadAnarchyOnline().then((n) => alive && setOnline(n))
    trackImpression('recommend', ['own_server:' + ANARCHY.mode], 'play')
    return () => {
      alive = false
    }
  }, [on, shown, an.addr])

  if (!shown) return null

  const play = () => {
    const m = anarchyMode()
    useLobby.getState().pick(m)
    void playMode(m, useProfiles.getState().profiles)
  }

  return (
    <button
      className="lobby-rec lobby-an"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="own_server"
      data-id={ANARCHY.mode}
      data-pos={0}
      aria-label={'Играть: ' + an.fullName}
      style={{ '--px-img': 'url("' + OBSIDIAN_TILE + '")' } as CSSProperties}
      onClick={play}
    >
      <img className="lan-hero" src={ANARCHY_HERO} alt="" draggable={false} />
      <span className="an-lava" aria-hidden="true" style={{ '--lava': 'url("' + LAVA_STRIP + '")' } as CSSProperties}>
        <i />
      </span>
      <span className="lan-co">MCRU.ME × Millida</span>
      <span className="lan-title">
        Полная
        <br />
        <em>анархия</em>
      </span>
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id="i-play" /> Играть
        </span>
        {anarchyOnlineShown(online) ? (
          <span className="lan-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {fmtN(online)} играют
          </span>
        ) : null}
      </span>
    </button>
  )
}
