import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Head } from '../components/Head'
import { PROFILE_URL, api, openExt } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { logoutToLogin } from '../lib/session'
import { showToast } from '../state/ui'
import { useHasMillida } from '../state/auth'
import { refreshGameNick, useGameNick } from '../state/gameNick'
import { loadFriends, openChat, openFriendProfile, openRoomChat, useFriends } from '../state/friends'
import { callFriend, callSupported, joinRoomVoice, useCall } from '../state/call'
import { loadRooms, nickInRooms, openRoomCreate, openRoomManage, useRooms } from '../state/rooms'
import { rememberServerName } from '../state/playStats'
import { uiConfirm } from '../state/confirm'
import { quickJoin } from '../lib/joinServer'
import type { Friend, FoundUser } from '../state/friends'

const TECHNICAL_NICK = /^(skins|smx|guest|user)_\d{6,}$/i
const isTechnicalNick = (nick?: string) => TECHNICAL_NICK.test((nick || '').trim())

const friendServer = (f: Friend): string | undefined =>
  f.serverIp || (f as { server?: string; serverAddress?: string }).server || (f as { serverAddress?: string }).serverAddress

async function sendRequest(opts: Record<string, string>, clear: () => void) {
  try {
    const r = await api('/friends/request', { method: 'POST', body: JSON.stringify(opts) })
    showToast(r.status === 'accepted' || r.status === 'already_friends' ? 'Теперь в друзьях' : 'Заявка отправлена')
  } catch {
    showToast('Не удалось отправить заявку — войди в аккаунт Millida')
  }
  clear()
  void loadFriends()
}

interface Blocked {
  blockedId: string
  user?: { id: string; nickname?: string; displayName?: string; avatarUrl?: string | null } | null
}

/**
 * Группы. Карточка отвечает на два вопроса сразу: есть ли непрочитанное и идёт
 * ли там сейчас разговор — второе видно по головам участников в голосе, поэтому
 * зайти к своим можно одним нажатием, не открывая переписку.
 */
function RoomsSection() {
  const rooms = useRooms((s) => s.rooms)
  const callStatus = useCall((s) => s.status)
  const callRoom = useCall((s) => s.roomId)
  return (
    <div className="stack rooms-stack">
      <div className="side-cap rooms-cap">{rooms.length ? 'Группы — ' + rooms.length : 'Группы'}</div>
      {rooms.length ? (
        rooms.map((r) => {
          const inside = r.voice || []
          const here = callRoom === r.id && callStatus !== 'idle'
          return (
            <div
              className={'fr-row room-row' + (r.unread ? ' unread' : '')}
              key={r.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                void openRoomChat(r.id, r.title)
              }}
            >
              <span className="room-ava">
                <Icon id="i-users" />
              </span>
              <span className="fr-body">
                <span className="fr-nick">{r.title}</span>
                <span className={'fr-status' + (inside.length ? ' on' : '')}>
                  {inside.length ? <span className="dot"></span> : null}
                  {inside.length
                    ? 'В разговоре: ' + inside.map((v) => nickInRooms(v.userId) || '…').join(', ')
                    : r.members.map((m) => m.nickname).join(', ')}
                </span>
              </span>
              {callSupported() ? (
                <button
                  className={'btn sm ' + (inside.length && !here ? 'primary' : 'secondary')}
                  title={here ? 'Ты в разговоре' : 'Зайти в разговор группы'}
                  disabled={here || (callStatus !== 'idle' && !here)}
                  onClick={() => void joinRoomVoice(r.id, r.title)}
                >
                  <Icon id={inside.length ? 'i-headset' : 'i-phone'} />
                  {here ? 'В разговоре' : inside.length ? 'Зайти · ' + inside.length : 'Разговор'}
                </button>
              ) : null}
              <button className="btn sm secondary fr-msg" onClick={() => void openRoomChat(r.id, r.title)}>
                <Icon id="i-msg" />
                Открыть
                {r.unread ? <span className="fr-unread">{r.unread > 9 ? '9+' : r.unread}</span> : null}
              </button>
              <button className="tb-btn" title="Участники" onClick={() => openRoomManage(r.id)}>
                <Icon id="i-dots" />
              </button>
            </div>
          )
        })
      ) : (
        <p className="faint-note">
          Группа — общий чат и общий разговор для своих. Позови в неё друзей: голос держится сам, заходить можно
          в любой момент.
        </p>
      )}
    </div>
  )
}

