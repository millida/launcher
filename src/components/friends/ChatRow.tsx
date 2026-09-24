import { Icon } from '../Icon'
import { Head } from '../Head'
import { chatWhen } from '../../lib/overlayChats'
import type { OverlayChatItem } from '../../lib/overlayChats'
import { openChat, openRoomChat } from '../../state/friends'
import { nickInRooms } from '../../state/rooms'
import type { Friend } from '../../state/friends'
import type { Room } from '../../state/rooms'
import { statusText } from './FriendRow'

export const openChatItem = (i: OverlayChatItem) =>
  void (i.room ? openRoomChat(i.id, i.title) : openChat(i.id, i.title))

export const unreadText = (n: number) => (n > 9 ? '9+' : String(n))

/**
 * Строка в колонке чатов экрана «Сообщения»: личка и группы одним списком,
 * как в Telegram. Текста последнего сообщения список с сервера не отдаёт —
 * вместо него у друга его состояние, у группы — кто в разговоре или состав.
 */
export function ChatRow({
  item,
  friend,
  room,
  me,
  active,
}: {
  item: OverlayChatItem
  friend?: Friend
  room?: Room
  me: string
  active: boolean
}) {
  const inside = room?.voice || []
  const line = room
    ? inside.length
      ? 'В разговоре: ' + inside.map((v) => nickInRooms(v.userId) || '…').join(', ')
      : room.members
          .filter((m) => m.userId !== me)
          .map((m) => m.nickname)
          .join(', ')
    : friend
      ? statusText(friend)
      : item.subtitle
  const on = room ? inside.length > 0 : !!friend?.online
  return (
    <button
      className={'cl-row' + (active ? ' on' : '') + (item.unread ? ' unread' : '')}
      data-key={item.key}
      data-private
      data-track={room ? 'chat_open_room' : 'chat_open_dm'}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        if (!active) openChatItem(item)
      }}
    >
      <span className="cl-ava">
        {room ? (
          <span className="room-ava">
            <Icon id="i-users" />
          </span>
        ) : (
          <Head nick={item.title} src={friend?.avatarUrl} size={40} />
        )}
        {on ? <span className="cl-dot" /> : null}
      </span>
      <span className="cl-body">
        <span className="cl-top">
          <b className="cl-title">{item.title}</b>
          {item.ts ? <span className="cl-when">{chatWhen(item.ts)}</span> : null}
        </span>
        <span className="cl-bottom">
          <span className="cl-line">{line}</span>
          {item.unread ? <span className="cl-n">{unreadText(item.unread)}</span> : null}
        </span>
      </span>
    </button>
  )
}
