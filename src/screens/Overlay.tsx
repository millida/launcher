import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { SvgSprite } from '../components/SvgSprite'
import { tauri } from '../ipc/tauri'
import { overlayHide, overlayHitAreas, overlayOpen, overlayReady } from '../ipc/commands'
import { api } from '../lib/api'
import { CARD_TTL_MS, freshCards, holdCards } from '../lib/overlayCards'
import { Head } from '../components/Head'
import { apiErrorText } from '../lib/apiError'

interface OverlayMessage {
  uid: string
  nick: string
  text: string
  ts: number
  kind?: 'msg' | 'online' | 'play'
  nicks?: string[]
  open?: 'chat' | 'room' | 'friends' | 'call'
}

interface Card extends OverlayMessage {
  /// Not a timestamp: hovering a card stops its clock, so the deadline moves.
  expires: number
}

const CARDS_SHOWN = 3

const HISTORY = 24
/// A window shown for a card that never arrived must not stay: it is
/// full-screen, always on top and has no close button of its own.
const EMPTY_TTL_MS = 4_000

/// The overlay owns no polling of its own: two pollers would share one `since`
/// cursor and eat each other's messages. The main window relays what it got.
export function Overlay() {
  const [interactive, setInteractive] = useState(false)
  const [msgs, setMsgs] = useState<Card[]>([])
  const [hover, setHover] = useState(false)
  const [tick, setTick] = useState(0)
  const [reply, setReply] = useState('')
  const [to, setTo] = useState<OverlayMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const heldSince = useRef(0)
  const sentHit = useRef('')

  useEffect(() => {
    const T = tauri()
    if (!T) return
    const offs: Array<() => void> = []
    void T.event
      .listen<boolean>('overlay-mode', (e) => {
        setInteractive(e.payload)
        // The core drops the hit areas whenever the window goes down, so an
        // unchanged stack after a re-show would be drawn over dead rectangles.
        sentHit.current = ''
        if (e.payload) setTimeout(() => inputRef.current?.focus(), 30)
      })
      .then((un) => offs.push(un))
      .catch(() => {})
    void T.event
      .listen<OverlayMessage>('overlay-message', (e) => {
        const m = { ...e.payload, ts: e.payload.ts || Date.now(), expires: Date.now() + CARD_TTL_MS }
        setMsgs((prev) => prev.concat([m]).slice(-HISTORY))
        if (!m.kind || m.kind === 'msg') setTo((cur) => cur || m)
      })
      .then((un) => offs.push(un))
      .catch(() => {})
    void T.event
      .listen<boolean>('overlay-hover', (e) => setHover(e.payload))
      .then((un) => offs.push(un))
      .catch(() => {})
    // The card that was clicked decides who the reply goes to: the chat opens on
    // that conversation instead of whatever arrived last.
    void T.event
      .listen<OverlayMessage>('overlay-open', (e) => {
        const m = { ...e.payload, ts: e.payload.ts || Date.now(), expires: Date.now() + CARD_TTL_MS }
        if (!m.kind || m.kind === 'msg') setTo(m)
        setTimeout(() => inputRef.current?.focus(), 30)
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
  const fresh = freshCards(msgs, now, CARDS_SHOWN)
  const chat = msgs.filter((m) => !m.kind || m.kind === 'msg')

  // Reading a card takes longer than showing it: the pointer on the stack holds
  // the deadlines, which resume where they stopped - up to the card ceiling, so
  // a cursor left in that corner cannot make a card permanent.
  useEffect(() => {
    if (interactive) return
    if (hover) {
      heldSince.current = Date.now()
      return
    }
    const held = heldSince.current ? Date.now() - heldSince.current : 0
    heldSince.current = 0
    if (held > 0) setMsgs((prev) => holdCards(prev, held))
  }, [hover, interactive])

  useEffect(() => {
    if (interactive) return
    // An always-on-top window with nothing left to show still costs a
    // compositor layer over the game, so it goes away with its last card.
    // A freshly created window may have no card yet, but waiting forever is how
    // an empty overlay ends up covering the whole screen with no way out.
    if (!fresh.length) {
      const t = setTimeout(() => void overlayHide().catch(() => {}), msgs.length ? 0 : EMPTY_TTL_MS)
      return () => clearTimeout(t)
    }
    // The tick also runs under the pointer: hovering only postpones a card up
    // to its ceiling, and someone has to notice when that ceiling is reached.
    const t = setTimeout(() => setTick((n) => n + 1), 500)
    return () => clearTimeout(t)
  }, [msgs, interactive, hover, fresh.length, tick])

  // The window is click-through as a whole and the core lifts that flag only
  // over the rectangles reported here, so a stale rectangle is a hole the game
  // loses clicks in: they are re-sent on every change of the stack.
  useLayoutEffect(() => {
    const box = cardsRef.current
    const rects =
      interactive || !box
        ? []
        : Array.from(box.querySelectorAll('.ov-card')).map((el) => {
            const r = el.getBoundingClientRect()
            return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
          })
    const key = JSON.stringify(rects)
    if (key === sentHit.current) return
    sentHit.current = key
    void overlayHitAreas(rects).catch(() => {})
  }, [interactive, fresh.length, msgs, tick])

  const dismiss = useCallback((card: Card) => {
    setMsgs((prev) => {
      const left = prev.filter((m) => !(m.uid === card.uid && m.ts === card.ts))
      if (!freshCards(left, Date.now(), CARDS_SHOWN).length) void overlayHide().catch(() => {})
      return left
    })
  }, [])

  const payloadOf = (m: OverlayMessage): OverlayMessage => ({
    uid: m.uid,
    nick: m.nick,
    text: m.text,
    ts: m.ts,
    kind: m.kind,
    nicks: m.nicks,
    open: m.open,
  })

  const openCard = useCallback((card: Card) => {
    void overlayOpen(payloadOf(card)).catch(() => {})
  }, [])

  const openInLauncher = useCallback(() => {
    const target: OverlayMessage = to
      ? { ...payloadOf(to), open: to.open || 'chat' }
      : { uid: '', nick: '', text: '', ts: Date.now(), open: 'friends' }
    void overlayOpen(target, true).catch(() => {})
  }, [to])

  const send = async () => {
    const body = reply.trim()
    if (!body || !to || sending) return
    setSending(true)
    setError('')
    try {
      // A group card carries a room id, not a person: sending it to the private
      // endpoint would post the reply into a conversation with nobody.
      const base =
        to.open === 'room'
          ? '/friends/rooms/' + encodeURIComponent(to.uid) + '/chat'
          : '/friends/chat/' + encodeURIComponent(to.uid)
      await api(base, {
        method: 'POST',
        body: JSON.stringify({ text: body }),
      })
      setMsgs((prev) => prev.concat([{ uid: to.uid, nick: 'Ты', text: body, ts: Date.now(), expires: Date.now() + CARD_TTL_MS }]).slice(-HISTORY))
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
        <div className={'ov-cards' + (hover ? ' held' : '')} ref={cardsRef}>
          {fresh.map((m) => (
            <div
              // The kind goes into its own namespace: `ov-` + kind once produced
              // `ov-msg`, the chat bubble class of the interactive panel, and a
              // later rule with the same specificity took the card apart.
              className={'ov-card ov-kind-' + (m.kind || 'msg')}
              key={m.uid + m.ts}
              role="button"
              tabIndex={-1}
              title={m.open === 'call' || m.open === 'friends' ? 'Открыть лаунчер' : 'Открыть чат'}
              onClick={() => openCard(m)}
            >
              <div className="ov-card-heads">
                {(m.nicks?.length ? m.nicks : [m.nick]).slice(0, 3).map((n, i) => (
                  <Head key={n + i} nick={n} size={30} />
                ))}
              </div>
              <div className="ov-card-body">
                <b>{m.nick}</b>
                <span>{m.text}</span>
              </div>
              <button
                className="ov-card-x"
                title="Скрыть"
                onClick={(e) => {
                  e.stopPropagation()
                  dismiss(m)
                }}
              >
                <Icon id="i-x" />
              </button>
              <i className="ov-card-ttl" style={{ animationDuration: CARD_TTL_MS + 'ms' }} />
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
          <button className="ov-x" title="Открыть в лаунчере" onClick={() => openInLauncher()}>
            <Icon id="i-ext" />
          </button>
          <button className="ov-x" title="Закрыть" onClick={() => void overlayHide()}>
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
