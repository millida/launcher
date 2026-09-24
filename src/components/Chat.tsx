import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { useProfiles } from '../state/profiles'
import { openSettings, showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { encodeInvite, isServerAddr, parseInvite } from '../lib/invite'
import { Head } from './Head'
import { ELT_IDS, EltText, eltAlias, eltCode, eltUrl, loadEltAliases } from '../lib/eltaller'
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
import { offPlatformReason } from '../lib/offPlatform'
import { copyText } from '../lib/clipboard'
import { VoiceMessage } from './VoiceMessage'
import { copyPictureTo, openImage, savePictureTo } from './ImageLightbox'
import { MAX_CHAT_IMAGE_BYTES, uploadChatImage, uploadVoice } from '../lib/chatMedia'
import { isOwnMediaUrl } from '../lib/ownMedia'
import { VOICE_MAX_MS, canRecordVoice, fmtVoiceTime, recordVoice } from '../lib/voice'
import type { VoiceRecorder } from '../lib/voice'
import { dayKey, dayLabel, isGrouped, isRead } from '../lib/chatGroup'
import { micErrorText } from '../lib/audioDevices'
import { callLogTitle, parseCallLog, type CallLog } from '../lib/call/callLog'
import { callFriend, callSupported, fmtCallTime, useCall } from '../state/call'
import { nickInRooms, openRoomManage, useRooms, type Room } from '../state/rooms'
import { RoomCallButton } from './RoomCall'
import { apiErrorText } from '../lib/apiError'
import { inviteViaNewServer, loadMyServers, serverTitle, usePlayInvite } from '../state/playInvite'
import type { InviteTarget } from '../state/playInvite'
import { statusText } from './friends/FriendRow'
import { Ticks } from './Ticks'
import { timeHM } from '../lib/format'

function InviteCard({ addr, name, version, me }: { addr: string; name: string; version?: string; me?: boolean }) {
  const [busy, setBusy] = useState(false)
  // Приглашение вело в игру напрямую текущей сборкой: версию сервера никто не
  // спрашивал, и гость попадал на «Outdated client». Вход идёт общим путём.
  const join = () => {
    setBusy(true)
    rememberServerName(addr, name)
    void quickJoin(addr, name, undefined, version ? [version] : undefined)
      .catch(() => {})
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
      <button className="btn sm primary" disabled={busy} data-track="chat_invite_join" data-src="friend" onClick={join}>
        <Icon id="i-login" />
        {busy ? 'Заходим…' : 'Зайти'}
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
      data-track="call_back"
      title={busy ? 'Идёт другой звонок' : 'Позвонить'}
      onClick={() => void callFriend(uid, nick)}
    >
      <Icon id={missed ? 'i-phone-off' : 'i-phone'} />
      <span className="msg-call-body">
        <b>{callLogTitle(log, !!me)}</b>
        <span>{log.outcome === 'done' ? fmtCallTime(log.seconds * 1000) : 'Перезвонить'}</span>
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
    return <p className="faint-note fr-stat-empty">Пока без игр</p>
  }
  return (
    <div className="fr-stat">
      {joinable ? (
        <button
          className="btn sm primary fr-stat-join"
          data-track="friend_join"
          data-src="friend"
          onClick={() => {
            const name = p.serverName || 'Сервер ' + p.nick
            rememberServerName(p.serverIp!, name)
            void quickJoin(p.serverIp!, name).catch(() => {})
          }}
        >
          <Icon id="i-login" />
          Зайти
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

/// Смайлы в чате — только пиксельные eltaller (владелец 24.09.2026: «убери
/// обычные смайлики и стикеры — вырежи, оставь только пиксельные»). Недавние
/// встают первыми, как и было у обычных.
const RECENT_ELT_KEY = 'm-chat-elt'
const RECENT_ELT = 8

const REC_BARS = 28

function recentElt(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_ELT_KEY) || '[]')
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && ELT_IDS.includes(x)).slice(0, RECENT_ELT)
      : []
  } catch {
    return []
  }
}

function rememberElt(id: string) {
  try {
    localStorage.setItem(RECENT_ELT_KEY, JSON.stringify([id, ...recentElt().filter((x) => x !== id)].slice(0, RECENT_ELT)))
  } catch {
    /* приватное окно — недавние просто не запомнятся */
  }
}

/**
 * Старое сообщение со стикером: стикеров больше не отправить, но переписка
 * остаётся как была. Картинка не загрузилась — подпись вместо пустого места.
 */
function OldSticker({ url, name }: { url: string; name?: string }) {
  const [broken, setBroken] = useState(!isOwnMediaUrl(url))
  if (broken) return <span className="msg-gone">{name || 'Стикер'}</span>
  return <img className="msg-sticker" src={url} alt={name || 'Стикер'} loading="lazy" onError={() => setBroken(true)} />
}

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
          data-track="msg_reply_jump"
          onClick={(e) => {
            e.stopPropagation()
            onJump(m.replyTo!.id)
          }}
        >
          <b>{quotedFrom}</b>
          <span><EltText text={replyLabel(m.replyTo)} /></span>
        </button>
      ) : null}
      {att && att.kind === 'voice' ? <VoiceMessage att={att} me={m.me} /> : null}
      {att && att.kind === 'image' ? (
        isOwnMediaUrl(att.url) ? (
          <img className="msg-img" src={att.url} alt="" loading="lazy" onClick={() => openImage(att.url)} />
        ) : (
          <span className="msg-gone">Вложение</span>
        )
      ) : null}
      {att && att.kind === 'sticker' ? <OldSticker url={att.url} name={att.name} /> : null}
      {m.text ? <span className="msg-text"><EltText text={m.text} /></span> : null}
    </>
  )
}

