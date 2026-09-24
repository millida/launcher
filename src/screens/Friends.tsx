import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Head } from '../components/Head'
import { PROFILE_URL, api, openExt } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { apiErrorText } from '../lib/apiError'
import { logoutToLogin } from '../lib/session'
import { showToast } from '../state/ui'
import { useHasMillida } from '../state/auth'
import { refreshGameNick, useGameNick } from '../state/gameNick'
import { loadFriends, openFriendProfile, unreadTotal, useFriends } from '../state/friends'
import { loadFriendHours, useFriendHours } from '../state/friendHours'
import { loadRooms, roomsUnreadTotal, useRooms } from '../state/rooms'
import { openMessages } from '../state/chatScreen'
import { useCall } from '../state/call'
import { uiConfirm } from '../state/confirm'
import { FriendRow } from '../components/friends/FriendRow'
import { AddRows, exactOf, isTechnicalNick, requestFor, sendRequest, useNickLookup } from '../components/friends/FriendSearch'
import { FriendsEmpty } from '../components/friends/FriendsEmpty'
import { unreadText } from '../components/friends/ChatRow'
import { PlayTogether } from '../components/friends/PlayTogether'
import { RequestsTab } from '../components/friends/RequestsTab'
import {
  addCandidate,
  loadTab,
  matchFriend,
  matchRequest,
  norm,
  saveTab,
} from '../components/friends/friendsView'
import type { FriendsTab } from '../components/friends/friendsView'
import { FRIENDS_TAB_EVENT } from '../components/friends/friendsView'
import type { Friend } from '../state/friends'
import '../styles/pixel/friends.css'

interface Blocked {
  blockedId: string
  user?: { id: string; nickname?: string; displayName?: string; avatarUrl?: string | null } | null
}

/// «Не в сети» длиннее этого — свёрнут: те, кто сейчас не ответит, не должны
/// выталкивать играющих за экран.
const OFFLINE_FOLD = 8

function Skeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div className="fr-row fr-skel" key={i}>
          <span className="fr-skel-ava" />
          <span className="fr-body">
            <span className="fr-skel-line" style={{ width: 120 + i * 24 }} />
            <span className="fr-skel-line sm" style={{ width: 80 + i * 18 }} />
          </span>
        </div>
      ))}
    </>
  )
}

