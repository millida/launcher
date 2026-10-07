import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react'
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
import { setScreen } from '../../state/ui'
import { loadCatalogPacks } from '../playhub/data'
import { LOBBY_ROTATE_MS, PRISON_SLUG, featuredNow, featuredSpot, rotatedTurn } from '../playhub/featured'
import { PRISON_BANNER, PRISON_CO, type PrisonFace } from '../playhub/PrisonTile'
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
  const [prison, setPrison] = useState<PrisonFace | null | undefined>(undefined)
  const [step, setStep] = useState(0)
  const hovered = useRef(false)
  const spot = featuredSpot(prison, (ready) => rotatedTurn(featuredNow(ready), step, ready))
  const rotates = on && shown && !!prison

  useEffect(() => {
    if (!rotates) return
    const id = window.setInterval(() => {
      if (!hovered.current) setStep((s) => s + 1)
    }, LOBBY_ROTATE_MS)
    return () => window.clearInterval(id)
  }, [rotates])

  const hover = {
    onPointerEnter: () => {
      hovered.current = true
    },
    onPointerLeave: () => {
      hovered.current = false
    },
  }

  useEffect(() => {
    if (!shown) return
    let alive = true
    void loadCatalogPacks().then((list) => {
      const p = list.find((x) => x.slug === PRISON_SLUG)
      if (alive) setPrison(p ? { title: p.title, coverUrl: p.cover, online: typeof p.online === 'number' ? p.online : null } : null)
    })
    return () => {
      alive = false
    }
  }, [shown])

  useEffect(() => {
    if (!on || !shown || spot.kind !== 'prisonrpg') return
    trackImpression('recommend', ['pack:' + PRISON_SLUG], 'play')
  }, [on, shown, spot.kind])

  useEffect(() => {
    if (!on || !shown || spot.kind !== 'anarchy') return
    let alive = true
    void loadAnarchyOnline().then((n) => alive && setOnline(n))
    trackImpression('recommend', ['own_server:' + ANARCHY.mode], 'play')
    return () => {
      alive = false
    }
  }, [on, shown, an.addr, spot.kind])

  if (!shown || spot.kind === 'wait') return null
  if (spot.kind === 'prisonrpg') return <PrisonRecommend pack={spot.pack} hover={hover} />

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
      {...hover}
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

/**
 * PrisonRPG in the anarchy's lobby spot on its turn: the same CTA over the
 * partner's full banner. It is a native game, so pressing it opens its
 * pack page in «Во что играем» instead of joining a server.
 */
function PrisonRecommend({ pack, hover }: { pack: PrisonFace; hover: Pick<ComponentProps<'button'>, 'onPointerEnter' | 'onPointerLeave'> }) {
  const open = () => {
    useLobby.setState({ hubTarget: { pack: PRISON_SLUG } })
    setScreen('playhub')
  }
  return (
    <button
      className="lobby-rec lobby-an lobby-pr"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="pack"
      data-id={PRISON_SLUG}
      data-pos={0}
      aria-label={'Открыть: ' + pack.title}
      onClick={open}
      {...hover}
    >
      <img className="lpr-art" src={pack.coverUrl || PRISON_BANNER} alt="" draggable={false} />
      <span className="pr-co">{PRISON_CO}</span>
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id="i-play" /> Играть
        </span>
        {anarchyOnlineShown(pack.online) ? (
          <span className="lan-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {fmtN(pack.online)} играют
          </span>
        ) : null}
      </span>
    </button>
  )
}
