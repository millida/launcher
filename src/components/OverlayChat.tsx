import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Head } from './Head'
import { Ticks } from './Ticks'
import { timeHM } from '../lib/format'
import { dayKey, dayLabel, isGrouped, isRead } from '../lib/chatGroup'
import { apiErrorText } from '../lib/apiError'
import { chatItems, chatKey, chatWhen, unreadOf, type OverlayChatItem } from '../lib/overlayChats'
import { initSecrets } from '../lib/secure'
import { overlayState } from '../ipc/commands'
import {
  loadFriends,
  loadOlderChat,
  markChatRead,
  openChat,
  openRoomChat,
  pingTyping,
  renderChat,
  retryChat,
  sendChat,
  useFriends,
  type ChatMessage,
} from '../state/friends'
import { loadRooms, useRooms } from '../state/rooms'

export interface OverlayTarget {
  id: string
  room: boolean
  title: string
}

/// The overlay never polls the message cursor - that belongs to the main window,
/// and two readers of one cursor eat each other's messages. What it does poll is
/// the open thread and the rail, which are plain reads of current state.
const THREAD_POLL_MS = 5_000
const LIST_POLL_MS = 20_000
const TYPING_GAP_MS = 3_000
const STICK_PX = 90
const COMPOSER_MAX_PX = 104

const attachmentLabel = (kind?: string) =>
  kind === 'voice' ? 'Голосовое сообщение' : kind === 'image' ? 'Изображение' : 'Файл'

function Skeleton() {
  return (
    <div className="ovc-skeleton" aria-hidden="true">
      {[62, 40, 74, 34].map((w, i) => (
        <span key={i} className={'ovc-sk' + (i % 2 ? ' me' : '')} style={{ width: w + '%' }} />
      ))}
    </div>
  )
}

