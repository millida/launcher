import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { AnarchyArt, anarchyOnlineShown } from '../playhub/AnarchyTile'
import { ANARCHY, anarchyMode } from '../../lib/ownServer'
import { loadAnarchyOnline } from '../../lib/anarchy'
import { playMode } from '../../lib/lobbyPlay'
import { useLobby } from '../../state/lobbyMode'
import { useProfiles } from '../../state/profiles'
import { fmtN } from '../../lib/format'
import { trackImpression } from '../../lib/uiTrack'

/**
 * The lobby card on the right shows only our anarchy, and pressing it starts
 * the game right away.
 */
export function Recommend({ on }: { on: boolean }) {
  const [online, setOnline] = useState<number | null>(null)

  useEffect(() => {
    if (!on) return
    let alive = true
    void loadAnarchyOnline().then((n) => alive && setOnline(n))
    trackImpression('recommend', ['own_server:' + ANARCHY.mode], 'play')
    return () => {
      alive = false
    }
  }, [on])

  const play = () => {
    const m = anarchyMode()
    useLobby.getState().pick(m)
    void playMode(m, useProfiles.getState().profiles)
  }

  return (
    <button
      className="lobby-rec lobby-rec-an"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="own_server"
      data-id={ANARCHY.mode}
      data-pos={0}
      onClick={play}
    >
      <span className="lrec-art">
        <AnarchyArt />
        <span className="ph-card-tag excl">Эксклюзив</span>
      </span>
      <span className="lrec-body">
        <span className="lrec-lab">Наш сервер</span>
        <b>{ANARCHY.name}</b>
        <i>
          {anarchyOnlineShown(online) ? (
            <>
              <span className="ph-dot" aria-hidden="true"></span>
              {fmtN(online)} играют
            </>
          ) : (
            ANARCHY.tagline + ' · ' + ANARCHY.version
          )}
        </i>
      </span>
      <span className="lrec-go">
        <Icon id="i-play" /> Играть
      </span>
    </button>
  )
}
