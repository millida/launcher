import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { SvgSprite } from '../components/SvgSprite'
import { tauri } from '../ipc/tauri'
import { overlayHide, overlayReady } from '../ipc/commands'
import { api } from '../lib/api'
import { Head } from '../components/Head'
import { apiErrorText } from '../lib/apiError'

interface OverlayMessage {
  uid: string
  nick: string
  text: string
  ts: number
  kind?: 'msg' | 'online' | 'play'
  nicks?: string[]
}

const CARD_TTL_MS = 9_000
const HISTORY = 24
/// A window shown for a card that never arrived must not stay: it is
/// full-screen, always on top and has no close button of its own.
const EMPTY_TTL_MS = 4_000

/// The overlay owns no polling of its own: two pollers would share one `since`
/// cursor and eat each other's messages. The main window relays what it got.
export function Overlay() {
  const [interactive, setInteractive] = useState(false)
  const [msgs, setMsgs] = useState<OverlayMessage[]>([])
  const [reply, setReply] = useState('')
  const [to, setTo] = useState<OverlayMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const T = tauri()
    if (!T) return
    const offs: Array<() => void> = []
    void T.event
      .listen<boolean>('overlay-mode', (e) => {
        setInteractive(e.payload)
        if (e.payload) setTimeout(() => inputRef.current?.focus(), 30)
      })
      .then((un) => offs.push(un))
      .catch(() => {})
    void T.event
      .listen<OverlayMessage>('overlay-message', (e) => {
        const m = { ...e.payload, ts: e.payload.ts || Date.now() }
        setMsgs((prev) => prev.concat([m]).slice(-HISTORY))
        if (!m.kind || m.kind === 'msg') setTo((cur) => cur || m)
      })
      .then((un) => offs.push(un))
      .catch(() => {})
    void overlayReady().catch(() => {})
    return () => offs.forEach((un) => un())
  }, [])

  useEffect(() => {
    const b = listRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [msgs.length, interactive])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void overlayHide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Passive mode is a HUD, not a window: only fresh cards are drawn, and the
  // rest of the screen must stay clickable for the game underneath.
  const now = Date.now()
  const fresh = msgs.filter((m) => now - m.ts < CARD_TTL_MS)
  const chat = msgs.filter((m) => !m.kind || m.kind === 'msg')
  useEffect(() => {
    if (interactive) return
    // An always-on-top window with nothing left to show still costs a
    // compositor layer over the game, so it goes away with its last card.
    // A freshly created window may have no card yet, but waiting forever is how
    // an empty overlay ends up covering the whole screen with no way out.
    if (!fresh.length) {
      const t = setTimeout(() => void overlayHide(), msgs.length ? 0 : EMPTY_TTL_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setMsgs((prev) => prev.filter((m) => Date.now() - m.ts < CARD_TTL_MS)), 1000)
    return () => clearTimeout(t)
  }, [msgs, interactive, fresh.length])

  const send = async () => {
    const body = reply.trim()
    if (!body || !to || sending) return
    setSending(true)
    setError('')
    try {
      await api('/friends/chat/' + encodeURIComponent(to.uid), {
        method: 'POST',
        body: JSON.stringify({ text: body }),
      })
      setMsgs((prev) => prev.concat([{ uid: to.uid, nick: 'Ты', text: body, ts: Date.now() }]).slice(-HISTORY))
      setReply('')
    } catch (e) {
      setError(apiErrorText(e, 'Сообщение не отправлено'))
    } finally {
      setSending(false)
    }
  }

  if (!interactive) {
    return (
      <div className="ov ov-passive">
        <SvgSprite />
        <div className="ov-cards">
          {fresh.map((m) => (
            <div className={'ov-card ov-' + (m.kind || 'msg')} key={m.uid + m.ts}>
              <div className="ov-card-heads">
                {(m.nicks?.length ? m.nicks : [m.nick]).slice(0, 3).map((n, i) => (
                  <Head key={n + i} nick={n} size={30} />
                ))}
              </div>
              <div className="ov-card-body">
                <b>{m.nick}</b>
                <span>{m.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="ov ov-active" onMouseDown={(e) => e.target === e.currentTarget && void overlayHide()}>
      <SvgSprite />
      <div className="ov-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head">
          <Icon id="i-msg" />
          <b>Чат Millida</b>
          <span className="ov-hint">Esc — закрыть</span>
          <button className="ov-x" onClick={() => void overlayHide()}>
            <Icon id="i-x" />
          </button>
        </div>
        <div className="ov-list" ref={listRef}>
          {chat.length ? (
            chat.map((m) => (
              <div className={'ov-msg' + (m.nick === 'Ты' ? ' me' : '')} key={m.uid + m.ts}>
                <b>{m.nick}</b>
                <span>{m.text}</span>
              </div>
            ))
          ) : (
            <p className="ov-empty">Пока тихо. Сообщения друзей появятся здесь, не сворачивая игру.</p>
          )}
        </div>
        {error ? <div className="ov-error">{error}</div> : null}
        <div className="ov-input">
          <input
            ref={inputRef}
            placeholder={to ? 'Ответить ' + to.nick + '…' : 'Некому отвечать — дождись сообщения'}
            value={reply}
            disabled={!to || sending}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send()
            }}
          />
          <button disabled={!to || sending || !reply.trim()} onClick={() => void send()}>
            <Icon id="i-send" />
          </button>
        </div>
      </div>
    </div>
  )
}
