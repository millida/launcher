import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { api, hasMillidaAccount } from '../../lib/api'
import { usePolling } from '../../lib/usePolling'
import { setScreen, showToast } from '../../state/ui'
import { noteMyServers } from '../../state/playInvite'
import { HostPlanPicker } from '../HostPlanPicker'
import type { HostServer } from '../../screens/Hosting'
import type { LobbyMode } from '../../state/lobbyMode'
import { HubSearch, MyServers } from './HubSearch'
import { blockArt } from './data'
import { trackFailure } from '../../lib/telemetry'

/**
 * Вкладка «Мои серверы» хаба: свои серверы хостинга Millida (статус, «Зайти»,
 * «Позвать друзей», «Управлять»), под ними — поиск сервера по имени или адресу
 * и недавние серверы из статистики. Своего сервера нет — одна крупная
 * карточка «Свой сервер для друзей» с бесплатным созданием.
 */

type Load = HostServer[] | 'none' | 'error' | null

const ownMode = (s: HostServer): LobbyMode => ({
  kind: 'server',
  slug: s.address || s.id,
  name: s.name || 'Мой сервер',
  ip: s.address || '',
  logo: s.icon || null,
  banner: null,
  versions: s.version ? [s.version] : [],
  licensed: false,
})

const STATUS: Record<string, [string, string]> = {
  RUNNING: ['Работает', 'on'],
  STARTING: ['Запускается', 'wait'],
  INSTALLING: ['Запускается', 'wait'],
  STOPPING: ['Выключается', 'wait'],
}

function OwnCard({ s, onJoin, onStart }: { s: HostServer; onJoin: () => void; onStart: () => void }) {
  const [label, tone] = STATUS[s.status || ''] || ['Выключен', 'off']
  const running = s.status === 'RUNNING'
  const busy = s.status === 'STARTING' || s.status === 'INSTALLING' || s.status === 'STOPPING'
  const max = s.maxPlayers || s.planMaxPlayers || 0
  return (
    <div className="ph-card hsv" data-kind="own_server" data-id={s.id} data-section="own_servers" data-src="my_servers">
      <span className="hsv-ic">
        {s.icon ? <img src={s.icon} alt="" draggable={false} /> : <img className="hsv-block" src={blockArt(10)} alt="" draggable={false} />}
      </span>
      <span className="hsv-body">
        <b>{s.name || 'Мой сервер'}</b>
        <span className="hsv-meta">
          <span className={'hsv-st ' + tone}>
            <span className="hsv-dot" aria-hidden="true"></span>
            {label}
          </span>
          {running ? (
            <span>
              {(s.playersOnline || 0) + (max ? ' / ' + max : '')} в игре
            </span>
          ) : null}
          {s.address ? <span className="hsv-addr">{s.address}</span> : null}
        </span>
      </span>
      <span className="hsv-acts">
        {running ? (
          <button className="btn md primary" data-sound="open" data-track="join" onClick={onJoin}>
            <Icon id="i-play" /> Зайти
          </button>
        ) : (
          <button className="btn md primary" disabled={busy} data-track="server_start" onClick={onStart}>
            <Icon id="i-play" /> Запустить
          </button>
        )}
        <button className="btn md secondary" data-sound="open" data-track="invite_friends" onClick={() => setScreen('friends')}>
          <Icon id="i-users" /> Позвать друзей
        </button>
        <button className="btn md secondary" data-sound="open" data-track="server_manage" onClick={() => setScreen('hosting')}>
          <Icon id="i-server-cog" /> Управлять
        </button>
      </span>
    </div>
  )
}

/**
 * `part`: «own» — только «Мой сервер» (первый блок «Каталога», как Realms в
 * Minecraft: свои серверы или «Создать»); «find» — поиск сервера и недавние
 * (под «Режимами»). Без `part` — всё подряд, как было.
 */
