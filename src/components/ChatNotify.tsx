import { useEffect } from 'react'
import { Icon } from './Icon'
import { Head } from './Head'
import { openChat } from '../state/friends'
import { useChatNotify } from '../state/chatNotify'
import type { ChatNotify as Notify } from '../state/chatNotify'

const ICON: Record<string, string> = { play: 'i-play', request: 'i-user', room: 'i-users' }

function NotifyCard({ id, uid, nick, text, kind, actionLabel, action }: Notify) {
  const dismiss = useChatNotify((s) => s.dismiss)
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), kind === 'msg' || !kind ? 6000 : 9000)
    return () => clearTimeout(t)
  }, [id, kind, dismiss])
  return (
    <div
      className="chat-notify"
      onClick={() => {
        dismiss(id)
        if (action) action()
        else void openChat(uid, nick)
      }}
    >
      {/* У группы вместо головы игрока свой значок: ник в карточке — это её
          название, и рендерить по нему скин было бы враньём. */}
      {kind === 'room' ? (
        <span className="room-ava sm">
          <Icon id="i-users" />
        </span>
      ) : (
        <Head nick={nick} size={40} />
      )}
      <div className="chat-notify-body">
        <b>{nick || 'Игрок'}</b>
        <span>{text}</span>
        {actionLabel ? (
          <span className="chat-notify-act">
            {kind && ICON[kind] ? <Icon id={ICON[kind]} /> : null}
            {actionLabel}
          </span>
        ) : null}
      </div>
      <button
        className="chat-notify-x"
        title="Скрыть"
        onClick={(e) => {
          e.stopPropagation()
          dismiss(id)
        }}
      >
        <Icon id="i-x" />
      </button>
    </div>
  )
}

export function ChatNotify() {
  const items = useChatNotify((s) => s.items)
  if (!items.length) return null
  return (
    <div className="chat-notify-stack">
      {items.map((n) => (
        <NotifyCard key={n.id} {...n} />
      ))}
    </div>
  )
}
