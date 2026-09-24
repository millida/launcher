import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { agoText } from '../../lib/format'
import { quickJoin } from '../../lib/joinServer'
import { rememberServerName } from '../../state/playStats'
import { openChat, openFriendProfile } from '../../state/friends'
import { callFriend, callSupported } from '../../state/call'
import { invitePlay } from '../../state/playInvite'
import type { Friend } from '../../state/friends'

/** Адрес сервера друга: поле называется по-разному в разных ответах сервера. */
export const friendServer = (f: Friend): string | undefined =>
  f.serverIp ||
  (f as { server?: string }).server ||
  (f as { serverAddress?: string }).serverAddress

/// Отметка «был в сети» приходит и в секундах, и в миллисекундах — приводим к
/// секундам по величине, а не по вере в одну из двух форм.
const seenAgo = (lastSeen?: number | null): string =>
  lastSeen ? agoText(lastSeen > 1e12 ? Math.round(lastSeen / 1000) : lastSeen) : ''

/// Публичный показатель — целые часы: «4 ч 0 м» в строке списка читается хуже,
/// чем «4 ч», а минуты тут ничего не решают.
export const hoursText = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  return h >= 1 ? h + ' ч' : Math.max(1, Math.round(seconds / 60)) + ' мин'
}

/** Одна строка состояния: где человек сейчас или когда был. */
export function statusText(f: Friend): string {
  if (f.playing) {
    const where = f.serverName || friendServer(f)
    return where ? 'В игре · ' + where : f.text || 'В игре'
  }
  if (f.online) return f.text || (f.place === 'web' ? 'На сайте' : 'В сети')
  const ago = seenAgo(f.lastSeen)
  return f.text || (ago ? 'Был ' + ago : 'Был давно')
}

const MENU_W = 220
const MENU_H = 240

/**
 * Строка друга. Две крупные кнопки с подписью (владелец 24.09.2026: «"Пригласить
 * на сервер" и "Сообщение" — слишком маленькие, непонятно»): «Позвать играть»
 * (или «Зайти», когда друг на сервере и туда можно попасть) и «Написать».
 * Звонок, профиль, удаление — в меню «…». Клик по строке открывает профиль.
 *
 * Меню рисуется в корне документа с фиксированной позицией. Раньше оно лежало
 * внутри строки, и чтобы его не срезал срез угла, строке на время снимали
 * clip-path — из-под снятого среза вылезали серые углы рамки строки: та самая
 * «серая штука перед меню» (жалоба 24.09.2026).
 */
export function FriendRow({
  f,
  hours,
  rank,
  callBusy,
  menuOpen,
  onMenu,
  onRemove,
  onBlock,
}: {
  f: Friend
  hours: number | null
  rank?: number
  callBusy: boolean
  menuOpen: boolean
  onMenu: () => void
  onRemove: () => void
  onBlock: () => void
}) {
  const addr = friendServer(f)
  const canJoin = !!(f.playing && addr)
  const nick = f.nickname || ''
  const moreRef = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ right: number; top?: number; bottom?: number } | null>(null)
  useLayoutEffect(() => {
    if (!menuOpen) {
      setAt(null)
      return
    }
    const r = moreRef.current?.getBoundingClientRect()
    if (!r) return
    const right = Math.max(8, window.innerWidth - r.right)
    setAt(
      r.bottom + 6 + MENU_H > window.innerHeight
        ? { right, bottom: window.innerHeight - r.top + 6 }
        : { right, top: r.bottom + 6 },
    )
  }, [menuOpen])
  const join = () => {
    if (!addr) return
    const name = f.serverName || 'Сервер ' + (nick || 'друга')
    rememberServerName(addr, name)
    void quickJoin(addr, name).catch(() => {})
  }
  const write = () => void openChat(f.userId, nick)
  const invite = () => void invitePlay({ id: f.userId, nick })
  const profile = () => void openFriendProfile(f.userId, nick)
  const pick = (fn: () => void) => () => {
    onMenu()
    fn()
  }
  return (
    <div
      className={'fr-row' + (f.online ? '' : ' off') + (f.unread ? ' unread' : '')}
      data-uid={f.userId}
      data-nick={nick}
      data-private
      data-track="friend_profile"
      data-kind="friend"
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        profile()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) profile()
      }}
    >
      {rank ? <span className="fr-rank">{rank}</span> : null}
      <span className="fr-ava">
        <Head nick={f.nickname} size={40} />
        {f.unread ? <span className="fr-ava-n">{f.unread > 9 ? '9+' : f.unread}</span> : null}
      </span>
      <span className="fr-body">
        <span className="fr-nick">
          {nick}
          {f.gameNick ? <span className="fr-gamenick">{' · ' + f.gameNick}</span> : null}
        </span>
        <span className={'fr-status' + (f.online ? ' on' : '') + (f.place === 'web' ? ' web' : '')}>
          {f.online ? <span className="dot"></span> : null}
          {statusText(f)}
          {f.playing && f.build ? <span className="fr-build">{f.build}</span> : null}
        </span>
      </span>
      {hours ? (
        <span className="fr-hours">
          <Icon id="i-clock" />
          {hoursText(hours)}
        </span>
      ) : null}
      <span className="fr-acts">
        {canJoin ? (
          <button className="btn md primary fr-join" data-track="friend_join" data-src="friend" onClick={join}>
            <Icon id="i-login" />
            Зайти
          </button>
        ) : (
          <button className="btn md primary fr-invite" data-track="invite" onClick={invite}>
            <Icon id="i-server" />
            Позвать играть
          </button>
        )}
        <button className={'btn md secondary fr-msg' + (f.unread ? ' hot' : '')} data-track="friend_write" onClick={write}>
          <Icon id="i-msg" />
          Написать
        </button>
      </span>
      <button
        ref={moreRef}
        className={'tb-btn fr-more' + (menuOpen ? ' on' : '')}
        aria-label="Ещё"
        aria-expanded={menuOpen}
        data-track="friend_menu"
        onClick={(e) => {
          e.stopPropagation()
          onMenu()
        }}
      >
        <Icon id="i-dots" />
      </button>
      {menuOpen && at
        ? createPortal(
            <div
              className="fr-menu fr-menu-float"
              data-private
              data-section="friend_menu"
              style={{ position: 'fixed', right: at.right, top: at.top, bottom: at.bottom, width: MENU_W }}
              onClick={(e) => e.stopPropagation()}
            >
              {canJoin ? (
                <button data-track="invite" onClick={pick(invite)}>
                  <Icon id="i-server" /> Позвать играть
                </button>
              ) : null}
              {callSupported() ? (
                <button
                  className="call-start"
                  disabled={callBusy}
                  data-track="call"
                  onClick={pick(() => void callFriend(f.userId, nick))}
                >
                  <Icon id="i-phone" /> {callBusy ? 'Идёт звонок' : 'Позвонить'}
                </button>
              ) : null}
              <button data-track="friend_profile" onClick={pick(profile)}>
                <Icon id="i-user" /> Профиль
              </button>
              <button className="danger" data-track="friend_remove" onClick={onRemove}>
                <Icon id="i-trash" /> Убрать из друзей
              </button>
              <button className="danger" data-track="friend_block" onClick={onBlock}>
                <Icon id="i-ban" /> Заблокировать
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