interface MenuAt {
  m: ChatMessage
  x: number
  y: number
}

const MENU_W = 210
const MENU_H = 300

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
  // В корень документа: экран сообщений обрезан срезом угла, и меню у края
  // переписки срезалось бы вместе с ним.
  return createPortal(
    <div
      className="msg-menu"
      data-private
      data-section="msg_menu"
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
            data-track="msg_react"
            onClick={() => react(em)}
          >
            <ReactionArt emoji={em} />
          </button>
        ))}
      </div>
      <button className="msg-menu-item" data-track="msg_reply" onClick={run(() => useFriends.getState().set({ chatReplyTo: m, chatEditing: null }))}>
        <Icon id="i-reply" /> Ответить
      </button>
      {m.text ? (
        <button
          className="msg-menu-item"
          data-track="msg_copy_text"
          onClick={run(() => {
            void copyText(m.text).then((ok) =>
              ok ? showToast('Скопировано') : showToast('Не удалось скопировать', 'error'),
            )
          })}
        >
          <Icon id="i-copy" /> Копировать текст
        </button>
      ) : null}
      {m.attachment?.kind === 'image' && m.attachment.url ? (
        <>
          <button className="msg-menu-item" data-track="msg_copy_image" onClick={run(() => void copyPictureTo({ url: m.attachment!.url }))}>
            <Icon id="i-copy" /> Копировать картинку
          </button>
          <button className="msg-menu-item" data-track="msg_save_image" onClick={run(() => void savePictureTo({ url: m.attachment!.url }))}>
            <Icon id="i-download" /> Сохранить картинку
          </button>
        </>
      ) : null}
      {m.me && m.text ? (
        <button
          className="msg-menu-item"
          data-track="msg_edit"
          onClick={run(() => useFriends.getState().set({ chatEditing: m, chatReplyTo: null }))}
        >
          <Icon id="i-edit" /> Изменить
        </button>
      ) : null}
      {m.me ? (
        <button
          className="msg-menu-item danger"
          data-track="msg_delete"
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
    </div>,
    document.body,
  )
}

const INVITE_SERVERS = 6

/// Набор реакций закреплён и на сервере: там он же проверяет пришедший эмодзи,
/// поэтому в сеть уходит прежний символ. Рисуется он пиксельным двойником из
/// eltaller — обычных смайлов в интерфейсе нет (владелец 24.09.2026).
const REACTIONS = ['👍', '👎', '❤️', '🔥', '😂', '😮', '😢', '🎉']
const REACTION_ART: Record<string, string> = {
  '👍': '23',
  '👎': '25',
  '❤️': '22',
  '🔥': '50',
  '😂': '27',
  '😮': '55',
  '😢': '38',
  '🎉': '17',
}

