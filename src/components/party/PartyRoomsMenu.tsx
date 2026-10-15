import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { api } from '../../lib/api'
import { hostingSendBuild } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import type { PartyRoom, PartyTargetKind } from '../../lib/party'
import { planServer, targetForMode } from '../../lib/partyPlay'
import { loadMyServers, serverTitle, type MyServer } from '../../state/playInvite'
import { setScreen } from '../../state/ui'
import { useLobby, type LobbyMode } from '../../state/lobbyMode'
import { useProfiles } from '../../state/profiles'
import { anarchyMode } from '../../lib/ownServer'
import { TIER_SERVER } from '../../state/tiers'
import { BuildIcon } from '../playhub/BuildIcon'
import { fmtN } from '../../lib/format'
import { joinRoom, loadRooms, openRoom, usePartyStore } from '../../state/party'
import { PartyInviteList } from './PartyInviteMenu'
import { AgeGate } from './LfgModal'
import { showToast } from '../../state/ui'
import '../../styles/pixel/party-invite.css'

const KIND: Record<PartyTargetKind, { label: string; icon: string; tint: string }> = {
  server: { label: 'Сервер', icon: 'i-server', tint: '#2b63c4' },
  build: { label: 'Сборка', icon: 'i-blocks', tint: '#7a4a2a' },
  premium: { label: 'Сборка', icon: 'i-crown', tint: '#b8862b' },
  version: { label: 'Minecraft', icon: 'i-play', tint: '#3a7a4b' },
}

function RoomRow({ r, busy, onJoin }: { r: PartyRoom; busy: boolean; onJoin: () => void }) {
  const k = KIND[r.target.kind] || KIND.server
  return (
    <div className="prm-row">
      <span className="prm-art" style={{ backgroundColor: k.tint }}>
        <Icon id={k.icon} />
      </span>
      <span className="prm-what">
        <b>{r.target.title}</b>
        <span>
          {k.label} · {r.host.nickname || 'Игрок'}
        </span>
      </span>
      <span className="prm-heads" aria-label={'В комнате ' + r.size + ' из ' + r.capacity}>
        {r.members.slice(0, 4).map((m) => (
          <Head key={m.userId} nick={m.nickname || 'MHF_Steve'} src={m.avatarUrl} size={24} />
        ))}
        <i>
          {r.size}/{r.capacity}
        </i>
      </span>
      <button className="btn sm primary prm-join" data-track="party_room_join" data-kind={r.target.kind} disabled={busy} onClick={onJoin}>
        Войти
      </button>
    </div>
  )
}

/** Куда можно позвать комнату: плитка с картинкой, раздел и то, что уйдёт на сервер целью. */
interface Place {
  key: string
  cat: 'ours' | 'servers' | 'builds' | 'versions'
  title: string
  sub: string
  art: ReactNode
  mode: LobbyMode
}
const CATS: { id: Place['cat']; label: string; icon: string }[] = [
  { id: 'ours', label: 'Режимы Millida', icon: 'i-zap' },
  { id: 'servers', label: 'Серверы', icon: 'i-server' },
  { id: 'builds', label: 'Мои сборки', icon: 'i-blocks' },
  { id: 'versions', label: 'Minecraft', icon: 'i-play' },
]
const VERSIONS = ['26.3', '26.2', '1.21.11', '1.21.4', '1.21.1', '1.20.1', '1.19.2', '1.16.5', '1.12.2']
const img = (src: string) => <img src={src} alt="" draggable={false} loading="lazy" />

/** Всё, куда лаунчер умеет завести пати: наши режимы, серверы рейтинга, свои сборки, чистые версии. */
function usePlaces(): Place[] {
  const servers = useLobby((s) => s.servers)
  const profiles = useProfiles((s) => s.profiles)
  return useMemo(() => {
    const an = anarchyMode()
    const list: Place[] = [
      {
        key: 'pvp', cat: 'ours', title: 'PvP-дуэли', sub: 'Тиры · 14 китов', art: img('/mode-art/kit-rigs/sword.webp'),
        mode: { kind: 'server', slug: 'millida-pvp', name: 'PvP-дуэли', ip: TIER_SERVER.ip, logo: null, banner: null, versions: TIER_SERVER.versions, licensed: false },
      },
      { key: 'anarchy', cat: 'ours', title: 'Анархия', sub: 'Выживание без правил', art: img('/mode-art/ANARCHY.png'), mode: an },
    ]
    for (const s of servers.filter((x) => x.isOnline).slice(0, 40))
      list.push({
        key: 'srv:' + s.slug, cat: 'servers', title: s.name, sub: fmtN(s.online) + ' онлайн',
        art: s.logo || s.banner ? img((s.logo || s.banner) as string) : <Icon id="i-server" />,
        mode: { kind: 'server', slug: s.slug, name: s.name, ip: s.ip, logo: s.logo || null, banner: s.banner || null, versions: s.versions, licensed: s.lic === 'licensed' },
      })
    for (const p of profiles)
      list.push({ key: 'build:' + p.name, cat: 'builds', title: p.name, sub: p.version, art: <BuildIcon icon={p.icon} name={p.name} size={64} />, mode: { kind: 'build', name: p.name } })
    for (const v of VERSIONS)
      list.push({ key: 'ver:' + v, cat: 'versions', title: 'Minecraft ' + v, sub: 'Чистая игра', art: img('/versions/' + v + '.webp'), mode: { kind: 'version', version: v } })
    return list.filter((p) => p.mode.kind !== 'server' || !!p.mode.ip)
  }, [servers, profiles])
}

