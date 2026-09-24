import { create } from 'zustand'
import { api, hasMillidaAccount } from '../lib/api'
import { encodeInvite } from '../lib/invite'
import { openChat, openRoomChat } from './friends'
import { setScreen, showToast } from './ui'

/**
 * «Позвать играть» (владелец 24.09.2026, 13:33): есть свой сервер Millida —
 * приглашение уходит сразу; нет — человек попадает в создание сервера, а
 * приглашение ждёт и уходит само, как только у нового сервера появится адрес.
 *
 * Отдельной ручки приглашения у сервера нет: приглашение — сообщение в чат
 * формата lib/invite (карточка «Зайти» у получателя), как и из «Хостинга».
 */
export interface MyServer {
  id: string
  name?: string
  address?: string
  status?: string
  version?: string
}

export interface InviteTarget {
  id: string
  nick: string
  /// Группа: приглашение уходит в её переписку.
  room?: boolean
}

interface PlayInviteState {
  servers: MyServer[] | null
  at: number
  /// Кого позвать, когда сервер будет готов. Живёт до перезапуска лаунчера:
  /// через час «позови Кирпича» уже ничего не значит.
  pending: (InviteTarget & { at: number }) | null
}

export const usePlayInvite = create<PlayInviteState>(() => ({ servers: null, at: 0, pending: null }))

const PENDING_TTL = 60 * 60_000

/** Хостинг сам грузит список — отдаёт его сюда, чтобы не спрашивать дважды. */
export function noteMyServers(list: MyServer[]) {
  usePlayInvite.setState({ servers: list, at: Date.now() })
  void deliverPendingInvite(list)
}

export async function loadMyServers(maxAgeMs = 60_000): Promise<MyServer[]> {
  const s = usePlayInvite.getState()
  if (s.servers && Date.now() - s.at < maxAgeMs) return s.servers
  if (!hasMillidaAccount()) return []
  try {
    const r = await api<MyServer[]>('/hosting/servers/me')
    const list = Array.isArray(r) ? r : []
    usePlayInvite.setState({ servers: list, at: Date.now() })
    return list
  } catch {
    return s.servers || []
  }
}

/** Куда звать: запущенный сервер с адресом, иначе любой с адресом. */
export const inviteServer = (list: MyServer[]): MyServer | null =>
  list.find((x) => x.address && x.status === 'RUNNING') || list.find((x) => x.address) || null

export const serverTitle = (s: MyServer) => s.name || 'Мой сервер'

async function postInvite(t: InviteTarget, s: MyServer) {
  const text = encodeInvite(s.address || '', serverTitle(s).slice(0, 48), s.version)
  const path = t.room
    ? '/friends/rooms/' + encodeURIComponent(t.id) + '/chat'
    : '/friends/chat/' + encodeURIComponent(t.id)
  await api(path, { method: 'POST', body: JSON.stringify({ text }) })
}

const openTarget = (t: InviteTarget) => void (t.room ? openRoomChat(t.id, t.nick) : openChat(t.id, t.nick))

export async function sendServerInvite(t: InviteTarget, s: MyServer): Promise<boolean> {
  try {
    await postInvite(t, s)
  } catch {
    showToast('Приглашение не ушло — попробуй ещё раз', 'error')
    return false
  }
  showToast('Позвали ' + t.nick + ' на «' + serverTitle(s) + '»', 'ok', undefined, {
    label: 'Открыть чат',
    run: () => openTarget(t),
  })
  return true
}

/** Своего сервера нет — в создание, приглашение подождёт. */
export function inviteViaNewServer(t: InviteTarget) {
  usePlayInvite.setState({ pending: { ...t, at: Date.now() } })
  setScreen('hosting')
}

export async function invitePlay(t: InviteTarget) {
  const list = await loadMyServers(15_000)
  const s = inviteServer(list)
  if (s) {
    await sendServerInvite(t, s)
    return
  }
  inviteViaNewServer(t)
}

export const cancelPendingInvite = () => usePlayInvite.setState({ pending: null })

let delivering = false

/** Вызывается с каждым свежим списком серверов (хостинг опрашивает его сам). */
export async function deliverPendingInvite(list: MyServer[]) {
  const p = usePlayInvite.getState().pending
  if (!p || delivering) return
  if (Date.now() - p.at > PENDING_TTL) {
    cancelPendingInvite()
    return
  }
  const s = inviteServer(list)
  if (!s) return
  delivering = true
  try {
    if (await sendServerInvite(p, s)) cancelPendingInvite()
  } finally {
    delivering = false
  }
}