/** Реакция картинкой; неизвестная серверу-новинке — её символом, без падения. */
function ReactionArt({ emoji }: { emoji: string }) {
  const id = REACTION_ART[emoji]
  if (!id) return <span className="msg-react-raw">{emoji}</span>
  return <img className="elt-emoji msg-react-art" src={eltUrl(id)} alt={emoji} draggable={false} />
}

function replyLabel(m: { text: string; deleted?: boolean; kind?: string | null }): string {
  if (m.deleted) return 'Сообщение удалено'
  if (m.text) return m.text
  if (m.kind === 'voice') return 'Голосовое сообщение'
  if (m.kind === 'image') return 'Картинка'
  if (m.kind === 'sticker') return 'Стикер'
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
  useEffect(() => {
    if (emojiOpen) void loadEltAliases()
  }, [emojiOpen])
  // Выбор закрывается нажатием мимо него, как меню.
  useEffect(() => {
    if (!emojiOpen) return
    const close = () => setEmojiOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [emojiOpen])
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
      } catch (e) {
        showToast(offPlatformReason(e) || 'Не удалось изменить сообщение', 'error')
      }
      return
    }
    setText('')
    const quoted = replyTo
    setChat({ chatReplyTo: null })
    try {
      await sendChat(body, attachment, quoted ? replyPreviewOf(quoted) : null)
    } catch (e) {
      const held = offPlatformReason(e)
      showToast(held || 'Сообщение не ушло — нажми «Повторить» под ним', 'error')
    }
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
      showToast(apiErrorText(e, 'Картинка не загрузилась'), 'error')
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
      showToast(apiErrorText(e, 'Голосовое не отправилось'), 'error')
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
        <button className="chat-rec-x" title="Отменить" data-track="voice_cancel" onClick={() => void stopRecording(false)}>
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
        <button className="chat-send" title="Отправить" data-track="voice_send" onClick={() => void stopRecording(true)}>
          <Icon id="i-send" />
        </button>
      </div>
    )
  }

  const recent = recentElt()
  const eltList = [...recent, ...ELT_IDS.filter((id) => !recent.includes(id))]

  const quoted = editing || replyTo
  const bar = quoted ? (
    <div className="chat-quote">
      <Icon id={editing ? 'i-edit' : 'i-reply'} />
      <span className="chat-quote-body">
        <b>{editing ? 'Изменение сообщения' : 'Ответ ' + (replyTo?.me ? 'на своё сообщение' : '')}</b>
        <span><EltText text={replyLabel({ text: quoted.text, deleted: quoted.deleted, kind: quoted.attachment?.kind })} /></span>
      </span>
      <button
        className="chat-quote-x"
        title="Отменить"
        data-track="quote_cancel"
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
      {emojiOpen ? (
        <div className="chat-emoji-pop elt-pop" onClick={(e) => e.stopPropagation()}>
          {eltList.map((id) => (
            <button
              key={id}
              className="chat-emoji elt"
              data-track="emoji_pick"
              title={eltAlias(id) || undefined}
              onClick={() => {
                rememberElt(id)
                setText((t) => t + eltCode(id))
                setEmojiOpen(false)
                inputRef.current?.focus()
              }}
            >
              <img className="elt-emoji" src={eltUrl(id)} alt={eltAlias(id) || eltCode(id)} draggable={false} />
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
        className={'chat-emoji-btn chat-elt-btn' + (emojiOpen ? ' on' : '')}
        aria-label="Смайлы"
        data-track="emoji_open"
        onClick={(e) => {
          e.stopPropagation()
          setEmojiOpen((v) => !v)
        }}
      >
        <img className="elt-emoji" src={eltUrl('41')} alt="" draggable={false} />
      </button>
      <button className="chat-emoji-btn" aria-label="Картинка" disabled={busy} data-track="attach_image" onClick={() => fileRef.current?.click()}>
        <Icon id="i-image" />
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
          data-track={editing ? 'msg_save_edit' : 'send'}
          disabled={busy || (!!editing && !text.trim())}
          onClick={() => void send()}
        >
          <Icon id={editing ? 'i-check' : 'i-send'} />
        </button>
      ) : (
        <button className="chat-send" title="Записать голосовое" disabled={busy} data-track="voice_record" onClick={() => void startRecording()}>
          <Icon id="i-mic" />
        </button>
      )}
    </div>
    </>
  )
}

/**
 * «Позвать играть» в шапке переписки — крупной кнопкой с подписью вместо
 * значка сервера у поля ввода (владелец 24.09.2026: «слишком маленькая
 * кнопка, непонятно»). Свой сервер Millida — первым; своего нет — строка
 * «Создать свой сервер», приглашение уйдёт само, когда он будет готов.
 */
function InvitePlay({ target }: { target: InviteTarget }) {
  const [open, setOpen] = useState(false)
  const [addr, setAddr] = useState('')
  const servers = usePlayInvite((s) => s.servers)
  const playServers = usePlayStats((s) => s.stats.servers)
  useEffect(() => {
    if (!open) return
    void loadMyServers()
    void refreshPlayStats()
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])
  const mine = (servers || []).filter((s) => s.address)
  const recent = [...playServers]
    .sort((a, b) => b.last - a.last)
    .filter((s) => !mine.some((m) => m.address === s.key))
    .slice(0, INVITE_SERVERS)
  const send = (address: string, name: string, version?: string | null) => {
    if (!isServerAddr(address)) {
      showToast('Не похоже на адрес сервера', 'error')
      return
    }
    setOpen(false)
    setAddr('')
    let ver = version
    if (ver === undefined) {
      const { selected, profiles } = useProfiles.getState()
      const cur = profiles.find((p) => p.name === selected) || profiles[0]
      ver = cur && cur.version
    }
    sendChat(encodeInvite(address.trim(), (name || address).trim().slice(0, 48), ver)).catch((e) =>
      showToast(offPlatformReason(e) || 'Приглашение не ушло — нажми «Повторить» под ним', 'error'),
    )
  }
  return (
    <div className="chat-invite-wrap">
      <button
        className={'btn md primary chat-invite-btn' + (open ? ' on' : '')}
        data-track="invite"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <Icon id="i-server" />
        Позвать играть
      </button>
      {open ? (
        <div className="chat-srv-pop" onClick={(e) => e.stopPropagation()}>
          {mine.map((s) => (
            <button key={s.id} className="chat-srv-row mine" data-track="invite_my_server" data-kind="own_server" onClick={() => send(s.address || '', serverTitle(s), s.version || null)}>
              <Icon id="i-server" />
              <span className="chat-srv-name">{serverTitle(s)}</span>
              <span className="chat-srv-addr">Мой сервер</span>
            </button>
          ))}
          {servers && !mine.length ? (
            <button
              className="chat-srv-row make"
              data-track="invite_new_server"
              onClick={() => {
                setOpen(false)
                inviteViaNewServer(target)
              }}
            >
              <Icon id="i-plus" />
              <span className="chat-srv-name">Создать свой сервер</span>
            </button>
          ) : null}
          {recent.map((s) => (
            <button key={s.key} className="chat-srv-row" data-track="invite_recent_server" onClick={() => send(s.key, s.label || s.key)}>
              <Icon id="i-server" />
              <span className="chat-srv-name">{s.label || s.key}</span>
              <span className="chat-srv-addr">{s.key}</span>
            </button>
          ))}
          <div className="chat-srv-manual">
            <div className="input sm">
              <input
                placeholder="Адрес сервера"
                value={addr}
                spellCheck={false}
                onChange={(e) => setAddr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send(addr.trim(), addr.trim())
                }}
              />
            </div>
            <button className="btn sm secondary" disabled={!isServerAddr(addr)} data-track="invite_address" onClick={() => send(addr.trim(), addr.trim())}>
              Позвать
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CallButton({ uid, nick }: { uid: string; nick: string }) {
  const status = useCall((s) => s.status)
  if (!uid || !callSupported()) return null
  return (
    <button
      className="tb-btn call-start"
      data-track="call"
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
      <InvitePlay target={{ id: room.id, nick: room.title, room: true }} />
      {callSupported() ? <RoomCallButton room={room} here={here} busy={status !== 'idle'} /> : null}
      <button className="tb-btn" title="Участники группы" data-track="room_manage" onClick={() => openRoomManage(room.id)}>
        <Icon id="i-dots" />
      </button>
    </>
  )
}

const FLASH_MS = 1400
const JUMP_PAGES = 20
const JUMP_FRAMES = 12

/// Одна строка о собеседнике в шапке: где он сейчас.
function PeerHead({ uid, nick }: { uid: string; nick: string }) {
  const f = useFriends((s) => s.friends.find((x) => x.userId === uid))
  const sub = f ? statusText(f) : ''
  return (
    <>
      <Head id="chatAva" nick={nick || 'MHF_Steve'} size={36} />
      <span className="chat-head-body">
        <b id="chatNick">{nick || '—'}</b>
        {sub ? (
          <span className={'chat-head-sub' + (f?.online ? ' on' : '')}>
            {f?.online ? <span className="dot"></span> : null}
            {sub}
          </span>
        ) : null}
      </span>
      {uid ? <InvitePlay target={{ id: uid, nick }} /> : null}
      <CallButton uid={uid} nick={nick} />
    </>
  )
}

/**
 * Открытая переписка на экране «Сообщения»: шапка, лента, поле ввода. Панелью
 * сбоку она больше не бывает (владелец 24.09.2026) — ширину, ручку и закрытие
 * кликом мимо держит экран, а не она.
 */
export function ChatThread() {
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
  } = useFriends()
  const room = useRooms((s) => s.rooms.find((r) => r.id === chatRoom))
  const bodyRef = useRef<HTMLDivElement>(null)
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
    <div className="chat-thread" id="chat" data-private data-section="chat">
      <div className={'chat-head' + (room ? ' room' : '')}>
        {room ? <RoomHead room={room} /> : <PeerHead uid={chatWith} nick={chatNick} />}
      </div>
      <div className="chat-body" id="chatBody" ref={bodyRef} onScroll={onScroll}>
        {chatOlderBusy ? <div className="chat-older skel" aria-hidden="true" /> : null}
        {chatHeader ? (
          <>
            <div className="chat-prof">
              <img
                className="chat-prof-body"
                alt=""
                src={'https://api.millida.net/v2/heads/body/' + encodeURIComponent(chatHeader.nick || 'Steve') + '?size=128'}
                onError={(e) => onAvatarError(e, 128, chatHeader.nick)}
              />
              <span className="chat-prof-txt">
                <b>{chatHeader.nick}</b>
                {chatHeader.text ? <span>{chatHeader.text}</span> : null}
              </span>
              <FriendStats p={chatHeader} />
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
                <InviteCard addr={inv.addr} name={inv.name} version={inv.version} me={m.me} />
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
                  (m.attachment && m.attachment.kind === 'sticker' && !m.text && !m.replyTo
                    ? ' sticker'
                    : m.attachment && !m.text
                      ? ' bare'
                      : '') +
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
                  data-track="msg_menu"
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
                      data-track="msg_react"
                      onClick={() =>
                        toggleChatReaction(m.id || '', r.emoji).catch(() =>
                          showToast('Реакция не поставилась', 'error'),
                        )
                      }
                    >
                      <ReactionArt emoji={r.emoji} /> {r.count}
                    </button>
                  ))}
                </div>
              ) : null}
              {m.state === 'failed' ? (
                <div className="msg-fail">
                  <span>Не отправлено</span>
                  <button data-track="msg_retry" onClick={() => void retryChat(m.localId || '')}>Повторить</button>
                  <button data-track="msg_drop" onClick={() => dropFailedChat(m.localId || '')}>Удалить</button>
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
        <button className="chat-down" title="К последним" data-track="chat_scroll_down" onClick={scrollDown}>
          <Icon id="i-arrow-dn" />
        </button>
      ) : null}
      {menu ? <MessageMenu at={menu} close={() => setMenu(null)} /> : null}
      <Composer />
    </div>
  )
}