export function Friends({ on }: { on: boolean }) {
  const { friends, reqIn, reqOut, found, set } = useFriends()
  const millida = useHasMillida()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<Blocked[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const loadBlocked = async () => {
    try {
      const r = await api('/core/blocks')
      setBlocked(Array.isArray(r?.items) ? r.items : [])
    } catch {
      setBlocked([])
    }
  }
  useEffect(() => {
    if (!on || !millida) return
    void loadFriends()
    void loadRooms()
    void loadBlocked()
    void refreshGameNick()
  }, [on, millida])

  const unblock = (b: Blocked) => {
    const nick = b.user?.nickname || b.user?.displayName || ''
    api('/core/blocks/' + encodeURIComponent(b.blockedId), { method: 'DELETE' })
      .catch(() => {})
      .finally(() => {
        showToast(nick + ' разблокирован')
        void loadBlocked()
      })
  }

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuFor])

  useEffect(() => {
    if (!addOpen) return
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.fr-add-wrap')) return
      setAddOpen(false)
      set({ found: null })
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [addOpen, set])

  const removeFriend = async (f: Friend) => {
    const nick = f.nickname || ''
    setMenuFor(null)
    if (!(await uiConfirm('Убрать ' + nick + ' из друзей?', { confirmLabel: 'Убрать' }))) return
    api('/friends/remove', { method: 'POST', body: JSON.stringify({ userId: f.userId }) })
      .catch(() => {})
      .finally(() => {
        showToast(nick + ' удалён из друзей', 'ok', 'delete')
        void loadFriends()
      })
  }
  const blockFriend = async (f: Friend) => {
    const nick = f.nickname || ''
    setMenuFor(null)
    if (!(await uiConfirm('Заблокировать ' + nick + '? Он пропадёт из друзей и не сможет писать и добавляться.', { confirmLabel: 'Заблокировать' })))
      return
    api('/friends/block', { method: 'POST', body: JSON.stringify({ userId: f.userId }) })
      .catch(() => {})
      .finally(() => {
        showToast(nick + ' заблокирован и убран из друзей')
        void loadFriends()
        void loadBlocked()
      })
  }

  const clear = () => {
    setQ('')
    set({ found: null })
    setAddOpen(false)
  }

  const onSearch = (v: string) => {
    setQ(v)
    clearTimeout(timer.current)
    const val = v.trim()
    if (val.length < 2) {
      set({ found: null })
      return
    }
    timer.current = setTimeout(async () => {
      let results: FoundUser[] = []
      try {
        results = (await api('/friends/search?q=' + encodeURIComponent(val))).results || []
      } catch {
        results = []
      }
      set({ found: results.filter((r) => !isTechnicalNick(r.nickname)).slice(0, 6) })
    }, 350)
  }

  const joinFriend = (f: Friend) => {
    const addr = friendServer(f)
    if (!addr) return
    const name = f.serverName || 'Сервер ' + (f.nickname || 'друга')
    rememberServerName(addr, name)
    void quickJoin(addr, name).catch(() => {})
  }

  const gated = !millida
  const accountNick = useGameNick((s) => s.accountNick)
  const myNick = accountNick && !isTechnicalNick(accountNick) ? accountNick : ''
  const copyNick = async () => {
    const ok = await copyText(myNick)
    showToast(ok ? 'Ник скопирован: ' + myNick : 'Не удалось скопировать ник', ok ? 'ok' : 'error')
  }
  const callBusy = useCall((s) => s.status) !== 'idle'
  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? friends.filter((f) => (f.nickname || '').toLowerCase().includes(needle))
    : friends
  const playing = visible.filter((f) => f.playing)
  const online = visible.filter((f) => f.online && !f.playing)
  const offline = visible.filter((f) => !f.online)

  const row = (f: Friend) => (
    <div
      key={f.userId}
      className={'fr-row' + (f.online ? '' : ' off') + (f.unread ? ' unread' : '')}
      data-uid={f.userId}
      data-nick={f.nickname || ''}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        void openFriendProfile(f.userId, f.nickname || '')
      }}
    >
      <Head nick={f.nickname} size={40} />
      <span className="fr-body">
        <span className="fr-nick">{f.nickname || ''}</span>
        <span className={'fr-status' + (f.online ? ' on' : '') + (f.place === 'web' ? ' web' : '')}>
          {f.online ? <span className="dot"></span> : null}
          {f.text || ''}
          {f.playing && f.build ? <span className="fr-build">{f.build}</span> : null}
        </span>
      </span>
      {f.playing ? (
        friendServer(f) ? (
          <button className="btn sm secondary fr-join" onClick={() => joinFriend(f)}>
            <Icon id="i-login" />
            Зайти к нему
          </button>
        ) : (
          <span className="pill acc fr-playing" title="Друг в игре">
            <span className="dot"></span>В игре
          </span>
        )
      ) : null}
      {callSupported() ? (
        <button
          className="btn sm secondary call-start"
          title={callBusy ? 'Уже идёт звонок' : 'Позвонить'}
          disabled={callBusy}
          onClick={() => void callFriend(f.userId, f.nickname || '')}
        >
          <Icon id="i-phone" />
        </button>
      ) : null}
      <button
        className="btn sm secondary fr-msg"
        onClick={() => void openChat(f.userId, f.nickname || '')}
      >
        <Icon id="i-msg" />
        Написать
        {f.unread ? <span className="fr-unread">{f.unread > 9 ? '9+' : f.unread}</span> : null}
      </button>
      <span className="fr-more-wrap">
        <button
          className="tb-btn fr-more"
          title="Ещё"
          style={{ display: 'grid' }}
          onClick={(e) => {
            e.stopPropagation()
            setMenuFor(menuFor === f.userId ? null : f.userId)
          }}
        >
          <Icon id="i-dots" />
        </button>
        {menuFor === f.userId ? (
          <div className="fr-menu" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                setMenuFor(null)
                void openFriendProfile(f.userId, f.nickname || '')
              }}
            >
              <Icon id="i-user" /> Профиль
            </button>
            <button
              onClick={() => {
                setMenuFor(null)
                void openChat(f.userId, f.nickname || '')
              }}
            >
              <Icon id="i-msg" /> Написать
            </button>
            <button className="danger" onClick={() => removeFriend(f)}>
              <Icon id="i-trash" /> Убрать из друзей
            </button>
            <button className="danger" onClick={() => blockFriend(f)}>
              <Icon id="i-ban" /> Заблокировать
            </button>
          </div>
        ) : null}
      </span>
    </div>
  )

  const section = (title: string, list: Friend[], top?: boolean) =>
    list.length ? (
      <>
        <div className="side-cap" style={{ padding: (top ? '0' : '12px') + ' 2px 2px' }}>
          {title + ' — ' + list.length}
        </div>
        {list.map(row)}
      </>
    ) : null

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-friends">
      <div className="page-head">
        <h1>Друзья</h1>
        <div className="right fr-add-wrap">
          {!gated && friends.length > 4 ? (
            <div className="input sm fr-filter">
              <Icon id="i-search" />
              <input placeholder="Найти в списке…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          ) : null}
          {!gated ? (
            <button className="btn sm secondary" onClick={openRoomCreate}>
              <Icon id="i-users" />
              Создать группу
            </button>
          ) : null}
          <button
            className="btn sm primary"
            id="frAddBtn"
            onClick={(e) => {
              e.stopPropagation()
              setAddOpen((v) => !v)
              if (addOpen) set({ found: null })
            }}
          >
            <Icon id="i-plus" />
            Добавить друга
          </button>

          {addOpen ? (
            <div className="fr-add-pop" id="frFound" onClick={(e) => e.stopPropagation()}>
              <div className="fr-add-pop-cap">
                <Icon id="i-user" /> Добавить друга по нику Millida
              </div>
              <div className="input sm" style={{ width: '100%', marginBottom: '10px' }}>
                <Icon id="i-search" />
                <input
                  id="frAdd"
                  autoFocus
                  placeholder="Ник в Millida…"
                  value={q}
                  onChange={(e) => onSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const first = found && found[0]
                    if (first && !first.isFriend && !first.pending)
                      void sendRequest(first.userId ? { targetId: first.userId } : { nickname: first.nickname || '' }, clear)
                    else if (q.trim()) void sendRequest({ nickname: q.trim() }, clear)
                  }}
                />
              </div>
              {found === null ? (
                <p className="faint-note" style={{ padding: '4px 4px 2px' }}>
                  Введи ник друга в Millida — минимум 2 символа.
                </p>
              ) : found.length ? (
                found.map((r, i) => (
                  <div className="fr-row compact" key={i}>
                    <Head nick={r.nickname} size={40} />
                    <span className="fr-body">
                      <span className="fr-nick" title={r.nickname || ''}>
                        {r.nickname || ''}
                      </span>
                      <span className="fr-status">
                        {r.isFriend ? 'Уже в друзьях' : r.pending ? 'Заявка отправлена' : r.text || 'Игрок Millida'}
                      </span>
                    </span>
                    {r.isFriend || r.pending ? (
                      <span className="fr-done">
                        <Icon id="i-check" />
                      </span>
                    ) : (
                      <button
                        className="btn sm primary fr-send"
                        data-uid={r.userId}
                        data-nick={r.nickname || ''}
                        title={'Добавить ' + (r.nickname || '')}
                        onClick={() =>
                          void sendRequest(r.userId ? { targetId: r.userId } : { nickname: r.nickname || '' }, clear)
                        }
                      >
                        <Icon id="i-plus" />
                        <span>Добавить</span>
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="faint-note" style={{ padding: '6px 4px' }}>
                  Никого не нашли по нику «{q.trim()}»
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="stack" id="frReq">
        {reqIn.length || reqOut.length ? (
          <>
            <div className="side-cap" style={{ padding: '0 2px 2px' }}>
              Заявки
            </div>
            {reqIn.map((r) => (
              <div className="fr-row" key={r.id}>
                <Head nick={r.nickname} size={40} />
                <span className="fr-body">
                  <span className="fr-nick">{r.nickname || ''}</span>
                  <span className="fr-status">Хочет добавить тебя в друзья</span>
                </span>
                <button
                  className="btn sm primary fr-acc"
                  data-id={r.id}
                  onClick={() =>
                    api('/friends/accept', { method: 'POST', body: JSON.stringify({ id: r.id }) })
                      .catch(() => {})
                      .finally(() => {
                        showToast('Теперь в друзьях')
                        void loadFriends()
                      })
                  }
                >
                  <Icon id="i-check" />
                  Принять
                </button>
                <button
                  className="btn sm secondary fr-dec"
                  data-id={r.id}
                  onClick={() =>
                    api('/friends/decline', { method: 'POST', body: JSON.stringify({ id: r.id }) })
                      .catch(() => {})
                      .finally(() => void loadFriends())
                  }
                >
                  <Icon id="i-x" />
                  Отклонить
                </button>
              </div>
            ))}
            {reqOut.map((r) => (
              <div className="fr-row off" key={r.id}>
                <Head nick={r.nickname} size={40} />
                <span className="fr-body">
                  <span className="fr-nick">{r.nickname || ''}</span>
                  <span className="fr-status">Заявка отправлена</span>
                </span>
                <button
                  className="btn sm secondary fr-cancel"
                  data-id={r.id}
                  onClick={() =>
                    api('/friends/cancel', { method: 'POST', body: JSON.stringify({ id: r.id }) })
                      .catch(() => {})
                      .finally(() => void loadFriends())
                  }
                >
                  <Icon id="i-x" />
                  Отменить
                </button>
              </div>
            ))}
          </>
        ) : null}
      </div>
      {!gated ? <RoomsSection /> : null}
      <div className="stack" id="frList" style={{ marginTop: '10px' }}>
        {gated ? (
          <div className="card gate-card">
            <div className="gate-ic">
              <Icon id="i-users" />
            </div>
            <div className="gate-title">Друзья — в аккаунте Millida</div>
            <p className="faint-note gate-text">
              Войди в Millida — сможешь добавлять друзей по нику, видеть кто в сети и играет, и переписываться прямо в
              лаунчере.
            </p>
            <button className="btn md primary gate-btn" id="frLoginCta" onClick={() => logoutToLogin()}>
              Войти в Millida
            </button>
          </div>
        ) : friends.length ? (
          visible.length ? (
            <>
              {section('Играют сейчас', playing, true)}
              {section('В сети', online, !playing.length)}
              {section('Не в сети', offline, !playing.length && !online.length)}
            </>
          ) : (
            <p className="faint-note">{'Никого не нашли по «' + filter.trim() + '»'}</p>
          )
        ) : (
          <p className="faint-note">Пока никого. Нажми «Добавить друга» и найди его по нику Millida.</p>
        )}

        {!gated && blocked.length ? (
          <>
            <div className="side-cap" style={{ padding: '14px 2px 2px' }}>
              {'Заблокированные — ' + blocked.length}
            </div>
            {blocked.map((b) => {
              const nick = b.user?.nickname || b.user?.displayName || 'Пользователь'
              return (
                <div className="fr-row off" key={b.blockedId}>
                  <Head nick={b.user?.nickname} size={40} style={{ filter: 'grayscale(1)' }} />
                  <span className="fr-body">
                    <span className="fr-nick">{nick}</span>
                    <span className="fr-status">
                      <Icon id="i-ban" /> Заблокирован
                    </span>
                  </span>
                  <button className="btn sm secondary" onClick={() => unblock(b)}>
                    <Icon id="i-check" /> Разблокировать
                  </button>
                </div>
              )
            })}
          </>
        ) : null}
      </div>

      {!gated ? (
        <div className="fr-nick-note">
          {myNick ? (
            <p className="faint-note">
              Тебя находят по нику Millida — <b>{myNick}</b>. Игровой аккаунт не важен: с лицензией или без, пока
              лаунчер открыт, друзья видят тебя в сети, а в игре — на каком ты сервере.
            </p>
          ) : (
            <p className="faint-note">
              Чтобы друзья нашли тебя, задай ник Millida в профиле на сайте — сейчас у тебя служебный. Игровой аккаунт
              не важен: с лицензией или без, пока лаунчер открыт, друзья видят тебя в сети.
            </p>
          )}
          {myNick ? (
            <button className="btn sm ghost" onClick={() => void copyNick()}>
              <Icon id="i-copy" />
              Скопировать ник
            </button>
          ) : (
            <button className="btn sm ghost" onClick={() => openExt(PROFILE_URL)}>
              <Icon id="i-user" />
              Задать ник в профиле
            </button>
          )}
        </div>
      ) : null}
    </section>
  )
}
