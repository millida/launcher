import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { api } from '../lib/api'
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
import { appendChatMessage, useFriends } from '../state/friends'
import type { FriendProfile } from '../state/friends'

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

export function Chat() {
  const { chatOpen, chatNick, chatWith, chatHeader, chatMsgs, chatEmpty, chatSeq, set } = useFriends()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)

  useEffect(() => {
    const b = bodyRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [chatSeq, chatMsgs.length])

  useEffect(() => {
    if (!chatOpen) setEmojiOpen(false)
  }, [chatOpen])

  useEffect(() => {
    if (!chatOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('#chat') || t.closest('.fr-msg') || t.closest('.fr-row')) return
      set({ chatOpen: false })
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [chatOpen, set])

  const send = async () => {
    const t = text.trim()
    if (!t || !chatWith) return
    setText('')
    appendChatMessage({ text: t, me: true })
    try {
      await api('/friends/chat/' + encodeURIComponent(chatWith), { method: 'POST', body: JSON.stringify({ text: t }) })
    } catch {}
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
      <div className="chat-body" id="chatBody" ref={bodyRef}>
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
          const inv = parseInvite(m.text)
          if (inv) return <InviteCard key={i} addr={inv.addr} name={inv.name} me={m.me} />
          return (
            <div
              key={i}
              className={'msg' + (m.me ? ' me' : '')}
              title={m.ts ? new Date(m.ts).toLocaleString('ru-RU') : undefined}
            >
              {m.text}
            </div>
          )
        })}
        {!chatHeader && chatEmpty && !chatMsgs.length ? <p className="faint-note">Напиши первым</p> : null}
      </div>
      <div className="chat-input">
        {emojiOpen ? (
          <div className="chat-emoji-pop" onClick={(e) => e.stopPropagation()}>
            {EMOJIS.map((em) => (
              <button
                key={em}
                className="chat-emoji"
                onClick={() => {
                  setText((t) => t + em)
                  setEmojiOpen(false)
                }}
              >
                {em}
              </button>
            ))}
          </div>
        ) : null}
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
        <div className="input sm" style={{ flex: 1 }}>
          <input
            id="chatMsg"
            placeholder="Сообщение…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send()
            }}
          />
        </div>
        <button className="chat-send" id="chatSend" title="Отправить" disabled={!text.trim()} onClick={() => void send()}>
          <Icon id="i-send" />
        </button>
      </div>
    </div>
  )
}
