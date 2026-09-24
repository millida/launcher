import { create } from 'zustand'
import { api, hasMillidaAccount } from '../lib/api'

/**
 * Часы в игре у друзей.
 *
 * Список `/friends` часов не отдаёт — они лежат только в профиле
 * (`/friends/profile/:id` → `stats.totalSeconds`, см. `FriendStats`). Поэтому
 * список добирает их по одному, по три запроса за раз, и держит ответ до конца
 * сессии: без этого нельзя ни показать часы в строке, ни сделать срез «кто
 * больше играет».
 *
 * `null` — часов нет: либо друг не играл через лаунчер, либо закрыл показ
 * наигранного в приватности. Отличать эти два случая сервер не даёт, и
 * выдумывать разницу интерфейс не будет: просто не показывает число.
 */
interface HoursState {
  sec: Record<string, number | null>
}

export const useFriendHours = create<HoursState>(() => ({ sec: {} }))

const PARALLEL = 3
const queue: string[] = []
const inflight = new Set<string>()

const put = (userId: string, seconds: number | null) =>
  useFriendHours.setState((s) => ({ sec: { ...s.sec, [userId]: seconds } }))

interface ProfileReply {
  stats?: { totalSeconds?: number | null } | null
}

function pump() {
  while (inflight.size < PARALLEL && queue.length) {
    const id = queue.shift() as string
    inflight.add(id)
    void api<ProfileReply>('/friends/profile/' + encodeURIComponent(id))
      .then((p) => {
        const total = p && p.stats ? p.stats.totalSeconds : null
        put(id, typeof total === 'number' && total > 0 ? total : null)
      })
      .catch(() => put(id, null))
      .finally(() => {
        inflight.delete(id)
        pump()
      })
  }
}

/** Просит часы для тех, о ком ещё не спрашивали. Повторный вызов бесплатен. */
export function loadFriendHours(ids: (string | undefined)[]): void {
  if (!hasMillidaAccount()) return
  const known = useFriendHours.getState().sec
  for (const id of ids) {
    if (!id || id in known || inflight.has(id) || queue.includes(id)) continue
    queue.push(id)
  }
  pump()
}

/** Секунды друга или null, пока ответа нет. */
export const hoursOf = (sec: Record<string, number | null>, userId: string): number | null =>
  sec[userId] ?? null
