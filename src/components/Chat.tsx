import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { addServer } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { joinWithAuth, showLaunchError } from '../lib/launch'
import { setScreen, showToast } from '../state/ui'
import { parseInvite } from '../lib/invite'
import { Head } from './Head'
import { fmtPlaytime, onAvatarError, whenText } from '../lib/format'
import { rememberServerName } from '../state/playStats'
import { quickJoin } from '../lib/joinServer'
import { dropFailedChat, loadOlderChat, pingTyping, retryChat, sendChat, useFriends } from '../state/friends'
import type { ChatAttachment, ChatMessage, FriendProfile } from '../state/friends'
import { VoiceMessage } from './VoiceMessage'
import { MAX_CHAT_IMAGE_BYTES, uploadChatImage, uploadVoice } from '../lib/chatMedia'
import { VOICE_MAX_MS, canRecordVoice, fmtVoiceTime, recordVoice } from '../lib/voice'
import type { VoiceRecorder } from '../lib/voice'
import { dayKey, dayLabel, isGrouped, isRead } from '../lib/chatGroup'

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
            void quickJoin(p.serverIp!, name)
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

function MessageBody({ m }: { m: ChatMessage }) {
  const att = m.attachment
  return (
    <>
      {att && att.kind === 'voice' ? <VoiceMessage att={att} me={m.me} /> : null}
      {att && att.kind === 'image' ? <img className="msg-img" src={att.url} alt="" loading="lazy" /> : null}
      {m.text ? <span className="msg-text">{m.text}</span> : null}
    </>
  )
}

function Composer({ uid }: { uid: string }) {
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
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
    setText('')
    try {
      await sendChat(uid, body, attachment)
    } catch {
      showToast('Сообщение не ушло — нажми «Повторить» под ним', 'error')
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
      showToast('Микрофон недоступен', 'error')
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
    } catch {
      showToast('Нет доступа к микрофону — разреши его в системе', 'error')
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

  return (
    <div className="chat-input">
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
        }}
      >
        <Icon id="i-smile" />
      </button>
      <button className="chat-emoji-btn" title="Картинка" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Icon id="i-image" />
      </button>
      <div className="input sm">
        <input
          id="chatMsg"
          placeholder={busy ? 'Загружаем…' : 'Сообщение…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) pingTyping(uid)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void send()
          }}
        />
      </div>
      {text.trim() ? (
        <button className="chat-send" title="Отправить" disabled={busy} onClick={() => void send()}>
          <Icon id="i-send" />
        </button>
      ) : (
        <button className="chat-send" title="Записать голосовое" disabled={busy} onClick={() => void startRecording()}>
          <Icon id="i-mic" />
        </button>
      )}
    </div>
  )
}

export function Chat() {
  const {
    chatOpen,
    chatNick,
    chatWith,
    chatHeader,
    chatMsgs,
    chatEmpty,
    chatSeq,
    chatHasMore,
    chatOlderBusy,
    chatPeerReadAt,
    chatTyping,
    set,
  } = useFriends()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  atBottomRef.current = atBottom

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
  }, [chatOpen, chatWith, scrollDown])

  useEffect(() => {
    if (!chatOpen) return
    const onDoc = (e: MouseEvent) => {
      // composedPath is captured when the event is dispatched. `closest` on the
      // target is not: a button whose handler re-renders it away (stop the
      // recording, drop a failed message) is already detached by the time this
      // listener runs, reads as "outside" and closed the whole panel.
      const inside = e
        .composedPath()
        .some(
          (n) =>
            n instanceof HTMLElement &&
            (n.id === 'chat' || n.classList.contains('fr-msg') || n.classList.contains('fr-row')),
        )
      if (inside) return
      set({ chatOpen: false })
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [chatOpen, set])

  const onScroll = () => {
    const b = bodyRef.current
    if (!b) return
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
    <div className={'chat' + (chatOpen ? ' open' : '')} id="chat">
      <div className="chat-head">
        <Head id="chatAva" nick={chatNick || 'MHF_Steve'} size={32} />
        <b id="chatNick">{chatNick || '—'}</b>
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
                src={'https://mc-heads.net/body/' + encodeURIComponent(chatHeader.nick || 'MHF_Steve') + '/120'}
                style={{ height: '130px', imageRendering: 'pixelated' }}
                onError={(e) => onAvatarError(e, 120, chatHeader.nick)}
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
          const read = isRead(m, chatPeerReadAt)
          return (
            <Fragment key={key}>
              {day}
              <div className={'msg-row' + (m.me ? ' me' : '')}>
              <div
                className={
                  'msg' +
                  (m.me ? ' me' : '') +
                  (!newDay && isGrouped(chatMsgs, i) ? ' grouped' : '') +
                  (m.state === 'sending' ? ' sending' : '') +
                  (m.state === 'failed' ? ' failed' : '') +
                  (m.attachment && !m.text ? ' bare' : '')
                }
              >
                <MessageBody m={m} />
                <span className="msg-meta">
                  <span>{timeHM(m.ts)}</span>
                  {m.me && !m.state ? <span className={'msg-tick' + (read ? ' read' : '')} /> : null}
                  {m.state === 'sending' ? <span className="msg-tick pending" /> : null}
                </span>
              </div>
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
        {chatTyping ? <div className="chat-typing">{chatNick} печатает…</div> : null}
        {!chatHeader && chatEmpty && !chatMsgs.length ? <p className="faint-note">Напиши первым</p> : null}
      </div>
      {!atBottom ? (
        <button className="chat-down" title="К последним" onClick={scrollDown}>
          <Icon id="i-arrow-dn" />
        </button>
      ) : null}
      <Composer uid={chatWith} />
    </div>
  )
}
