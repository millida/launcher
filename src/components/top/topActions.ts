import { api, hasMillidaAccount } from '../../lib/api'
import { apiErrorText } from '../../lib/apiError'
import { logoutToLogin } from '../../lib/session'
import { showToast } from '../../state/ui'
import { openChat, useFriends } from '../../state/friends'
import { sendRequest } from '../friends/FriendSearch'
import { useBoards, type BoardEntry } from '../../state/boards'

/** userId друга по нику: доска отдаёт только ник, а переписка адресуется id. */
export const friendIdOf = (nick: string): string | null =>
  useFriends.getState().friends.find((f) => (f.nickname || '').toLowerCase() === nick.toLowerCase())?.userId ?? null

const signed = (): boolean => {
  if (hasMillidaAccount()) return true
  logoutToLogin()
  return false
}

/** «♥»: лайк профиля (POST /users/:slug/like). Причину отказа говорит служба. */
export async function likeEntry(e: BoardEntry): Promise<boolean> {
  if (!signed() || !e.slug) return false
  try {
    const r = await api<{ liked?: boolean; likes?: number }>('/users/' + encodeURIComponent(e.slug) + '/like', { method: 'POST' })
    if (typeof r?.likes === 'number') useBoards.getState().bumpLikes(e.slug, r.likes)
    return true
  } catch (err) {
    showToast(apiErrorText(err, 'Лайк не поставился'), 'error')
    return false
  }
}

export function addFriend(e: BoardEntry) {
  if (!signed()) return
  void sendRequest({ nickname: e.nick }, () => {})
}

export function writeTo(e: BoardEntry) {
  const id = friendIdOf(e.nick)
  if (id) void openChat(id, e.nick)
}