export function OverlayChat({
  target,
  signal,
  onClose,
  onLauncher,
}: {
  target: OverlayTarget | null
  signal: number
  onClose: () => void
  onLauncher: (target: OverlayTarget | null) => void
}) {
  const friends = useFriends((s) => s.friends)
  const rooms = useRooms((s) => s.rooms)
  const chatWith = useFriends((s) => s.chatWith)
  const chatRoom = useFriends((s) => s.chatRoom)
  const chatNick = useFriends((s) => s.chatNick)
  const msgs = useFriends((s) => s.chatMsgs)
  const seq = useFriends((s) => s.chatSeq)
  const peerReadAt = useFriends((s) => s.chatPeerReadAt)
  const hasMore = useFriends((s) => s.chatHasMore)
  const olderBusy = useFriends((s) => s.chatOlderBusy)

  const [filter, setFilter] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hotkey, setHotkey] = useState('')

  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const typedAt = useRef(0)
  const seen = useRef(0)

  const openId = chatRoom || chatWith
  const openKey = openId ? chatKey(openId, !!chatRoom) : ''
  const all = useMemo(() => chatItems(friends, rooms), [friends, rooms])
  const items = useMemo(() => chatItems(friends, rooms, filter), [friends, rooms, filter])
  const unread = useMemo(() => unreadOf(all), [all])
  // The header describes the open conversation, so it reads the whole list: a
  // search that hides the row must not take the peer's face and status with it.
  const current = all.find((i) => i.key === openKey)

  useEffect(() => {
    void initSecrets().then(() => {
      void loadFriends()
      void loadRooms()
    })
    overlayState()
      .then((s) => setHotkey(s.hotkey))
      .catch(() => {})
  }, [])

  const open = useCallback(async (c: OverlayTarget) => {
    setError('')
    setLoading(true)
    stick.current = true
    try {
      if (c.room) await openRoomChat(c.id, c.title)
      else await openChat(c.id, c.title)
    } finally {
      setLoading(false)
    }
    setTimeout(() => inputRef.current?.focus(), 20)
  }, [])

  const targetKey = target ? chatKey(target.id, target.room) : ''
  useEffect(() => {
    if (!target) return
    void open(target)
  }, [targetKey, open])

  // A card arriving while the panel is up is both a rail update and, when it
  // belongs to the open thread, a message the user is looking at right now.
  useEffect(() => {
    if (!signal) return
    void loadFriends()
    void loadRooms()
    if (openId) void renderChat()
  }, [signal, openId])

  useEffect(() => {
    if (!openId) return
    const t = setInterval(() => void renderChat(), THREAD_POLL_MS)
    return () => clearInterval(t)
  }, [openId])

  useEffect(() => {
    const t = setInterval(() => {
      void loadFriends()
      void loadRooms()
    }, LIST_POLL_MS)
    return () => clearInterval(t)
  }, [])

  // Reading over the game is still reading: a thread that grew while it was on
  // screen must not keep its unread badge in the launcher.
  useEffect(() => {
    if (!openId) {
      seen.current = 0
      return
    }
    const grew = msgs.length > seen.current
    seen.current = msgs.length
    if (grew && !msgs[msgs.length - 1]?.me) markChatRead(openId, !!chatRoom)
  }, [msgs, openId, chatRoom])

  useLayoutEffect(() => {
    const b = boxRef.current
    if (b && stick.current) b.scrollTop = b.scrollHeight
  }, [seq, openKey, loading])

  const older = async () => {
    const b = boxRef.current
    const before = b?.scrollHeight || 0
    const added = await loadOlderChat()
    if (added && b) requestAnimationFrame(() => void (b.scrollTop = b.scrollHeight - before))
  }

  const send = async () => {
    const body = text.trim()
    if (!body || sending || !openId) return
    setSending(true)
    setError('')
    stick.current = true
    try {
      await sendChat(body)
      setText('')
    } catch (e) {
      setError(apiErrorText(e, 'Сообщение не отправлено'))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const type = (v: string) => {
    setText(v)
    const el = inputRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, COMPOSER_MAX_PX) + 'px'
    }
    const now = Date.now()
    if (v && now - typedAt.current > TYPING_GAP_MS) {
      typedAt.current = now
      pingTyping()
    }
  }

  const asTarget = (i: OverlayChatItem): OverlayTarget => ({ id: i.id, room: i.room, title: i.title })

  const bubble = (m: ChatMessage, i: number) => {
    const grouped = isGrouped(msgs, i)
    const att = m.attachment
    const showAuthor = !!chatRoom && !m.me && !grouped
    return (
      <Fragment key={m.id || m.localId || String(m.ts) + i}>
        {m.ts && dayKey(m.ts) !== dayKey(msgs[i - 1]?.ts) ? (
          <span className="chat-day">{dayLabel(m.ts)}</span>
        ) : null}
        <div className={'msg-row' + (m.me ? ' me' : '')}>
          {showAuthor ? (
            <span className="msg-author">
              <Head nick={m.fromNick} size={18} />
              {m.fromNick || 'Участник'}
            </span>
          ) : null}
          <div
            className={
              'msg' +
              (m.me ? ' me' : '') +
              (grouped ? ' grouped' : '') +
              (m.state === 'sending' ? ' sending' : '') +
              (m.state === 'failed' ? ' failed' : '')
            }
          >
            {m.deleted ? (
              <span className="msg-gone">Сообщение удалено</span>
            ) : (
              <>
                {att && att.kind === 'image' ? (
                  <img className="msg-img" src={att.url} alt="" loading="lazy" />
                ) : att ? (
                  <button className="ovc-att" onClick={() => onLauncher(current ? asTarget(current) : null)}>
                    <Icon id={att.kind === 'voice' ? 'i-mic' : 'i-box'} />
                    <span>
                      <b>{att.name || attachmentLabel(att.kind)}</b>
                      Открыть в лаунчере
                    </span>
                  </button>
                ) : null}
                {m.text ? <span className="msg-text">{m.text}</span> : null}
              </>
            )}
            <span className="msg-meta">
              <span>{timeHM(m.ts)}</span>
              {m.editedAt ? <span>изменено</span> : null}
              {m.me && m.state !== 'failed' ? <Ticks state={m.state} read={isRead(m, peerReadAt)} /> : null}
            </span>
          </div>
          {m.state === 'failed' ? (
            <button className="ovc-retry" onClick={() => void retryChat(m.localId || '')}>
              <Icon id="i-restart" />
              Не отправлено — повторить
            </button>
          ) : null}
        </div>
      </Fragment>
    )
  }

  return (
    <div className="ovc">
      <aside className="ovc-rail">
        <div className="ovc-brand">
          <Icon id="i-msg" />
          <b>Чат Millida</b>
          {unread ? <span className="fr-unread">{unread > 9 ? '9+' : unread}</span> : null}
        </div>
        <label className="ovc-search">
          <Icon id="i-search" />
          <input
            value={filter}
            placeholder="Поиск по имени"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <div className="ovc-list">
          {items.map((i) => (
            <button
              key={i.key}
              className={'ovc-row' + (i.key === openKey ? ' on' : '') + (i.unread ? ' unread' : '')}
              onClick={() => void open(asTarget(i))}
            >
              <span className={'ovc-ava' + (i.room ? ' room' : '')}>
                {(i.nicks.length ? i.nicks : ['']).slice(0, i.room ? 3 : 1).map((n, k) => (
                  <Head key={n + k} nick={n} size={i.room ? 22 : 34} />
                ))}
                {!i.room && i.online ? <i className={'ovc-dot' + (i.playing ? ' play' : '')} /> : null}
              </span>
              <span className="ovc-row-body">
                <span className="ovc-row-top">
                  <b>{i.title}</b>
                  {i.ts ? <time>{chatWhen(i.ts)}</time> : null}
                </span>
                <span className="ovc-row-sub">{i.subtitle}</span>
              </span>
              {i.unread ? <span className="fr-unread">{i.unread > 9 ? '9+' : i.unread}</span> : null}
            </button>
          ))}
          {!items.length ? (
            <p className="ovc-note">
              {filter.trim() ? 'Никого по «' + filter.trim() + '»' : 'Друзей пока нет — добавь их в лаунчере.'}
            </p>
          ) : null}
        </div>
        <button className="ovc-rail-foot" onClick={() => onLauncher(null)}>
          <Icon id="i-users" />
          Все друзья и группы
        </button>
      </aside>

      <section className="ovc-pane">
        <div className="ovc-head">
          {openId ? (
            <>
              <span className={'ovc-ava' + (current?.room ? ' room' : '')}>
                {(current?.nicks.length ? current.nicks : [chatNick]).slice(0, current?.room ? 3 : 1).map((n, k) => (
                  <Head key={n + k} nick={n} size={current?.room ? 20 : 32} />
                ))}
              </span>
              <span className="ovc-head-body">
                <b>{chatNick}</b>
                <span>{current?.subtitle || ''}</span>
              </span>
            </>
          ) : (
            <span className="ovc-head-body">
              <b>Переписки</b>
              <span>Игра остаётся запущенной</span>
            </span>
          )}
          <span className="ovc-hint">{hotkey ? hotkey + ' или Esc — закрыть' : 'Esc — закрыть'}</span>
          <button
            className="ovc-act"
            title="Открыть в лаунчере"
            onClick={() => onLauncher(current ? asTarget(current) : null)}
          >
            <Icon id="i-ext" />
          </button>
          <button className="ovc-act" title="Закрыть" onClick={onClose}>
            <Icon id="i-x" />
          </button>
        </div>

        <div
          className="ovc-thread"
          ref={boxRef}
          onScroll={(e) => {
            const b = e.currentTarget
            stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < STICK_PX
          }}
        >
          {!openId ? (
            <div className="ovc-blank">
              <Icon id="i-msg" />
              <b>Выбери переписку слева</b>
              <p>Ответ уйдёт прямо отсюда — сворачивать игру не нужно.</p>
            </div>
          ) : loading && !msgs.length ? (
            <Skeleton />
          ) : (
            <>
              {hasMore ? (
                <button className="ovc-older" disabled={olderBusy} onClick={() => void older()}>
                  {olderBusy ? 'Грузим…' : 'Показать раньше'}
                </button>
              ) : null}
              {msgs.map(bubble)}
              {!msgs.length ? (
                <div className="ovc-blank">
                  <Icon id="i-msg" />
                  <b>Здесь пока пусто</b>
                  <p>Напиши первым — сообщение придёт человеку в лаунчер и в игру.</p>
                </div>
              ) : null}
            </>
          )}
        </div>

        {error ? (
          <div className="ovc-error">
            <Icon id="i-alert" />
            {error}
          </div>
        ) : null}

        <div className="ovc-composer">
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            disabled={!openId || sending}
            placeholder={
              !openId ? 'Выбери, кому написать' : chatRoom ? 'Сообщение в ' + chatNick + '…' : 'Написать ' + chatNick + '…'
            }
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            className="chat-send"
            title="Отправить"
            disabled={!openId || sending || !text.trim()}
            onClick={() => void send()}
          >
            <Icon id="i-send" />
          </button>
        </div>
      </section>
    </div>
  )
}
