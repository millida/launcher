import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiError'
import { trackFailure } from '../../lib/telemetry'
import { showToast } from '../../state/ui'
import { loadFriends } from '../../state/friends'
import type { FoundUser } from '../../state/friends'
import { norm } from './friendsView'
import { newFriend } from './RequestsTab'

const TECHNICAL_NICK = /^(skins|smx|guest|user)_\d{6,}$/i
export const isTechnicalNick = (nick?: string) => TECHNICAL_NICK.test((nick || '').trim())

export async function sendRequest(opts: Record<string, string>, clear: () => void) {
  try {
    const r = await api('/friends/request', { method: 'POST', body: JSON.stringify(opts) })
    if (r.status === 'accepted') newFriend(opts.nickname || r.nickname || '')
    else showToast(r.status === 'already_friends' ? 'Уже в друзьях' : 'Заявка отправлена')
  } catch (e) {
    // Сервер объясняет отказ сам: нет такого ника, человек уже в друзьях, он
    // закрыл заявки. Всё это раньше показывалось как «войди в аккаунт».
    const nick = (opts.nickname || '').trim()
    trackFailure('friends', nick ? String(e).split(nick).join('<nick>') : e, { step: 'request' })
    showToast(apiErrorText(e, 'Не удалось отправить заявку'), 'error')
    return
  } finally {
    void loadFriends()
  }
  clear()
}

/// Заявка тому, кого нашёл поиск Millida, идёт по id; по набранному нику — если
/// поиск такого не вернул (сервер сам скажет, что ника нет).
export const requestFor = (nick: string, found: FoundUser | null): Record<string, string> =>
  found?.userId ? { targetId: found.userId } : { nickname: found?.nickname || nick }

/**
 * Поиск по нику Millida за полем «Ник друга». Спрашивает сервер, только когда
 * набранное может стать заявкой; пока человек печатает — ждёт паузу.
 */
export function useNickLookup(nick: string): FoundUser[] {
  const [res, setRes] = useState<{ q: string; list: FoundUser[] }>({ q: '', list: [] })
  useEffect(() => {
    if (!nick) return
    let alive = true
    const t = setTimeout(() => {
      api('/friends/search?q=' + encodeURIComponent(nick))
        .then((r) => {
          if (!alive) return
          const list: FoundUser[] = (r?.results || []).filter((u: FoundUser) => !isTechnicalNick(u.nickname))
          setRes({ q: nick, list })
        })
        .catch(() => alive && setRes({ q: nick, list: [] }))
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [nick])
  return nick && res.q === nick ? res.list : []
}

export const exactOf = (nick: string, list: FoundUser[]): FoundUser | null =>
  list.find((u) => norm(u.nickname) === norm(nick)) || null

/**
 * «Добавить «ник»»: первая строка поиска, когда в списке такого нет. Ниже —
 * до трёх похожих ников из Millida: набранное могло быть с опечаткой.
 */
export function AddRows({
  nick,
  found,
  onSent,
  lead,
}: {
  nick: string
  found: FoundUser[]
  onSent: () => void
  /// Строка первая в выдаче — тогда её кнопка главная; под совпадениями — вторая.
  lead: boolean
}) {
  const exact = exactOf(nick, found)
  const similar = found
    .filter((u) => u !== exact && !u.isFriend && !u.pending && u.nickname)
    .slice(0, 3)
  const shown = exact?.nickname || nick
  return (
    <>
      <div className="fr-row fr-add">
        {/* Голова по набранному нику грузилась бы на каждую букву и у
            несуществующего ника оставалась пустым квадратом. */}
        <span className="room-ava fr-add-ic">
          <Icon id="i-user" />
        </span>
        <span className="fr-body">
          <span className="fr-nick">{shown}</span>
          <span className="fr-status">
            {exact?.isFriend ? 'Уже в друзьях' : exact?.pending ? 'Заявка отправлена' : 'Нет в друзьях'}
          </span>
        </span>
        {exact?.isFriend || exact?.pending ? null : (
          <button
            className={'btn sm fr-send ' + (lead ? 'primary' : 'secondary')}
            data-nick={shown}
            data-track="add_friend"
            data-private
            onClick={() => void sendRequest(requestFor(nick, exact), onSent)}
          >
            <Icon id="i-plus" />
            Добавить
          </button>
        )}
      </div>
      {similar.map((u) => (
        <div className="fr-row fr-add off" key={u.userId || u.nickname}>
          <Head nick={u.nickname} size={40} />
          <span className="fr-body">
            <span className="fr-nick">{u.nickname}</span>
            <span className="fr-status">{u.text || 'Игрок Millida'}</span>
          </span>
          <button
            className="btn sm secondary fr-send"
            data-nick={u.nickname}
            data-track="add_friend_similar"
            data-private
            onClick={() => void sendRequest(requestFor(u.nickname || '', u), onSent)}
          >
            <Icon id="i-plus" />
            Добавить
          </button>
        </div>
      ))}
    </>
  )
}
