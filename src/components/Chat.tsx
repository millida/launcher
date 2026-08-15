import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { addServer } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { joinWithAuth, showLaunchError } from '../lib/launch'
import { openSettings, setScreen, showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { encodeInvite, isServerAddr, parseInvite } from '../lib/invite'
import { Head } from './Head'
import { fmtPlaytime, onAvatarError, whenText } from '../lib/format'
import { refreshPlayStats, rememberServerName, usePlayStats } from '../state/playStats'
import { quickJoin } from '../lib/joinServer'
import {
  deleteChatMessage,
  dropFailedChat,
  editChatMessage,
  loadOlderChat,
  pingTyping,
  replyPreviewOf,
  retryChat,
  sendChat,
  toggleChatReaction,
  useFriends,
} from '../state/friends'
import type { ChatAttachment, ChatMessage, FriendProfile } from '../state/friends'
import { copyText } from '../lib/clipboard'
import { VoiceMessage } from './VoiceMessage'
import { openImage } from './ImageLightbox'
import { MAX_CHAT_IMAGE_BYTES, uploadChatImage, uploadVoice } from '../lib/chatMedia'
import { VOICE_MAX_MS, canRecordVoice, fmtVoiceTime, recordVoice } from '../lib/voice'
import type { VoiceRecorder } from '../lib/voice'
import { dayKey, dayLabel, isGrouped, isRead } from '../lib/chatGroup'
import { keepsChatOpen } from '../lib/chatOutside'
import { micErrorText } from '../lib/audioDevices'
import { callLogTitle, parseCallLog, type CallLog } from '../lib/call/callLog'
import { callFriend, callSupported, fmtCallTime, useCall } from '../state/call'
import { nickInRooms, openRoomManage, useRooms, type Room } from '../state/rooms'
import { RoomCallButton } from './RoomCall'

function InviteCard({ addr, name, me }: { addr: string; name: string; me?: boolean }) {
  const [busy, setBusy] = useState(false)
  const join = () => {
    if (!hasTauri()) {
      showToast('Вход на сервер — в приложении', 'error')
      return
    }
    const { selected, profiles } = useProfiles.getState()
    const prof = selected || (profiles[0] || { name: '' }).name || ''
    if (!prof) {
      showToast('Сначала создай сборку — версию подберём под сервер', 'error')
      setScreen('mods')
      return
    }
    setBusy(true)
    addServer(prof, name, addr).catch(() => {})
    rememberServerName(addr, name)
    joinWithAuth(prof, null, addr, name)
      .then(() => showToast('Заходим на «' + name + '»'))
      .catch((e) => showLaunchError(e))
      .finally(() => setBusy(false))
  }
  return (
    <div className={'msg-invite' + (me ? ' me' : '')}>
      <span className="msg-invite-ic">
        <Icon id="i-server" />
      </span>
      <span className="msg-invite-body">
        <b>Приглашение на сервер</b>
        <span className="msg-invite-name">{name}</span>
        <span className="msg-invite-addr">{addr}</span>
      </span>
      <button className="btn sm primary" disabled={busy} onClick={join}>
        <Icon id="i-login" />
        {busy ? 'Заходим…' : 'Присоединиться'}
      </button>
    </div>
  )
}

/// Итог звонка в ленте: нажатие перезванивает — это самое частое следующее
/// действие после пропущенного.
function CallLogCard({ log, me, uid, nick }: { log: CallLog; me?: boolean; uid: string; nick: string }) {
  const busy = useCall((s) => s.status) !== 'idle'
  const missed = log.outcome !== 'done'
  return (
    <button
      className={'msg-call' + (me ? ' me' : '') + (missed ? ' missed' : '')}
      disabled={busy || !callSupported()}
      title={busy ? 'Идёт другой звонок' : 'Позвонить'}
      onClick={() => void callFriend(uid, nick)}
    >
      <Icon id={missed ? 'i-phone-off' : 'i-phone'} />
      <span className="msg-call-body">
        <b>{callLogTitle(log, !!me)}</b>
        <span>{log.outcome === 'done' ? fmtCallTime(log.seconds * 1000) : 'Нажми, чтобы перезвонить'}</span>
      </span>
    </button>
  )
}

function FriendStats({ p }: { p: FriendProfile }) {
  const s = p.stats
  const joinable = p.playing && p.serverIp
  const lastServer = s?.lastServerName || s?.lastServer || ''
  const rows: Array<[string, string]> = []
  if (s?.totalSeconds) rows.push(['Всего в игре', fmtPlaytime(s.totalSeconds)])
  if (s?.sessions) rows.push(['Запусков', String(s.sessions)])
  if (s?.lastBuild) rows.push(['Последняя сборка', s.lastBuild])
  if (lastServer)
    rows.push([
      'Последний сервер',
      lastServer + (s?.lastPlayedAt ? ' · ' + whenText(Math.round(s.lastPlayedAt / 1000)) : ''),
    ])
  if (!rows.length && !joinable) {
    return <p className="faint-note fr-stat-empty">Статистика появится, когда друг поиграет через лаунчер.</p>
  }
  return (
    <div className="fr-stat">
      {joinable ? (
        <button
          className="btn sm primary fr-stat-join"
          onClick={() => {
            const name = p.serverName || 'Сервер ' + p.nick
            rememberServerName(p.serverIp!, name)
            void quickJoin(p.serverIp!, name).catch(() => {})
          }}
        >
          <Icon id="i-login" />
          Зайти к нему
        </button>
      ) : null}
      {rows.map(([k, v]) => (
        <div className="fr-stat-row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  )
}

const EMOJIS = [
  '😀', '😂', '😊', '😍', '😎', '😉', '🙂', '😅',
  '😭', '😡', '🤔', '😴', '🥳', '😱', '🤩', '😇',
  '👍', '👎', '👌', '🤝', '🙏', '👋', '💪', '🔥',
  '❤️', '💚', '💀', '🎮', '⚔️', '🛡️', '⛏️', '💎',
  '🧱', '🌲', '🐷', '🐔', '🎉', '⭐', '✅', '❌',
]

const RECENT_EMOJI_KEY = 'm-chat-emoji'

const REC_BARS = 28

function recentEmojis(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

function rememberEmoji(em: string) {
  const next = [em, ...recentEmojis().filter((x) => x !== em)].slice(0, 8)
  localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next))
}

const timeHM = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''

function MessageBody({ m, onJump }: { m: ChatMessage; onJump: (id: string) => void }) {
  const att = m.attachment
  if (m.deleted) return <span className="msg-gone">Сообщение удалено</span>
  const quotedFrom = m.replyTo?.me
    ? 'Ты'
    : nickInRooms(m.replyTo?.from || '') || 'Собеседник'
  return (
    <>
      {m.replyTo ? (
        <button
          className="msg-reply"
          onClick={(e) => {
            e.stopPropagation()
            onJump(m.replyTo!.id)
          }}
        >
          <b>{quotedFrom}</b>
          <span>{replyLabel(m.replyTo)}</span>
        </button>
      ) : null}
      {att && att.kind === 'voice' ? <VoiceMessage att={att} me={m.me} /> : null}
      {att && att.kind === 'image' ? (
        <img className="msg-img" src={att.url} alt="" loading="lazy" onClick={() => openImage(att.url)} />
      ) : null}
      {m.text ? <span className="msg-text">{m.text}</span> : null}
    </>
  )
}

/**
 * Галочки статуса рисуются здесь, а не берутся из общего спрайта: там размер
 * задаёт `svg.icon`, и селектор с типом бьёт по специфичности любой класс —
 * галки молча вписывались в квадрат 16×16 с полями. Свои размеры и viewBox
 * стоят атрибутами, поэтому фигура не зависит ни от каскада, ни от темы.
 */
function Ticks({ state, read }: { state?: 'sending' | 'failed'; read: boolean }) {
  const sending = state === 'sending'
  return (
    <svg
      className={'msg-tick' + (sending ? ' pending' : read ? ' read' : '')}
      width={sending ? 13 : 17}
      height={14}
      viewBox={sending ? '0 0 20 22' : '0 0 26 22'}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{sending ? 'Отправляется' : read ? 'Прочитано' : 'Доставлено'}</title>
      <path d={sending ? 'M3 12 8 17 18 6' : 'M2 12 7 17 17 6'} />
      {sending ? null : <path d="M11.8 17 21.8 6" />}
    </svg>
  )
}

interface MenuAt {
  m: ChatMessage
  x: number
  y: number
}

const MENU_W = 210
const MENU_H = 250

function MessageMenu({ at, close }: { at: MenuAt; close: () => void }) {
  const m = at.m
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  const react = (emoji: string) => {
    close()
    toggleChatReaction(m.id || '', emoji).catch(() => showToast('Реакция не поставилась', 'error'))
  }
  return (
    <div
      className="msg-menu"
      style={{
        left: Math.max(8, Math.min(at.x, window.innerWidth - MENU_W - 8)) + 'px',
        top: Math.max(8, Math.min(at.y, window.innerHeight - MENU_H)) + 'px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="msg-menu-react">
        {REACTIONS.map((em) => (
          <button
            key={em}
            className={'msg-menu-emoji' + (m.reactions?.some((r) => r.emoji === em && r.mine) ? ' on' : '')}
            onClick={() => react(em)}
          >
            {em}
          </button>
        ))}
      </div>
      <button className="msg-menu-item" onClick={run(() => useFriends.getState().set({ chatReplyTo: m, chatEditing: null }))}>
        <Icon id="i-reply" /> Ответить
      </button>
      {m.text ? (
        <button
          className="msg-menu-item"
          onClick={run(() => {
            void copyText(m.text).then((ok) =>
              ok ? showToast('Скопировано') : showToast('Не удалось скопировать', 'error'),
            )
          })}
        >
          <Icon id="i-copy" /> Копировать текст
        </button>
      ) : null}
      {m.me && m.text ? (
        <button
          className="msg-menu-item"
          onClick={run(() => useFriends.getState().set({ chatEditing: m, chatReplyTo: null }))}
        >
          <Icon id="i-edit" /> Изменить
        </button>
      ) : null}
      {m.me ? (
        <button
          className="msg-menu-item danger"
          onClick={run(() => {
            void uiConfirm('Сообщение исчезнет и у собеседника.', {
              title: 'Удалить сообщение?',
              confirmLabel: 'Удалить',
              danger: true,
            }).then((ok) => {
              if (ok) deleteChatMessage(m.id || '').catch(() => showToast('Не удалось удалить', 'error'))
            })
          })}
        >
          <Icon id="i-trash" /> Удалить
        </button>
      ) : null}
    </div>
  )
}

const INVITE_SERVERS = 6

/// Набор реакций закреплён и на сервере: там он же проверяет пришедший эмодзи.
const REACTIONS = ['👍', '👎', '❤️', '🔥', '😂', '😮', '😢', '🎉']

function replyLabel(m: { text: string; deleted?: boolean; kind?: string | null }): string {
  if (m.deleted) return 'Сообщение удалено'
  if (m.text) return m.text
  if (m.kind === 'voice') return 'Голосовое сообщение'
  if (m.kind === 'image') return 'Картинка'
  return 'Вложение'
}

function Composer() {
  const [text, setText] = useState('')
  const replyTo = useFriends((s) => s.chatReplyTo)
  const editing = useFriends((s) => s.chatEditing)
  const setChat = useFriends((s) => s.set)
  const inputRef = useRef<HTMLInputElement>(null)

  // Правка начинается из меню сообщения, а не из поля: текст переносится сюда,
  // чтобы человек видел его там же, где обычно печатает.
  useEffect(() => {
    if (!editing) return
    setText(editing.text)
    inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (replyTo) inputRef.current?.focus()
  }, [replyTo])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [srvOpen, setSrvOpen] = useState(false)
  const [srvAddr, setSrvAddr] = useState('')
  const playServers = usePlayStats((s) => s.stats.servers)
  const recentServers = [...playServers].sort((a, b) => b.last - a.last).slice(0, INVITE_SERVERS)
  const [busy, setBusy] = useState(false)
  const [rec, setRec] = useState<VoiceRecorder | null>(null)
  const [recMs, setRecMs] = useState(0)
  const [bars, setBars] = useState<number[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<VoiceRecorder | null>(null)
  recRef.current = rec

  useEffect(
    () => () => {
      if (recRef.current) recRef.current.cancel()
    },
    [],
  )

  const imageRef = useRef<(file: File) => void>(() => {})

  // Ctrl+V works anywhere over the open panel, not only inside the field: the
  // usual move is to screenshot, click the chat and paste.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!useFriends.getState().chatOpen || !e.clipboardData) return
      const item = Array.from(e.clipboardData.items).find((x) => x.type.startsWith('image/'))
      const file = item && item.getAsFile()
      if (!file) return
      e.preventDefault()
      imageRef.current(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const send = async (attachment?: ChatAttachment) => {
    const body = text.trim()
    if (!body && !attachment) return
    // Вложение всегда уходит новым сообщением: правка меняет только текст.
    if (editing && !attachment) {
      const id = editing.id || ''
      setText('')
      setChat({ chatEditing: null })
      try {
        await editChatMessage(id, body)
      } catch {
        showToast('Не удалось изменить сообщение', 'error')
      }
      return
    }
    setText('')
    const quoted = replyTo
    setChat({ chatReplyTo: null })
    try {
      await sendChat(body, attachment, quoted ? replyPreviewOf(quoted) : null)
    } catch {
      showToast('Сообщение не ушло — нажми «Повторить» под ним', 'error')
    }
  }

  const sendInvite = (addr: string, name: string) => {
    if (!isServerAddr(addr)) {
      showToast('Не похоже на адрес сервера', 'error')
      return
    }
    setSrvOpen(false)
    setSrvAddr('')
    sendChat(encodeInvite(addr.trim(), (name || addr).trim().slice(0, 48))).catch(() =>
      showToast('Приглашение не ушло — нажми «Повторить» под ним', 'error'),
    )
  }

  const attachImage = async (file: File) => {
    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      showToast('Картинка больше 8 МБ', 'error')
      return
    }
    setBusy(true)
    try {
      await send(await uploadChatImage(file))
    } catch (e) {
      showToast('Картинка не загрузилась: ' + String((e as Error).message || e), 'error')
    } finally {
      setBusy(false)
    }
  }

  imageRef.current = (file: File) => void attachImage(file)

  const stopRecording = async (keep: boolean) => {
    const r = recRef.current
    if (!r) return
    setRec(null)
    if (!keep) {
      r.cancel()
      return
    }
    setBusy(true)
    try {
      const take = await r.stop()
      if (take.durationMs < 700) {
        showToast('Слишком коротко — держи запись дольше')
        return
      }
      await send(await uploadVoice(take))
    } catch (e) {
      showToast('Голосовое не отправилось: ' + String((e as Error).message || e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const startRecording = async () => {
    if (!canRecordVoice()) {
      showToast('Микрофон недоступен — открой настройки звука и проверь его', 'error', undefined, {
        label: 'Настроить',
        run: () => openSettings('sound', 'mic'),
      })
      return
    }
    setRecMs(0)
    setBars([])
    try {
      setRec(
        await recordVoice(
          (lvl, ms) => {
            // Speech peaks sit low on a linear scale; the root spreads a quiet
            // voice across the strip instead of leaving it a flat line.
            setBars((prev) => prev.concat([Math.min(1, Math.sqrt(lvl) * 1.35)]).slice(-REC_BARS))
            setRecMs(ms)
          },
          () => void stopRecording(true),
        ),
      )
    } catch (error) {
      showToast(micErrorText(error), 'error', undefined, {
        label: 'Как исправить',
        run: () => openSettings('sound', 'mic'),
      })
    }
  }

  if (rec) {
    const left = Math.max(0, VOICE_MAX_MS - recMs)
    return (
      <div className="chat-input chat-rec">
        <button className="chat-rec-x" title="Отменить" onClick={() => void stopRecording(false)}>
          <Icon id="i-trash" />
        </button>
        <span className="chat-rec-dot" />
        <span className="chat-rec-time">{fmtVoiceTime(recMs)}</span>
        <div className="chat-rec-wave" title={left < 10_000 ? 'Осталось ' + fmtVoiceTime(left) : 'Идёт запись'}>
          {Array.from({ length: REC_BARS }, (_, i) => {
            // Right-aligned: the newest sample is next to the send button, so
            // the strip runs towards it like a tape.
            const lvl = bars[i - (REC_BARS - bars.length)] ?? 0
            return <i key={i} style={{ height: Math.round(3 + lvl * 19) + 'px' }} />
          })}
        </div>
        {left < 10_000 ? <span className="chat-rec-left">{fmtVoiceTime(left)}</span> : null}
        <button className="chat-send" title="Отправить" onClick={() => void stopRecording(true)}>
          <Icon id="i-send" />
        </button>
      </div>
    )
  }

  const recent = recentEmojis()

  const quoted = editing || replyTo
  const bar = quoted ? (
    <div className="chat-quote">
      <Icon id={editing ? 'i-edit' : 'i-reply'} />
      <span className="chat-quote-body">
        <b>{editing ? 'Изменение сообщения' : 'Ответ ' + (replyTo?.me ? 'на своё сообщение' : '')}</b>
        <span>{replyLabel({ text: quoted.text, deleted: quoted.deleted, kind: quoted.attachment?.kind })}</span>
      </span>
      <button
        className="chat-quote-x"
        title="Отменить"
        onClick={() => {
          setChat({ chatReplyTo: null, chatEditing: null })
          if (editing) setText('')
        }}
      >
        <Icon id="i-x" />
      </button>
    </div>
  ) : null

  return (
    <>
    {bar}
    <div className="chat-input">
      {srvOpen ? (
        <div className="chat-srv-pop" onClick={(e) => e.stopPropagation()}>
          <div className="side-cap">Пригласить на сервер</div>
          {recentServers.length ? (
            recentServers.map((s) => (
              <button key={s.key} className="chat-srv-row" onClick={() => sendInvite(s.key, s.label || s.key)}>
                <Icon id="i-server" />
                <span className="chat-srv-name">{s.label || s.key}</span>
                <span className="chat-srv-addr">{s.key}</span>
              </button>
            ))
          ) : (
            <p className="faint-note">Ты ещё никуда не заходил — впиши адрес вручную</p>
          )}
          <div className="chat-srv-manual">
            <div className="input sm">
              <input
                placeholder="play.example.net"
                value={srvAddr}
                onChange={(e) => setSrvAddr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendInvite(srvAddr.trim(), srvAddr.trim())
                }}
              />
            </div>
            <button
              className="btn sm"
              disabled={!isServerAddr(srvAddr)}
              onClick={() => sendInvite(srvAddr.trim(), srvAddr.trim())}
            >
              Отправить
            </button>
          </div>
        </div>
      ) : null}
      {emojiOpen ? (
        <div className="chat-emoji-pop" onClick={(e) => e.stopPropagation()}>
          {[...recent, ...EMOJIS.filter((e) => !recent.includes(e))].map((em) => (
            <button
              key={em}
              className="chat-emoji"
              onClick={() => {
                rememberEmoji(em)
                setText((t) => t + em)
                setEmojiOpen(false)
              }}
            >
              {em}
            </button>
          ))}
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0]
          e.target.value = ''
          if (f) void attachImage(f)
        }}
      />
      <button
        className="chat-emoji-btn"
        title="Эмодзи"
        onClick={(e) => {
          e.stopPropagation()
          setEmojiOpen((v) => !v)
          setSrvOpen(false)
        }}
      >
        <Icon id="i-smile" />
      </button>
      <button className="chat-emoji-btn" title="Картинка" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Icon id="i-image" />
      </button>
      <button
        className="chat-emoji-btn"
        title="Пригласить на сервер"
        onClick={(e) => {
          e.stopPropagation()
          setSrvOpen((v) => {
            if (!v) void refreshPlayStats()
            return !v
          })
          setEmojiOpen(false)
        }}
      >
        <Icon id="i-server" />
      </button>
      <div className="input sm">
        <input
          id="chatMsg"
          ref={inputRef}
          placeholder={busy ? 'Загружаем…' : editing ? 'Новый текст…' : 'Сообщение…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value && !editing) pingTyping()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void send()
            if (e.key === 'Escape' && quoted) {
              setChat({ chatReplyTo: null, chatEditing: null })
              if (editing) setText('')
            }
          }}
        />
      </div>
      {text.trim() || editing ? (
        <button
          className="chat-send"
          title={editing ? 'Сохранить' : 'Отправить'}
          disabled={busy || (!!editing && !text.trim())}
          onClick={() => void send()}
        >
          <Icon id={editing ? 'i-check' : 'i-send'} />
        </button>
      ) : (
        <button className="chat-send" title="Записать голосовое" disabled={busy} onClick={() => void startRecording()}>
          <Icon id="i-mic" />
        </button>
      )}
    </div>
    </>
  )
}

function CallButton({ uid, nick }: { uid: string; nick: string }) {
  const status = useCall((s) => s.status)
  if (!uid || !callSupported()) return null
  return (
    <button
      className="tb-btn call-start"
      title={status === 'idle' ? 'Позвонить' : 'Уже идёт звонок'}
      disabled={status !== 'idle'}
      onClick={() => void callFriend(uid, nick)}
    >
      <Icon id="i-phone" />
    </button>
  )
}

/**
 * Шапка группы. Голос здесь не «позвонить», а «зайти»: разговор в комнате идёт
 * сам по себе, и кнопка показывает, сколько человек уже внутри.
 */
function RoomHead({ room }: { room: Room }) {
  const mode = useCall((s) => s.mode)
  const roomId = useCall((s) => s.roomId)
  const status = useCall((s) => s.status)
  const inside = room.voice || []
  const here = mode === 'room' && roomId === room.id && status !== 'idle'
  return (
    <>
      <span className="room-ava">
        <Icon id="i-users" />
      </span>
      <span className="chat-head-body">
        <b>{room.title}</b>
        <span className="chat-head-sub">
          {room.members.length} чел.
          {inside.length ? ' · в разговоре ' + inside.length : ''}
        </span>
      </span>
      {callSupported() ? <RoomCallButton room={room} here={here} busy={status !== 'idle'} /> : null}
      <button className="tb-btn" title="Участники группы" onClick={() => openRoomManage(room.id)}>
        <Icon id="i-dots" />
      </button>
    </>
  )
}

const FLASH_MS = 1400
const JUMP_PAGES = 20
const JUMP_FRAMES = 12

const CHAT_WIDTH_KEY = 'm-chat-width'
const CHAT_WIDTH_DEFAULT = 330
const CHAT_WIDTH_MIN = 300

/// The panel is docked to the right edge of the window, so the ceiling has to
/// come from the live window and not a constant: on a small screen a stored
/// width from a big one would swallow the whole app.
function clampChatWidth(w: number): number {
  const max = Math.max(CHAT_WIDTH_MIN, Math.min(900, window.innerWidth - 220))
  return Math.round(Math.min(max, Math.max(CHAT_WIDTH_MIN, w)))
}

function storedChatWidth(): number {
  const raw = Number(localStorage.getItem(CHAT_WIDTH_KEY))
  return clampChatWidth(raw > 0 ? raw : CHAT_WIDTH_DEFAULT)
}

export function Chat() {
  const {
    chatOpen,
    chatNick,
    chatWith,
    chatRoom,
    chatHeader,
    chatMsgs,
    chatEmpty,
    chatSeq,
    chatHasMore,
    chatOlderBusy,
    chatPeerReadAt,
    chatTyping,
    chatTypers,
    set,
  } = useFriends()
  const room = useRooms((s) => s.rooms.find((r) => r.id === chatRoom))
  const bodyRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(storedChatWidth)
  const grip = useRef<{ x: number; w: number } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  atBottomRef.current = atBottom
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const [flashId, setFlashId] = useState('')
  const flashTimer = useRef(0)

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  /// Цитата ведёт к оригиналу, но тот может лежать выше загруженной страницы —
  /// подтягиваем историю, пока он не появится, иначе переход молча не сработал бы
  /// именно на старой переписке, где он и нужен.
  const jumpToMessage = useCallback((id: string) => {
    const focus = () => {
      const body = bodyRef.current
      const el = body && body.querySelector('[data-mid="' + CSS.escape(id) + '"]')
      if (!el) return false
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      window.clearTimeout(flashTimer.current)
      // Повторный переход к тому же сообщению обязан мигнуть снова: класс уже
      // висит, и без кадра без него анимация не перезапускается — выглядело так,
      // будто вторым нажатием ничего не происходит.
      setFlashId('')
      requestAnimationFrame(() => {
        setFlashId(id)
        flashTimer.current = window.setTimeout(() => setFlashId(''), FLASH_MS)
      })
      return true
    }
    if (focus()) return
    // Пока идёт догрузка, лента не должна прыгать вниз за новыми сообщениями —
    // человек уже уходит вверх, к оригиналу.
    setAtBottom(false)
    void (async () => {
      for (let i = 0; i < JUMP_PAGES; i++) {
        const s = useFriends.getState()
        if (s.chatMsgs.some((m) => m.id === id) || !s.chatHasMore) break
        if (!(await loadOlderChat())) break
      }
      // Рендер прилетевшей страницы идёт своим кадром: ищем узел, пока он не
      // появится, а не один раз сразу после ответа сервера.
      for (let i = 0; i < JUMP_FRAMES; i++) {
        await new Promise((r) => requestAnimationFrame(r))
        if (focus()) return
      }
      showToast('Не нашли это сообщение — возможно, оно удалено', 'error')
    })()
  }, [])

  // Меню приколочено к точке экрана: прокрутка переписки увела бы его от своего
  // сообщения, поэтому закрывается вместе с любым движением ленты.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onDown = (e: MouseEvent) => {
      // Пункт меню исчезает вместе с меню, поэтому проверяем попадание на
      // нажатии — иначе закрытие съедало бы собственный клик.
      if (e.target instanceof Element && e.target.closest('.msg-menu')) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  useEffect(() => {
    if (!chatOpen) setMenu(null)
  }, [chatOpen, chatWith, chatRoom])

  const scrollDown = useCallback(() => {
    const b = bodyRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [])

  useEffect(() => {
    // A new message must not yank the view away from the history being read.
    if (atBottomRef.current) scrollDown()
  }, [chatSeq, chatMsgs.length, scrollDown])

  useEffect(() => {
    if (!chatOpen) return
    setAtBottom(true)
    scrollDown()
  }, [chatOpen, chatWith, chatRoom, scrollDown])

  useEffect(() => {
    const onResize = () => setWidth((w) => clampChatWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!chatOpen) return
    const onDoc = (e: MouseEvent) => {
      // composedPath is captured when the event is dispatched. `closest` on the
      // target is not: a button whose handler re-renders it away (stop the
      // recording, drop a failed message) is already detached by the time this
      // listener runs, reads as "outside" and closed the whole panel.
      if (keepsChatOpen(e.composedPath())) return
      set({ chatOpen: false })
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [chatOpen, set])

  const onScroll = () => {
    const b = bodyRef.current
    if (!b) return
    if (menu) setMenu(null)
    setAtBottom(b.scrollHeight - b.scrollTop - b.clientHeight < 40)
    if (b.scrollTop >= 60 || !chatHasMore || chatOlderBusy) return
    const before = b.scrollHeight
    void loadOlderChat().then((n) => {
      if (!n) return
      // Prepending shifts everything down; add exactly the grown height back so
      // the message under the cursor stays under it.
      requestAnimationFrame(() => {
        if (bodyRef.current) bodyRef.current.scrollTop += bodyRef.current.scrollHeight - before
      })
    })
  }

  return (
    <div className={'chat' + (chatOpen ? ' open' : '')} id="chat" style={{ width: width + 'px' }}>
      <div
        className="chat-grip"
        title="Потяни, чтобы изменить ширину"
        onPointerDown={(e) => {
          grip.current = { x: e.clientX, w: width }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const g = grip.current
          if (!g) return
          setWidth(clampChatWidth(g.w + (g.x - e.clientX)))
        }}
        onPointerUp={(e) => {
          if (grip.current) localStorage.setItem(CHAT_WIDTH_KEY, String(width))
          grip.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onDoubleClick={() => {
          setWidth(CHAT_WIDTH_DEFAULT)
          localStorage.setItem(CHAT_WIDTH_KEY, String(CHAT_WIDTH_DEFAULT))
        }}
      />
      <div className={'chat-head' + (room ? ' room' : '')}>
        {room ? (
          <RoomHead room={room} />
        ) : (
          <>
            <Head id="chatAva" nick={chatNick || 'MHF_Steve'} size={32} />
            <b id="chatNick">{chatNick || '—'}</b>
            <CallButton uid={chatWith} nick={chatNick} />
          </>
        )}
        <button className="tb-btn" id="chatClose" onClick={() => set({ chatOpen: false })}>
          <Icon id="i-x" />
        </button>
      </div>
      <div className="chat-body" id="chatBody" ref={bodyRef} onScroll={onScroll}>
        {chatOlderBusy ? <div className="chat-day">Грузим переписку…</div> : null}
        {chatHeader ? (
          <>
            <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
              <img
                src={'https://api.millida.net/v2/heads/body/' + encodeURIComponent(chatHeader.nick || 'Steve') + '?size=128'}
                style={{ height: '128px', imageRendering: 'pixelated' }}
                onError={(e) => onAvatarError(e, 128, chatHeader.nick)}
              />
              <div style={{ fontWeight: 700, fontSize: '16px', marginTop: '8px' }}>{chatHeader.nick}</div>
              <div style={{ fontSize: '12.5px', color: 'var(--m-fg-subtle)' }}>{chatHeader.text}</div>
            </div>
            <FriendStats p={chatHeader} />
            <div className="side-cap" style={{ padding: '8px 2px 2px' }}>
              Личные сообщения
            </div>
          </>
        ) : null}
        {chatMsgs.map((m, i) => {
          const inv = m.text ? parseInvite(m.text) : null
          const callLog = m.text ? parseCallLog(m.text) : null
          const key = m.id || m.localId || 'i' + i
          const newDay = dayKey(m.ts) !== dayKey(chatMsgs[i - 1]?.ts)
          const day = newDay && m.ts ? <div className="chat-day">{dayLabel(m.ts)}</div> : null
          if (inv)
            return (
              <Fragment key={key}>
                {day}
                <InviteCard addr={inv.addr} name={inv.name} me={m.me} />
              </Fragment>
            )
          if (callLog && !chatRoom)
            return (
              <Fragment key={key}>
                {day}
                <CallLogCard log={callLog} me={m.me} uid={chatWith} nick={chatNick} />
              </Fragment>
            )
          const read = isRead(m, chatPeerReadAt)
          const actionable = !!m.id && !m.state && !m.deleted
          const openMenu = (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
            if (!actionable) return
            e.preventDefault()
            setMenu({ m, x: e.clientX, y: e.clientY })
          }
          // Двойное нажатие по пузырю отвечает на него. Свои элементы внутри
          // (цитата, картинка, кнопки) имеют собственное действие и остаются за
          // пределами жеста.
          const replyOnDouble = (e: { target: EventTarget | null }) => {
            if (!actionable) return
            if (e.target instanceof Element && e.target.closest('button, a, .msg-img, .voice-wave')) return
            window.getSelection()?.removeAllRanges()
            useFriends.getState().set({ chatReplyTo: m, chatEditing: null })
          }
          // Подпись автора в группе ставится только у первого сообщения подряд:
          // повторять ник над каждым пузырём одного человека — шум.
          const author =
            chatRoom && !m.me && (!isGrouped(chatMsgs, i) || newDay) ? (
              <span className="msg-author">
                <Head nick={m.fromNick} size={18} />
                {m.fromNick || 'Игрок'}
              </span>
            ) : null
          return (
            <Fragment key={key}>
              {day}
              <div
                className={'msg-row' + (m.me ? ' me' : '')}
                data-mid={m.id || undefined}
                onContextMenu={openMenu}
                onDoubleClick={replyOnDouble}
              >
              {author}
              <div className="msg-line">
              <div
                className={
                  'msg' +
                  (m.me ? ' me' : '') +
                  (!newDay && isGrouped(chatMsgs, i) ? ' grouped' : '') +
                  (m.state === 'sending' ? ' sending' : '') +
                  (m.state === 'failed' ? ' failed' : '') +
                  (m.deleted ? ' gone' : '') +
                  (m.attachment && !m.text ? ' bare' : '') +
                  (m.id && m.id === flashId ? ' flash' : '')
                }
              >
                <MessageBody m={m} onJump={jumpToMessage} />
                <span className="msg-meta">
                  {m.editedAt ? <span title="Отредактировано">изм.</span> : null}
                  <span>{timeHM(m.ts)}</span>
                  {/* Одна серая — ещё летит, две серые — сервер принял, две
                      синие — собеседник прочитал. */}
                  {m.me && m.state !== 'failed' ? <Ticks state={m.state} read={read} /> : null}
                </span>
              </div>
              {actionable ? (
                <button
                  className="msg-act"
                  title="Действия с сообщением"
                  onClick={(e) => {
                    e.stopPropagation()
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ m, x: r.left - MENU_W, y: r.top })
                  }}
                >
                  <Icon id="i-dots" />
                </button>
              ) : null}
              </div>
              {m.reactions?.length ? (
                <div className="msg-reactions">
                  {m.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      className={'msg-reaction' + (r.mine ? ' on' : '')}
                      onClick={() =>
                        toggleChatReaction(m.id || '', r.emoji).catch(() =>
                          showToast('Реакция не поставилась', 'error'),
                        )
                      }
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                </div>
              ) : null}
              {m.state === 'failed' ? (
                <div className="msg-fail">
                  <span>Не отправлено</span>
                  <button onClick={() => void retryChat(m.localId || '')}>Повторить</button>
                  <button onClick={() => dropFailedChat(m.localId || '')}>Удалить</button>
                </div>
              ) : null}
              </div>
            </Fragment>
          )
        })}
        {chatRoom ? (
          chatTypers.length ? (
            <div className="chat-typing">
              {chatTypers.slice(0, 2).join(', ')}
              {chatTypers.length > 2 ? ' и ещё ' + (chatTypers.length - 2) : ''} печата
              {chatTypers.length > 1 ? 'ют' : 'ет'}…
            </div>
          ) : null
        ) : chatTyping ? (
          <div className="chat-typing">{chatNick} печатает…</div>
        ) : null}
        {!chatHeader && chatEmpty && !chatMsgs.length ? (
          <p className="faint-note">{chatRoom ? 'Пока тихо — начни разговор' : 'Напиши первым'}</p>
        ) : null}
      </div>
      {!atBottom ? (
        <button className="chat-down" title="К последним" onClick={scrollDown}>
          <Icon id="i-arrow-dn" />
        </button>
      ) : null}
      {menu ? <MessageMenu at={menu} close={() => setMenu(null)} /> : null}
      <Composer />
    </div>
  )
}
