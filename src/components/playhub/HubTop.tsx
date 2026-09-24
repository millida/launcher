import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../Icon'
import { LOADER_NAME } from '../../lib/format'
import { priceLabel } from '../../lib/premium'
import { parseIcon } from '../../lib/buildIcon'
import { usePlayStats } from '../../state/playStats'
import type { LobbyMode } from '../../state/lobbyMode'
import type { Profile } from '../../ipc/commands'
import { BuildIcon } from './BuildIcon'
import { hoursText } from './Hours'
import { OneBlockBanner } from './OneBlockBanner'
import { versionCover } from './data'
import type { HubPack } from './data'

/**
 * Первый экран хаба: слева «Продолжить» — то, во что человек играл или что
 * выбрал последним, справа один hero-слот. Так устроены главные Roblox,
 * Fortnite и Modrinth App (ресёрч 2026-09-24, §1): возврат в свою игру —
 * самое дешёвое удержание, рекламу своего видно без прокрутки.
 */

const pic = (src: string | null | undefined, cls?: string) =>
  src ? (
    <img
      className={cls}
      src={src}
      alt=""
      draggable={false}
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  ) : null

const verSpan = (v: string[]) => (v.length ? (v.length > 1 ? v[0] + '–' + v[v.length - 1] : v[0]!) : '')

export function ContinueCard({
  mode,
  profile,
  onPlay,
}: {
  mode: LobbyMode
  /** Своя сборка из списка — для иконки, загрузчика и часов. */
  profile: Profile | null
  onPlay: () => void
}) {
  const buildName = mode.kind === 'build' ? mode.name : null
  const seconds = usePlayStats((s) => (buildName ? s.stats.builds.find((b) => b.key === buildName)?.seconds || 0 : 0))

  let art: ReactNode = null
  let artStyle: CSSProperties | undefined
  let title = ''
  let meta = ''
  if (mode.kind === 'build') {
    title = mode.name
    meta = profile ? LOADER_NAME(profile) + ' · ' + profile.version : ''
    artStyle = { '--mine-bg': parseIcon(profile?.icon).bg } as CSSProperties
    art = <BuildIcon icon={profile?.icon} size={132} />
  } else if (mode.kind === 'premium') {
    title = mode.title
    meta = mode.meta
    art = pic(mode.cover, 'ph-cont-cover')
  } else if (mode.kind === 'server') {
    title = mode.name
    meta = verSpan(mode.versions)
    art = pic(mode.banner || mode.logo, 'ph-cont-cover')
  } else {
    title = 'Minecraft ' + mode.version
    meta = 'Fabric + Boost FPS'
    art = pic(versionCover(mode.version, 0, true), 'ph-cont-cover')
  }

  return (
    <div className={'ph-card ph-cont' + (mode.kind === 'build' ? ' build' : '')}>
      <span className="ph-cont-art" style={artStyle}>
        {art}
        <span className="ph-card-tag">Продолжить</span>
      </span>
      <span className="ph-cont-body">
        <span className="ph-cont-text">
          <b>{title}</b>
          <span className="ph-card-meta">
            {meta}
            {seconds >= 60 ? (
              <span className="ph-mine-h">
                <Icon id="i-clock" />
                {hoursText(seconds)}
              </span>
            ) : null}
          </span>
        </span>
        <button className="btn lg primary ph-cont-play" data-sound="open" onClick={onPlay}>
          <Icon id="i-play" /> Играть
        </button>
      </span>
    </div>
  )
}

export const ContinueSkel = () => <span className="ph-card ph-cont skel" aria-hidden="true"></span>

/** Arcania — премиум: обложка во весь слот, золотая кайма, цена, «Открыть». */
export function HeroArcania({ pack, onOpen }: { pack: HubPack; onOpen: () => void }) {
  const price = priceLabel(pack)
  return (
    <button className="ph-card ph-hs gold" data-sound="open" onClick={onOpen}>
      {pic(pack.coverUrl, 'ph-hs-img')}
      <span className="ph-hs-body">
        <span className="ph-card-tag gold">
          <Icon id="i-crown" /> Премиум
        </span>
        <b>{pack.title}</b>
        <span className="ph-hs-row">
          {price ? <span className="ph-hs-price">{price}</span> : null}
          <span className="btn md primary ph-hs-cta">
            Открыть <Icon id="i-chev-r" />
          </span>
        </span>
      </span>
    </button>
  )
}

export function HeroOneBlock({ online, onPlay }: { online: number | null; onPlay: () => void }) {
  return (
    <div className="ph-hs ob">
      <OneBlockBanner online={online} onPlay={onPlay} />
    </div>
  )
}

/** Подборка недели: три обложки рядом, каждая открывает свою сборку. */
export function HeroWeek({ packs, onOpen }: { packs: HubPack[]; onOpen: (p: HubPack) => void }) {
  return (
    <div className="ph-card ph-hs week" role="group" aria-label="Подборка недели">
      <span className="ph-hs-week">
        {packs.map((p) => (
          <button key={p.id} className="ph-hs-pick" data-sound="nav" onClick={() => onOpen(p)}>
            {pic(p.coverUrl, 'ph-hs-img')}
            <span className="ph-hs-pick-name">{p.title}</span>
          </button>
        ))}
      </span>
      <span className="ph-card-tag ph-hs-week-tag">Подборка недели</span>
    </div>
  )
}

export const HeroSkel = () => <span className="ph-card ph-hs skel" aria-hidden="true"></span>