export function ServersPane({ on, onPlay, part }: { on: boolean; onPlay: (m: LobbyMode) => void; part?: 'own' | 'find' }) {
  const [list, setList] = useState<Load>(null)
  const [picker, setPicker] = useState(false)

  const load = async () => {
    if (!hasMillidaAccount()) {
      setList('none')
      return
    }
    try {
      const r = await api<HostServer[]>('/hosting/servers/me')
      const arr = Array.isArray(r) ? r : []
      noteMyServers(arr)
      setList(arr.length ? arr : 'none')
    } catch (e) {
      console.warn('[hub] servers/me', e)
      trackFailure('servers', e, { step: 'my_servers' })
      setList((l) => (Array.isArray(l) ? l : 'error'))
    }
  }

  const own = part !== 'find'
  useEffect(() => {
    if (on && own) void load()
  }, [on, own])
  usePolling(() => void load(), 20000, { enabled: own && on && Array.isArray(list), hiddenMs: 0, immediate: false })

  const start = async (s: HostServer) => {
    showToast('Запускаем сервер…')
    try {
      await api('/hosting/servers/' + encodeURIComponent(s.id) + '/start', { method: 'POST' })
      setTimeout(() => void load(), 1200)
    } catch (e) {
      console.warn('[hub] start', e)
      showToast('Не получилось — попробуй ещё раз', 'error')
    }
  }

  // Создание: без аккаунта Millida — в «Хостинг», там вход; с аккаунтом —
  // сразу выбор тарифа на бесплатном.
  const create = () => (hasMillidaAccount() ? setPicker(true) : setScreen('hosting'))

  const ownPart = !own ? null : (
    <>
      {part === 'own' && !Array.isArray(list) ? (
        <div className="ph-shelf-head">
          <h2>Мой сервер</h2>
        </div>
      ) : null}
      {list === null ? (
        <span className="ph-card hsv skel" aria-hidden="true"></span>
      ) : list === 'error' ? (
        <div className="ph-noans">
          <Icon id="i-alert" />
          <b>Не загрузилось</b>
          <button className="btn sm secondary" data-track="retry" onClick={() => void load()}>
            <Icon id="i-restart" /> Повторить
          </button>
        </div>
      ) : list === 'none' ? (
        <div className="ph-card hsv-new">
          <img className="hsv-new-art" src="/lobby/duo@2x.webp" alt="" draggable={false} />
          <span className="hsv-new-body">
            <b>Свой сервер для друзей</b>
            <button className="btn lg primary" data-sound="open" data-track="server_create" onClick={create}>
              <Icon id="i-plus" /> Создать · бесплатно
            </button>
          </span>
        </div>
      ) : (
        <section className="ph-shelf">
          <div className="ph-shelf-head">
            <h2>{part === 'own' ? 'Мой сервер' : 'Хостинг Millida'}</h2>
            <button className="btn sm secondary" data-track="server_create" onClick={create}>
              <Icon id="i-plus" /> Новый сервер
            </button>
          </div>
          <div className="hsv-list">
            {list.map((s) => (
              <OwnCard key={s.id} s={s} onJoin={() => onPlay(ownMode(s))} onStart={() => void start(s)} />
            ))}
          </div>
        </section>
      )}
      {picker ? (
        <HostPlanPicker
          mode="create"
          focus="free"
          freeServer={null}
          onOpenServer={() => setScreen('hosting')}
          onClose={() => setPicker(false)}
          onDone={() => setTimeout(() => void load(), 1500)}
        />
      ) : null}
    </>
  )

  const findPart =
    part === 'own' ? null : (
    <>
      <section className="ph-shelf">
        <div className="ph-shelf-head">
          <h2>Зайти на сервер</h2>
        </div>
        <HubSearch placeholder="Имя или адрес сервера" onServer={onPlay} />
      </section>

      <MyServers title="Недавние" limit={12} onPlay={onPlay} />
    </>
  )

  return (
    <>
      {ownPart}
      {findPart}
    </>
  )
}