export function Friends({ on }: { on: boolean }) {
  const friends = useFriends((s) => s.friends)
  const reqIn = useFriends((s) => s.reqIn)
  const reqOut = useFriends((s) => s.reqOut)
  const rooms = useRooms((s) => s.rooms)
  const millida = useHasMillida()
  const [tab, setTabState] = useState<FriendsTab>(loadTab)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'now' | 'hours'>('now')
  const [showOffline, setShowOffline] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<Blocked[]>([])
  const [ready, setReady] = useState(false)
  const hoursMap = useFriendHours((s) => s.sec)
  const callBusy = useCall((s) => s.status) !== 'idle'
  const findRef = useRef<HTMLInputElement>(null)

  const setTab = (t: FriendsTab) => {
    setTabState(t)
    saveTab(t)
    setMenuFor(null)
  }

  // Уведомление о заявке зовёт сразу на «Заявки».
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent).detail as FriendsTab
      if (t) {
        setTabState(t)
        setMenuFor(null)
      }
    }
    window.addEventListener(FRIENDS_TAB_EVENT, on)
    return () => window.removeEventListener(FRIENDS_TAB_EVENT, on)
  }, [])

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
    void Promise.all([loadFriends(), loadRooms()]).finally(() => setReady(true))
    void loadBlocked()
    void refreshGameNick()
  }, [on, millida])

  // Часы приходят по одному из профиля: список их не отдаёт (см. state/friendHours).
  useEffect(() => {
    if (!on || !millida || !friends.length) return
    loadFriendHours(friends.map((f) => f.userId))
  }, [on, millida, friends])

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    // Меню висит в корне документа на месте кнопки: прокрутка увела бы строку
    // из-под него.
    document.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menuFor])

  // Тост успеха — только после ответа службы: на сбое игрок видел
  // «заблокирован», а человек оставался в друзьях.
  const unblock = (b: Blocked) => {
    const nick = b.user?.nickname || b.user?.displayName || ''
    api('/core/blocks/' + encodeURIComponent(b.blockedId), { method: 'DELETE' })
      .then(() => showToast(nick + ' разблокирован'))
      .catch((e) => showToast(apiErrorText(e, 'Не удалось разблокировать'), 'error'))
      .finally(() => void loadBlocked())
  }

  const removeFriend = async (f: Friend) => {
    const nick = f.nickname || ''
    setMenuFor(null)
    if (!(await uiConfirm('Убрать ' + nick + ' из друзей?', { confirmLabel: 'Убрать' }))) return
    api('/friends/remove', { method: 'POST', body: JSON.stringify({ userId: f.userId }) })
      .then(() => showToast(nick + ' удалён из друзей', 'ok', 'delete'))
      .catch((e) => showToast(apiErrorText(e, 'Не удалось убрать из друзей'), 'error'))
      .finally(() => void loadFriends())
  }
  const blockFriend = async (f: Friend) => {
    const nick = f.nickname || ''
    setMenuFor(null)
    const ok = await uiConfirm('Заблокировать ' + nick + '? Он пропадёт из друзей и не сможет писать.', {
      confirmLabel: 'Заблокировать',
    })
    if (!ok) return
    try {
      await api('/friends/block', { method: 'POST', body: JSON.stringify({ userId: f.userId }) })
    } catch (e) {
      showToast(apiErrorText(e, 'Не удалось заблокировать'), 'error')
      return
    }
    // Служба пока только записывает блокировку, дружба остаётся (аудит F1):
    // убираем из друзей сами, чтобы обещание в вопросе было правдой.
    await api('/friends/remove', { method: 'POST', body: JSON.stringify({ userId: f.userId }) }).catch(() => {})
    showToast(nick + ' заблокирован и убран из друзей')
    void loadFriends()
    void loadBlocked()
  }

  const gated = !millida
  const accountNick = useGameNick((s) => s.accountNick)
  const myNick = accountNick && !isTechnicalNick(accountNick) ? accountNick : ''
  const copyNick = async () => {
    const ok = await copyText(myNick)
    showToast(ok ? 'Ник скопирован: ' + myNick : 'Не удалось скопировать ник', ok ? 'ok' : 'error')
  }

  // ── Поиск: одно поле фильтрует вкладку и превращается в заявку ─────────────
  const needle = norm(q)
  const visible = useMemo(() => friends.filter((f) => matchFriend(f, needle)), [friends, needle])
  const inShown = reqIn.filter((r) => matchRequest(r, needle))
  const outShown = reqOut.filter((r) => matchRequest(r, needle))
  const candidate = gated ? '' : addCandidate(q, friends, reqOut, myNick)
  const found = useNickLookup(candidate)
  const clearQ = () => setQ('')

  const playing = visible.filter((f) => f.playing)
  const online = visible.filter((f) => f.online && !f.playing)
  const offline = visible.filter((f) => !f.online)
  const offlineFolded = !needle && !showOffline && offline.length > OFFLINE_FOLD

  /// Срез «кто больше играет»: те, чьи часы известны, по убыванию; остальные —
  /// следом, без выдуманного нуля.
  const byHours = useMemo(() => {
    const val = (f: Friend) => hoursMap[f.userId] ?? -1
    return visible.slice().sort((a, b) => val(b) - val(a))
  }, [visible, hoursMap])

  /// Что сделает Enter: первое, что стоит в списке вкладки. Строка «Добавить»
  /// первая, только когда совпадений нет — иначе «Kir» + Enter отправлял бы
  /// заявку незнакомцу вместо того, чтобы открыть Kirpich.
  const tabHits = tab === 'friends' ? visible.length : inShown.length + outShown.length
  const addFirst = !!candidate && (!needle || tabHits === 0)
  const addRows = candidate ? <AddRows nick={candidate} found={found} onSent={clearQ} lead={addFirst} /> : null
  const enter = () => {
    if (!needle) return
    if (tab === 'friends' && visible.length) {
      const first = view === 'hours' ? byHours[0] : playing[0] || online[0] || offline[0]
      void openFriendProfile(first.userId, first.nickname || '')
      return
    }
    // На «Заявках» у строки два ответа (принять/отклонить) — Enter не выбирает за человека.
    if (candidate && addFirst) void sendRequest(requestFor(candidate, exactOf(candidate, found)), clearQ)
  }


  const row = (f: Friend, rank?: number) => (
    <FriendRow
      key={f.userId}
      f={f}
      rank={rank}
      hours={hoursMap[f.userId] ?? null}
      callBusy={callBusy}
      menuOpen={menuFor === f.userId}
      onMenu={() => setMenuFor(menuFor === f.userId ? null : f.userId)}
      onRemove={() => void removeFriend(f)}
      onBlock={() => void blockFriend(f)}
    />
  )

  const section = (title: string, list: Friend[]) =>
    list.length ? (
      <>
        <div className="fr-cap">{title + ' · ' + list.length}</div>
        {list.map((f) => row(f))}
      </>
    ) : null

  const chatUnread = unreadTotal(friends) + roomsUnreadTotal(rooms)
  const loading = !ready && !friends.length && !rooms.length

  const friendsTab = () => {
    if (loading) return <Skeleton />
    if (!friends.length) return needle ? null : <FriendsEmpty myNick={myNick} onFind={() => findRef.current?.focus()} />
    if (!visible.length) return needle && !candidate ? <p className="faint-note fr-none">Никого не нашли</p> : null
    if (view === 'hours') return byHours.map((f, i) => row(f, i + 1))
    return (
      <>
        {section('Играют сейчас', playing)}
        {section('В сети', online)}
        {offline.length ? (
          <>
            <div className="fr-cap">
              {'Не в сети · ' + offline.length}
              {offlineFolded ? (
                <button className="btn sm ghost fr-cap-act" data-track="friends_show_offline" onClick={() => setShowOffline(true)}>
                  <Icon id="i-chev-d" />
                  Показать всех
                </button>
              ) : null}
            </div>
            {offlineFolded ? null : offline.map((f) => row(f))}
          </>
        ) : null}
      </>
    )
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-friends">
      <div className="page-head">
        <h1>Друзья</h1>
        {!gated ? (
          <div className="right">
            <div className="input sm fr-q">
              <Icon id="i-search" />
              <input
                ref={findRef}
                id="frQ"
                placeholder="Ник друга"
                value={q}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') enter()
                  else if (e.key === 'Escape') {
                    e.stopPropagation()
                    clearQ()
                  }
                }}
              />
              {q ? (
                <button className="fr-q-x" aria-label="Очистить" data-track="search_clear" onClick={clearQ}>
                  <Icon id="i-x" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {gated ? (
        <div className="card gate-card">
          <div className="gate-ic">
            <Icon id="i-users" />
          </div>
          <div className="gate-title">Играй вместе с друзьями</div>
          {/* Что даёт вход — значками, а не абзацем. */}
          <div className="fr-gate-feats">
            <span>
              <Icon id="i-play" />
              Кто играет
            </span>
            <span>
              <Icon id="i-login" />
              Зайти к другу
            </span>
            <span>
              <Icon id="i-msg" />
              Чат
            </span>
            <span>
              <Icon id="i-phone" />
              Звонки
            </span>
          </div>
          <button className="btn md primary gate-btn" id="frLoginCta" data-track="login" onClick={() => logoutToLogin()}>
            <Icon id="i-login" />
            Войти
          </button>
        </div>
      ) : (
        <>
          <div className="fr-tabbar">
            <div className="segs fr-tabs" role="tablist">
              <button
                className={'seg' + (tab === 'friends' ? ' on' : '')}
                role="tab"
                aria-selected={tab === 'friends'}
                data-track="friends_tab_friends"
                onClick={() => setTab('friends')}
              >
                <Icon id="i-users" />
                Друзья
                {friends.length ? <span className="fr-tab-n">{friends.length}</span> : null}
              </button>
              <button
                className={'seg' + (tab === 'requests' ? ' on' : '')}
                role="tab"
                aria-selected={tab === 'requests'}
                data-track="friends_tab_requests"
                onClick={() => setTab('requests')}
              >
                <Icon id="i-inbox" />
                Заявки
                {reqIn.length ? <span className="fr-tab-n hot">{unreadText(reqIn.length)}</span> : null}
              </button>
            </div>
            <div className="fr-tabbar-tool">
              {tab === 'friends' && friends.length > 1 ? (
                <div className="segs fr-sort">
                  <button className={'seg' + (view === 'now' ? ' on' : '')} data-track="friends_sort_now" onClick={() => setView('now')}>
                    Сейчас
                  </button>
                  <button className={'seg' + (view === 'hours' ? ' on' : '')} data-track="friends_sort_hours" onClick={() => setView('hours')}>
                    <Icon id="i-clock" />
                    Часы
                  </button>
                </div>
              ) : null}
              {/* Переписки и группы — свой экран, как в Telegram (владелец 24.09.2026). */}
              <button className="btn sm secondary fr-to-chat" data-track="nav_messages" onClick={openMessages}>
                <Icon id="i-msg" />
                Сообщения
                {chatUnread ? <span className="fr-tab-n hot">{unreadText(chatUnread)}</span> : null}
              </button>
            </div>
          </div>

          <div className="stack fr-list" id="frList" data-private data-section="friends_list">
            {addFirst ? addRows : null}
            {tab === 'friends' && !needle && friends.length ? <PlayTogether /> : null}
            {tab === 'friends' ? friendsTab() : <RequestsTab incoming={inShown} outgoing={outShown} />}
            {!addFirst && needle ? addRows : null}

            {tab === 'friends' && !needle && blocked.length ? (
              <>
                <div className="fr-cap">{'Заблокированные · ' + blocked.length}</div>
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
                      <button className="btn sm secondary" data-track="unblock" onClick={() => unblock(b)}>
                        <Icon id="i-check" /> Разблокировать
                      </button>
                    </div>
                  )
                })}
              </>
            ) : null}
          </div>

          {tab === 'friends' && friends.length && !needle ? (
            <div className="fr-nick-note">
              {myNick ? (
                <p className="faint-note">
                  Твой ник для друзей: <b>{myNick}</b>
                </p>
              ) : (
                <p className="faint-note">Ник служебный — друзья тебя не найдут</p>
              )}
              {myNick ? (
                <button className="btn sm ghost" data-track="copy_my_nick" onClick={() => void copyNick()}>
                  <Icon id="i-copy" />
                  Скопировать
                </button>
              ) : (
                <button className="btn sm ghost" data-track="set_nick" onClick={() => openExt(PROFILE_URL)}>
                  <Icon id="i-user" />
                  Задать ник
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