/**
 * «Найти пати» — полноценное окно комнат (владелец 12.10.2026: «как комнаты: видно, что
 * человек идёт делать, входишь одной кнопкой; открытая или закрытая»; «не вкладка-огрызок,
 * а нормальный попап, и режимов должно быть много, по разделам»).
 * Слева — войти в чужую или открыть свою. В своей: разделы (режимы Millida, серверы
 * рейтинга, мои сборки, версии) с поиском и плитками, внизу — кто может войти и «Открыть».
 */
export function PartyRoomsMenu({ start, close }: { start: 'join' | 'friends'; close: () => void }) {
  const mode = useLobby((s) => s.picked)
  const age = usePartyStore((s) => s.safety.ageBracket)
  const askAge = usePartyStore((s) => s.loaded && !s.safety.ageBracket)
  const [rooms, setRooms] = useState<PartyRoom[] | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<'join' | 'own' | 'friends'>(start)
  const [cat, setCat] = useState<Place['cat']>('ours')
  const [q, setQ] = useState('')
  // Сборке и чистой версии нужен сервер, иначе каждый окажется в своём мире.
  const [mine, setMine] = useState<MyServer[]>([])
  const [srv, setSrv] = useState('')
  const [addr, setAddr] = useState('')
  const places = usePlaces()
  // По умолчанию выбрано то, что стоит в «Сегодня играем».
  const preset = useMemo(() => {
    if (!mode) return ''
    const hit = places.find((p) =>
      mode.kind === 'build' ? p.mode.kind === 'build' && p.mode.name === mode.name
      : mode.kind === 'version' ? p.mode.kind === 'version' && p.mode.version === mode.version
      : mode.kind === 'server' ? p.mode.kind === 'server' && p.mode.ip === mode.ip
      : false)
    return hit ? hit.key : ''
  }, [mode, places])
  const [chosen, setChosen] = useState('')
  const pick = places.find((p) => p.key === (chosen || preset)) || null
  const alive = useRef(true)

  const load = () =>
    loadRooms()
      .then((l) => {
        if (!alive.current) return
        setRooms(l)
        setFailed('')
      })
      .catch((e) => alive.current && setFailed(apiErrorText(e, 'Комнаты не загрузились')))

  useEffect(() => {
    alive.current = true
    void load()
    void useLobby.getState().load()
    void loadMyServers(15_000).then((l) => {
      if (!alive.current) return
      const ok = l.filter((x) => x.address)
      setMine(ok)
      const run = ok.find((x) => x.status === 'RUNNING') || ok[0]
      if (run) setSrv(run.id)
    })
    const t = window.setInterval(() => void load(), 4000)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', esc)
    return () => {
      alive.current = false
      window.clearInterval(t)
      document.removeEventListener('keydown', esc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (age && failed) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [age])
  useEffect(() => {
    if (pick) setCat(pick.cat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const join = async (r: PartyRoom) => {
    if (busy) return
    setBusy(r.id)
    const party = await joinRoom(r.id)
    setBusy('')
    if (party) close()
    else void load()
  }
  const needServer = !!pick && (pick.cat === 'builds' || pick.cat === 'versions')
  const typed = addr.trim()
  const where = !needServer ? '' : srv === 'addr' ? typed : mine.find((x) => x.id === srv)?.address || ''
  const whereName = srv === 'addr' ? typed : (() => { const m = mine.find((x) => x.id === srv); return m ? serverTitle(m) : '' })()
  /**
   * Сервер под комнату одной кнопкой (владелец 12.10.2026: «всё в один клик»): бесплатный
   * сервер Millida нужной версии создаётся, запускается и сразу становится местом игры.
   * Возвращает его адрес или null.
   */
  const hostNow = async (version: string, name: string, build?: string): Promise<{ addr: string; name: string } | null> => {
    setBusy('host')
    try {
      const srv = await api<MyServer>('/hosting/servers', { method: 'POST', body: JSON.stringify({ playKind: 'vanilla', name: name.slice(0, 32) }) })
      if (!srv?.id) throw new Error('сервер не создался')
      const base = '/hosting/servers/' + encodeURIComponent(srv.id)
      await api(base + '/settings', { method: 'PATCH', body: JSON.stringify({ onlineMode: false }) }).catch(() => {})
      if (build) {
        // Своя сборка: ядро собирает из неё .mrpack и заливает на сервер, сервер проверяет и ставит.
        setBusy('send')
        const file = await hostingSendBuild(build, srv.id)
        await api(base + '/installs/upload', { method: 'POST', body: JSON.stringify({ path: file, format: 'modrinth', name: build.slice(0, 120), backup: false }) })
        setBusy('host')
      } else if (version) await api(base + '/core', { method: 'PATCH', body: JSON.stringify({ version }) }).catch(() => {})
      // Адрес появляется не сразу, а запуск после установки сборки может не пройти с первого раза.
      for (let i = 0; i < 40 && alive.current; i++) {
        const fresh = await api<MyServer>(base).catch(() => null)
        if (fresh && fresh.status !== 'RUNNING' && fresh.status !== 'STARTING' && i % 4 === 0) await api(base + '/start', { method: 'POST' }).catch(() => {})
        if (fresh?.address && (fresh.status === 'RUNNING' || fresh.status === 'STARTING' || i > 20)) {
          setMine((l) => [fresh, ...l.filter((x) => x.id !== fresh.id)])
          setSrv(fresh.id)
          return { addr: fresh.address, name: serverTitle(fresh) }
        }
        await new Promise((r) => window.setTimeout(r, 3000))
      }
      showToast('Сервер создаётся дольше обычного — он появится в «Хостинге»', 'error')
      return null
    } catch (e) {
      showToast(apiErrorText(e, 'Сервер не создался'), 'error')
      return null
    } finally {
      setBusy('')
    }
  }

  const create = async (place?: { addr: string; name: string }) => {
    if (busy || !pick) return
    const at = place?.addr || where
    const atName = place?.name || whereName
    if (needServer && !at) return showToast('Выбери сервер, где играем', 'error')
    setBusy('new')
    try {
      const base = await targetForMode(pick.mode)
      // Гостям видно, где играем: сервер стоит в названии комнаты.
      const target = base && needServer ? { ...base, title: (base.title + ' · ' + atName).slice(0, 64) } : base
      if (target && needServer) planServer(target, at)
      if (target && (await openRoom(target, open))) {
        // Закрытая комната — сразу к друзьям: зайти в неё можно только по приглашению.
        if (open) close()
        else setTab('friends')
      }
    } catch (e) {
      console.error('[party] room', e)
      showToast('Не удалось собрать комнату', 'error')
    } finally {
      setBusy('')
    }
  }

  const needle = q.trim().toLowerCase()
  const shown = places.filter((p) => (needle ? p.title.toLowerCase().includes(needle) : p.cat === cat))

  return (
    <div className="prm-back" onPointerDown={close}>
      <div className="prm-win" role="dialog" aria-modal="true" aria-label="Найти пати" data-private data-section="party_rooms" onPointerDown={(e) => e.stopPropagation()}>
        <aside className="prm-side">
          <b className="prm-title">Пати</b>
          <button className={'prm-nav' + (tab === 'join' ? ' on' : '')} aria-pressed={tab === 'join'} onClick={() => setTab('join')}>
            <Icon id="i-search" />
            Комнаты
            {rooms ? <span className="prm-n">{rooms.length}</span> : null}
          </button>
          <button className={'prm-nav' + (tab === 'own' ? ' on' : '')} aria-pressed={tab === 'own'} onClick={() => setTab('own')}>
            <Icon id="i-plus" />
            Своя комната
          </button>
          <button className={'prm-nav' + (tab === 'friends' ? ' on' : '')} aria-pressed={tab === 'friends'} onClick={() => setTab('friends')}>
            <Icon id="i-users" />
            Позвать друга
          </button>
        </aside>

        <section className="prm-main">
          <button className="pim-x prm-x" aria-label="Закрыть" onClick={close}>
            <Icon id="i-x" />
          </button>
          {tab === 'friends' ? (
            <>
              <h2 className="prm-h">Позвать друга</h2>
              <PartyInviteList close={close} />
            </>
          ) : tab === 'join' ? (
            <>
              <h2 className="prm-h">Открытые комнаты</h2>
              <div className="prm-rooms">
                {askAge ? (
                  <AgeGate />
                ) : failed ? (
                  <div className="pim-empty">
                    <b>{failed}</b>
                    <button className="btn sm primary" onClick={() => void load()}>
                      Повторить
                    </button>
                  </div>
                ) : !rooms ? (
                  [0, 1, 2].map((i) => <div className="prm-row skel" key={i} aria-hidden="true" />)
                ) : rooms.length ? (
                  rooms.map((r) => <RoomRow key={r.id} r={r} busy={busy === r.id} onJoin={() => void join(r)} />)
                ) : (
                  <div className="pim-empty">
                    <Icon id="i-users" />
                    <b>Сейчас никто не ждёт</b>
                    <button className="btn md primary" onClick={() => setTab('own')}>
                      Открыть свою
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="prm-h">Куда идём</h2>
              <div className="prm-bar">
                <div className="segs prm-cats" role="tablist">
                  {CATS.map((c) => (
                    <button key={c.id} role="tab" aria-selected={!needle && cat === c.id} className={'seg' + (!needle && cat === c.id ? ' on' : '')} onClick={() => { setQ(''); setCat(c.id) }}>
                      <Icon id={c.icon} />
                      {c.label}
                      <span className="prm-cn">{places.filter((p) => p.cat === c.id).length}</span>
                    </button>
                  ))}
                </div>
                <div className="input sm prm-search">
                  <Icon id="i-search" />
                  <input placeholder="Сервер, сборка, версия" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
              <div className="prm-grid">
                {shown.map((p) => (
                  <button key={p.key} className={'prm-tile' + (pick && p.key === pick.key ? ' on' : '')} aria-pressed={!!pick && p.key === pick.key} data-track="party_room_pick" data-kind={p.cat} onClick={() => setChosen(p.key)}>
                    <span className="prm-tile-art">{p.art}</span>
                    <b>{p.title}</b>
                    <span>{p.sub}</span>
                  </button>
                ))}
                {!shown.length ? (
                  <div className="pim-empty">
                    <b>{cat === 'builds' && !needle ? 'Сборок пока нет' : 'Ничего не нашлось'}</b>
                  </div>
                ) : null}
              </div>
              {needServer ? (
                <div className="prm-srv">
                  <b>Где играем</b>
                  {mine.map((m) => (
                    <button key={m.id} className={'pty-chip' + (srv === m.id ? ' hot' : '')} aria-pressed={srv === m.id} onClick={() => setSrv(m.id)}>
                      <Icon id="i-server" />
                      {serverTitle(m)}
                    </button>
                  ))}
                  <div className={'input sm prm-addr' + (srv === 'addr' ? ' on' : '')}>
                    <input placeholder="Адрес сервера" maxLength={80} value={addr} onFocus={() => setSrv('addr')} onChange={(e) => { setAddr(e.target.value); setSrv('addr') }} />
                  </div>
                  {pick && (pick.mode.kind === 'version' || (pick.mode.kind === 'build' && hasTauri())) && !mine.length ? (
                    <button
                      className="pty-chip hot"
                      data-track="party_room_host_now"
                      disabled={!!busy}
                      onClick={() => {
                        const m = pick.mode
                        const job = m.kind === 'build' ? hostNow('', m.name, m.name) : hostNow(m.kind === 'version' ? m.version : '', 'Пати ' + pick.title)
                        void job.then((place) => place && create(place))
                      }}
                    >
                      <Icon id="i-zap" />
                      {busy === 'send' ? 'Отправляем сборку…' : busy === 'host' ? 'Создаём сервер…' : 'Сервер Millida бесплатно'}
                    </button>
                  ) : (
                    <button
                      className="pty-chip"
                      data-track="party_room_host"
                      onClick={() => {
                        close()
                        setScreen('hosting')
                      }}
                    >
                      <Icon id="i-plus" />
                      Создать сервер
                    </button>
                  )}
                </div>
              ) : null}
              <div className="prm-foot">
                <div className="prm-who">
                  <button className={'prm-opt' + (open ? ' on' : '')} aria-pressed={open} onClick={() => setOpen(true)}>
                    <Icon id="i-users" />
                    <b>Все</b>
                    <span>видна в списке</span>
                  </button>
                  <button className={'prm-opt' + (open ? '' : ' on')} aria-pressed={!open} onClick={() => setOpen(false)}>
                    <Icon id="i-lock" />
                    <b>Только друзья</b>
                    <span>по приглашению</span>
                  </button>
                </div>
                <button className="btn lg primary prm-go" data-track="party_room_create" data-kind={pick?.cat} disabled={!pick || !!busy || (needServer && !where)} onClick={() => void create()}>
                  <span>
                    Открыть комнату
                    <em>{!pick ? 'выбери, куда идём' : needServer && !where ? 'выбери сервер' : pick.title}</em>
                  </span>
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
