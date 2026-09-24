import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { ChatThread } from '../components/Chat'
import { ChatRow, openChatItem } from '../components/friends/ChatRow'
import { chatList, matchFriend, norm } from '../components/friends/friendsView'
import { chatItems, chatKey } from '../lib/overlayChats'
import type { OverlayChatItem } from '../lib/overlayChats'
import { logoutToLogin } from '../lib/session'
import { useHasMillida } from '../state/auth'
import { loadFriends, openChat, openRoomChat, useFriends } from '../state/friends'
import { loadRooms, openRoomCreate, useRooms } from '../state/rooms'
import { useChatScreen } from '../state/chatScreen'
import { useTopBar } from '../state/topbar'
import { setScreen } from '../state/ui'
import { Head } from '../components/Head'
import '../styles/pixel/messages.css'

/// Telegram: список идёт по времени последнего сообщения. Без переписки —
/// кто в сети, дальше по имени.
function byTime(a: OverlayChatItem, b: OverlayChatItem): number {
  if (a.ts !== b.ts) return b.ts - a.ts
  if (a.online !== b.online) return a.online ? -1 : 1
  return a.title.localeCompare(b.title, 'ru')
}

function ListSkeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div className="cl-row cl-skel" key={i} aria-hidden="true">
          <span className="skel cl-skel-ava" />
          <span className="cl-body">
            <span className="skel cl-skel-line" style={{ width: 90 + i * 14 }} />
            <span className="skel cl-skel-line sm" style={{ width: 130 - i * 8 }} />
          </span>
        </div>
      ))}
    </>
  )
}

/**
 * Экран «Сообщения» (владелец 24.09.2026, 13:33): «как Telegram — заходишь в
 * чат и проваливаешься в него; слева список чатов, переключаешься между ними».
 * Группы живут здесь же, в одном списке с личкой, а не отдельной вкладкой.
 */
export function Messages({ on }: { on: boolean }) {
  const millida = useHasMillida()
  const friends = useFriends((s) => s.friends)
  const chatWith = useFriends((s) => s.chatWith)
  const chatRoom = useFriends((s) => s.chatRoom)
  const rooms = useRooms((s) => s.rooms)
  const me = useRooms((s) => s.me)
  const from = useChatScreen((s) => s.from)
  const setBack = useTopBar((s) => s.setBack)
  const [q, setQ] = useState('')
  const [ready, setReady] = useState(false)
  const booted = useRef(false)

  useEffect(() => {
    if (!on || !millida) return
    void Promise.all([loadFriends(), loadRooms()]).finally(() => setReady(true))
  }, [on, millida])

  // Пришли из «Друзей» или «Хостинга» — «Назад» ведёт туда; из лобби — «Лобби».
  useEffect(() => {
    if (!on || from === 'play' || from === 'chat') {
      setBack(null)
      return
    }
    setBack(() => setScreen(from))
    return () => setBack(null)
  }, [on, from, setBack])

  const needle = norm(q)
  const items = useMemo(() => {
    const list = chatList(friends, rooms, needle).sort(byTime)
    // Открытый разговор без переписки (профиль друга, «Написать» новому) стоит
    // в списке первым — как новый чат в Telegram, а не пропадает из колонки.
    const fresh = !needle && chatWith && !chatRoom && !list.some((i) => !i.room && i.id === chatWith)
    const f = fresh ? friends.find((x) => x.userId === chatWith) : undefined
    return f ? chatItems([f], []).concat(list) : list
  }, [friends, rooms, needle, chatWith, chatRoom])
  // Поиск находит и друзей, с кем ещё не переписывались: так начинается новый чат.
  const others = useMemo(
    () =>
      needle
        ? friends.filter((f) => matchFriend(f, needle) && !items.some((i) => !i.room && i.id === f.userId))
        : [],
    [friends, items, needle],
  )

  // Вход на экран: открытая переписка остаётся; закрытая с прошлого раза —
  // открывается снова; ничего — открывается верхний чат, пустого окна нет.
  useEffect(() => {
    if (!on || booted.current) return
    const s = useFriends.getState()
    if (s.chatOpen) {
      booted.current = true
      return
    }
    if (s.chatRoom || s.chatWith) {
      booted.current = true
      void (s.chatRoom ? openRoomChat(s.chatRoom, s.chatNick) : openChat(s.chatWith, s.chatNick))
      return
    }
    const top = chatList(friends, rooms, '').sort(byTime)[0]
    if (top) {
      booted.current = true
      openChatItem(top)
    }
  }, [on, friends, rooms])

  const openKey = chatRoom ? chatKey(chatRoom, true) : chatWith ? chatKey(chatWith, false) : ''
  const byFriend = useMemo(() => new Map(friends.map((f) => [f.userId, f])), [friends])
  const byRoom = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])
  const loading = !ready && !friends.length && !rooms.length

  if (!millida) {
    return (
      <section className={'screen' + (on ? ' on' : '')} id="s-chat">
        <div className="card gate-card">
          <div className="gate-title">Сообщения — после входа</div>
          <button className="btn md primary gate-btn" data-track="login" onClick={() => logoutToLogin()}>
            <Icon id="i-login" />
            Войти
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={'screen msgs' + (on ? ' on' : '')} id="s-chat">
      <aside className="msgs-side">
        <div className="msgs-side-top">
          <div className="input sm msgs-q">
            <Icon id="i-search" />
            <input
              placeholder="Поиск"
              value={q}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setQ('')
                }
                if (e.key === 'Enter') {
                  if (items[0]) openChatItem(items[0])
                  else if (others[0]) void openChat(others[0].userId, others[0].nickname || '')
                }
              }}
            />
          </div>
          <button className="btn sm secondary msgs-new" aria-label="Новая группа" data-track="room_create" onClick={openRoomCreate}>
            <Icon id="i-plus" />
            Группа
          </button>
        </div>
        <div className="msgs-list" role="list" data-private data-section="chat_list">
          {loading ? <ListSkeleton /> : null}
          {items.map((i) => (
            <ChatRow
              key={i.key}
              item={i}
              friend={i.room ? undefined : byFriend.get(i.id)}
              room={i.room ? byRoom.get(i.id) : undefined}
              me={me}
              active={i.key === openKey}
            />
          ))}
          {others.length ? <div className="msgs-cap">Друзья</div> : null}
          {others.map((f) => (
            <button className="cl-row" key={f.userId} data-track="chat_open_friend" onClick={() => void openChat(f.userId, f.nickname || '')}>
              <span className="cl-ava">
                <Head nick={f.nickname} src={f.avatarUrl} size={40} />
              </span>
              <span className="cl-body">
                <b className="cl-title">{f.nickname}</b>
              </span>
            </button>
          ))}
          {!loading && !items.length && !others.length ? (
            needle ? (
              <p className="faint-note msgs-none-q">Никого не нашли</p>
            ) : (
              <div className="msgs-blank">
                <b>Переписок нет</b>
                <button className="btn sm primary" data-track="nav_friends" onClick={() => setScreen('friends')}>
                  <Icon id="i-users" />
                  Друзья
                </button>
              </div>
            )
          ) : null}
        </div>
      </aside>
      <div className="msgs-main">
        {chatWith || chatRoom ? (
          <ChatThread />
        ) : (
          <div className="msgs-empty">
            <Icon id="i-msg" />
            <b>Выбери чат</b>
          </div>
        )}
      </div>
    </section>
  )
}
