import { Icon } from '../Icon'
import { Head } from '../Head'
import { api } from '../../lib/api'
import { showToast } from '../../state/ui'
import { loadFriends } from '../../state/friends'
import type { FriendRequest } from '../../state/friends'
import { apiErrorText } from '../../lib/apiError'
import { showReward } from '../reward/RewardReveal'

const post = (path: string, id: string) =>
  api(path, { method: 'POST', body: JSON.stringify({ id }) }).catch(() => {})

/** Новый друг — средний миг награды с его головой. */
export function newFriend(nick: string, avatar?: string | null) {
  showReward({
    level: 'mid',
    items: [{ name: nick, art: <Head nick={nick} src={avatar || undefined} size={56} /> }],
    kicker: 'Новый друг',
    title: nick || 'Новый друг',
    sub: 'Теперь в друзьях',
  })
}

/** Заявки: входящие и отправленные — двумя подсекциями одной вкладки. */
export function RequestsTab({ incoming, outgoing }: { incoming: FriendRequest[]; outgoing: FriendRequest[] }) {
  if (!incoming.length && !outgoing.length) {
    return (
      <div className="fr-blank">
        <Icon id="i-inbox" />
        <b>Заявок нет</b>
      </div>
    )
  }
  return (
    <>
      {incoming.length ? (
        <>
          <div className="fr-cap">{'Входящие · ' + incoming.length}</div>
          {incoming.map((r) => (
            <div className="fr-row" key={r.id}>
              <Head nick={r.nickname} src={r.avatarUrl || undefined} size={40} />
              <span className="fr-body">
                <span className="fr-nick">{r.nickname || ''}</span>
                <span className="fr-status">Хочет в друзья</span>
              </span>
              <button
                className="btn sm primary fr-acc"
                data-id={r.id}
                data-track="friend_accept"
                onClick={() =>
                  // Раньше «Теперь в друзьях» показывалось и при ошибке: post глотал её.
                  void api('/friends/accept', { method: 'POST', body: JSON.stringify({ id: r.id }) })
                    .then(() => newFriend(r.nickname || '', r.avatarUrl))
                    .catch((e) => showToast(apiErrorText(e, 'Не удалось принять заявку'), 'error'))
                    .finally(() => void loadFriends())
                }
              >
                <Icon id="i-check" />
                Принять
              </button>
              <button
                className="btn sm secondary fr-dec"
                data-id={r.id}
                data-track="friend_decline"
                onClick={() => void post('/friends/decline', r.id).finally(() => void loadFriends())}
              >
                <Icon id="i-x" />
                Отклонить
              </button>
            </div>
          ))}
        </>
      ) : null}
      {outgoing.length ? (
        <>
          <div className="fr-cap">{'Отправленные · ' + outgoing.length}</div>
          {outgoing.map((r) => (
            <div className="fr-row off" key={r.id}>
              <Head nick={r.nickname} src={r.avatarUrl || undefined} size={40} />
              <span className="fr-body">
                <span className="fr-nick">{r.nickname || ''}</span>
                <span className="fr-status">Ждёт ответа</span>
              </span>
              <button
                className="btn sm secondary fr-cancel"
                data-id={r.id}
                data-track="friend_request_cancel"
                onClick={() => void post('/friends/cancel', r.id).finally(() => void loadFriends())}
              >
                <Icon id="i-x" />
                Отменить
              </button>
            </div>
          ))}
        </>
      ) : null}
    </>
  )
}
