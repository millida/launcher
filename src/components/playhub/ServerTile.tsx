import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { blockArt } from './data'
import { blockFor } from '../catalog/itemView'
import { fmtN } from '../../lib/format'
import { useT } from '../../i18n'
import { openServerDetail } from '../../state/serverDetail'
import type { SnapshotServer } from '../../lib/snapshot'
import { joinAddr } from '../../lib/ownServer'
import { useWakeOnJoin } from '../../lib/wakeInfo'

const verKey = (v: string) => v.split('.').map((x) => Number(x) || 0).reduce((acc, n) => acc * 1000 + n, 0)

/** «1.8–1.21»: from the oldest to the newest, whatever order the rating sent. */
export function versionSpan(list: string[]): string {
  if (!list.length) return ''
  const sorted = [...list].sort((a, b) => verKey(a) - verKey(b))
  const lo = sorted[0]!
  const hi = sorted[sorted.length - 1]!
  return lo === hi ? lo : lo + '–' + hi
}

function useLoaded(src?: string | null): [boolean, () => void] {
  const [bad, setBad] = useState(false)
  useEffect(() => setBad(false), [src])
  return [!!src && !bad, () => setBad(true)]
}

function Media({ s }: { s: SnapshotServer }) {
  const [banner, bannerFailed] = useLoaded(s.banner)
  const [logo, logoFailed] = useLoaded(s.logo)
  if (banner)
    return <img className="ph-st-cover" src={s.banner} alt="" loading="lazy" draggable={false} onError={bannerFailed} />
  if (logo)
    return (
      <span className="ph-st-fb" aria-hidden="true">
        <img className="ph-st-fb-bg" src={s.logo} alt="" loading="lazy" draggable={false} onError={logoFailed} />
        <img className="ph-st-fb-logo" src={s.logo} alt="" loading="lazy" draggable={false} />
      </span>
    )
  return (
    <span className="ph-st-fb is-block" aria-hidden="true">
      <img className="ph-st-fb-block" src={blockArt(blockFor(s.slug || s.name || s.ip))} alt="" draggable={false} />
    </span>
  )
}

function Avatar({ s }: { s: SnapshotServer }) {
  const [logo, failed] = useLoaded(s.logo)
  return (
    <span className={'ph-st-ava' + (logo ? '' : ' is-block')} aria-hidden="true">
      {logo ? (
        <img src={s.logo} alt="" loading="lazy" draggable={false} onError={failed} />
      ) : (
        <img src={blockArt(blockFor(s.slug || s.name || s.ip))} alt="" draggable={false} />
      )}
    </span>
  )
}

/**
 * Server card in the catalog, laid out like a stream in the Twitch directory: a 16:9 picture with the live
 * online count on it, the server avatar and name below. A click opens the server card, «Играть» joins at once.
 */
export function ServerTile({
  s,
  pos,
  on,
  src,
  onPlay,
}: {
  s: SnapshotServer
  pos?: number
  on: boolean
  src: string
  onPlay: (s: SnapshotServer) => void
}) {
  const t = useT()
  const span = versionSpan(s.versions)
  const lic = s.lic === 'CRACKED' ? t('Вход по нику') : s.lic === 'LICENSE' ? t('Лицензия') : ''
  const line = [s.cat, lic, s.desc || s.motd].filter(Boolean).join(' · ')
  const wakes = useWakeOnJoin(s.ip ? joinAddr(s) : null, !s.isOnline)
  return (
    <article
      className={'ph-card ph-st' + (on ? ' on' : '') + (s.isOnline ? '' : ' off')}
      role="button"
      tabIndex={0}
      data-sound="open"
      data-track="server_open"
      data-kind="server"
      data-id={s.slug || s.ip}
      data-pos={pos}
      data-src={src}
      onClick={() => openServerDetail(s)}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && openServerDetail(s)}
    >
      <span className="ph-card-art ph-st-media">
        <Media s={s} />
        <span className={'ph-st-chip ph-st-live' + (s.isOnline ? '' : ' is-off')}>
          {s.isOnline ? (
            <>
              <span className="ph-dot" aria-hidden="true"></span>
              {(s.onlineApprox ? '~' : '') + fmtN(s.online)}
            </>
          ) : (
            t('офлайн')
          )}
        </span>
        {span ? <span className="ph-st-chip ph-st-ver">{span}</span> : null}
        <span className="ph-st-acts">
          <button
            type="button"
            className="btn sm primary"
            data-track={wakes ? 'play_wake' : 'play'}
            onClick={(e) => {
              e.stopPropagation()
              onPlay(s)
            }}
          >
            <Icon id="i-play" /> {wakes ? t('Включить и зайти') : t('Играть')}
          </button>
        </span>
      </span>
      <span className="ph-st-body">
        <Avatar s={s} />
        <span className="ph-st-text">
          <b>{s.name}</b>
          {line ? <span className="ph-st-line">{line}</span> : null}
        </span>
      </span>
    </article>
  )
}

export function ServerTileSkel() {
  return (
    <span className="ph-card ph-st skel-card" aria-hidden="true">
      <span className="ph-card-art skel"></span>
      <span className="ph-st-body">
        <span className="ph-st-ava skel"></span>
        <span className="ph-st-text">
          <span className="skel skel-line" style={{ width: '60%' }}></span>
          <span className="skel skel-line" style={{ width: '40%', height: 9 }}></span>
        </span>
      </span>
    </span>
  )
}
