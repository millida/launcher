import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { api, hasMillidaAccount } from '../../lib/api'
import { usePolling } from '../../lib/usePolling'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import type { LobbyMode } from '../../state/lobbyMode'
import { blockArt } from './data'
import { trackFailure } from '../../lib/telemetry'
import { useT } from '../../i18n'

/** One server the player was invited to by Millida nickname (GET /hosting/played-servers). */
export interface PlayedServer {
  id: string
  name: string
  address: string
  core: string
  version: string
  status: string
  playersOnline: number
  maxPlayers: number | null
  icon: string | null
  owner: string | null
  paidByOwner: boolean
  role: string
}

const friendMode = (s: PlayedServer): LobbyMode => ({
  kind: 'server',
  slug: s.address || s.id,
  name: s.name,
  ip: s.address,
  logo: s.icon || null,
  banner: null,
  versions: s.version ? [s.version] : [],
  licensed: false,
})

function FriendCard({ s, onJoin, onLeave }: { s: PlayedServer; onJoin: () => void; onLeave: () => void }) {
  const t = useT()
  const running = s.status === 'RUNNING'
  return (
    <div className="ph-card hsv" data-kind="friend_server" data-id={s.id} data-section="friend_servers" data-src="my_servers">
      <span className="hsv-ic">
        {s.icon ? <img src={s.icon} alt="" draggable={false} /> : <img className="hsv-block" src={blockArt(7)} alt="" draggable={false} />}
      </span>
      <span className="hsv-body">
        <b>{s.name}</b>
        <span className="hsv-meta">
          <span className={'hsv-st ' + (running ? 'on' : 'off')}>
            <span className="hsv-dot" aria-hidden="true"></span>
            {running ? t('Работает') : t('Выключен')}
          </span>
          {running ? <span>{t('{n} в игре', { n: s.playersOnline + (s.maxPlayers ? ' / ' + s.maxPlayers : '') })}</span> : null}
          {s.owner ? <span>{t('Сервер {nick}', { nick: s.owner })}</span> : null}
        </span>
        {s.paidByOwner ? <span className="hsv-paid">{t('Играешь бесплатно — платит владелец')}</span> : null}
      </span>
      <span className="hsv-acts">
        <button className="btn md primary" disabled={!running} data-sound="open" data-track="friend_join" onClick={onJoin}>
          <Icon id="i-play" /> {running ? t('Зайти') : t('Выключен')}
        </button>
        <button className="btn md secondary" data-track="friend_leave" onClick={onLeave}>
          <Icon id="i-logout" /> {t('Выйти')}
        </button>
      </span>
    </div>
  )
}

/**
 * Servers a friend invited the player to by Millida nickname. The shelf hides
 * itself while empty: an invite is the friend's move, not something to ask for.
 */
export function FriendServers({ on, onPlay }: { on: boolean; onPlay: (m: LobbyMode) => void }) {
  const t = useT()
  const [list, setList] = useState<PlayedServer[] | null>(null)
  const seq = useRef(0)

  const load = async () => {
    if (!hasMillidaAccount()) {
      setList([])
      return
    }
    const mine = ++seq.current
    try {
      const r = await api<PlayedServer[]>('/hosting/played-servers')
      if (mine === seq.current) setList(Array.isArray(r) ? r : [])
    } catch (e) {
      console.warn('[hub] played-servers', e)
      trackFailure('servers', e, { step: 'friend_servers' })
    }
  }

  useEffect(() => {
    if (on) void load()
  }, [on])
  usePolling(() => void load(), 30000, { enabled: on && Array.isArray(list) && list.length > 0, hiddenMs: 0, immediate: false, realtime: 'hosting' })

  const leave = async (s: PlayedServer) => {
    const ok = await uiConfirm(t('Выйти из команды сервера «{name}»? Он пропадёт из лаунчера, вернуть может только владелец.', { name: s.name }), {
      confirmLabel: t('Выйти'),
    })
    if (!ok) return
    try {
      await api('/hosting/played-servers/' + encodeURIComponent(s.id), { method: 'DELETE' })
      setList((l) => (l ? l.filter((x) => x.id !== s.id) : l))
      showToast(t('Вы вышли из команды сервера'))
    } catch (e) {
      console.warn('[hub] leave', e)
      showToast(t('Не получилось — попробуй ещё раз'), 'error')
    }
  }

  if (!list || list.length === 0) return null
  return (
    <section className="ph-shelf">
      <div className="ph-shelf-head">
        <h2>{t('Серверы друзей')}</h2>
      </div>
      <div className="hsv-list">
        {list.map((s) => (
          <FriendCard key={s.id} s={s} onJoin={() => onPlay(friendMode(s))} onLeave={() => void leave(s)} />
        ))}
      </div>
    </section>
  )
}

