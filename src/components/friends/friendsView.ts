import { chatItems } from '../../lib/overlayChats'
import type { OverlayChatItem } from '../../lib/overlayChats'
import type { Friend, FriendRequest } from '../../state/friends'
import type { Room } from '../../state/rooms'

/**
 * Экран «Друзья» делится на две вкладки: друзья и заявки. Переписки и группы
 * ушли на свой экран «Сообщения» (владелец 24.09.2026: «группы — в разделе
 * чата, как в Telegram»). Запомненная раньше вкладка «Чаты» читается как
 * «Друзья».
 */
export type FriendsTab = 'friends' | 'requests'

const TAB_KEY = 'm-friends-tab'
const TABS: FriendsTab[] = ['friends', 'requests']

export function loadTab(): FriendsTab {
  try {
    const v = localStorage.getItem(TAB_KEY) as FriendsTab | null
    return v && TABS.includes(v) ? v : 'friends'
  } catch {
    return 'friends'
  }
}

export function saveTab(tab: FriendsTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    /* приватное окно или запрет хранилища — вкладка просто не запомнится */
  }
}

/// Ник Minecraft: 3–16 символов латиницы, цифр и подчёркивания. Только такую
/// строку поле предлагает отправить заявкой — «вася петя» заявкой не станет.
const MC_NICK = /^[A-Za-z0-9_]{3,16}$/
export const isMcNick = (s: string): boolean => MC_NICK.test(s.trim())

export const norm = (s?: string | null): string => (s || '').trim().toLowerCase()

export const matchFriend = (f: Friend, needle: string): boolean =>
  !needle || norm(f.nickname).includes(needle) || norm(f.gameNick).includes(needle)

export const matchRequest = (r: FriendRequest, needle: string): boolean =>
  !needle || norm(r.nickname).includes(needle)

/**
 * Переписки одним списком: личка и группы соревнуются за одно внимание.
 * Порядок — тот же, что у списка в оверлее (lib/overlayChats): непрочитанное
 * сверху, дальше по времени последнего сообщения, без него — кто в сети, по имени.
 *
 * В список попадают все группы и те друзья, с кем уже есть переписка. Если сервер
 * не прислал время последнего сообщения ни у кого (старый ответ без поля), отличить
 * «переписка есть» от «нет» нечем — тогда показываются все друзья, а не пустота.
 */
export function chatList(friends: Friend[], rooms: Room[], needle: string): OverlayChatItem[] {
  const knowsTs = friends.some((f) => 'lastMessageAt' in f)
  const talked = knowsTs ? friends.filter((f) => f.lastMessageAt || f.unread) : friends
  const members = new Map(rooms.map((r) => [r.id, r.members.map((m) => norm(m.nickname))]))
  return chatItems(talked, rooms).filter(
    (i) =>
      !needle ||
      norm(i.title).includes(needle) ||
      (i.room && (members.get(i.id) || []).some((n) => n.includes(needle))),
  )
}

/**
 * Строка «Добавить «ник»» появляется, когда набранное похоже на ник и такого
 * человека нет ни в друзьях, ни в отправленных заявках, и это не свой ник.
 */
export function addCandidate(
  q: string,
  friends: Friend[],
  reqOut: FriendRequest[],
  myNick: string,
): string {
  const nick = q.trim()
  if (!isMcNick(nick)) return ''
  const n = norm(nick)
  if (n === norm(myNick)) return ''
  if (friends.some((f) => norm(f.nickname) === n || norm(f.gameNick) === n)) return ''
  if (reqOut.some((r) => norm(r.nickname) === n)) return ''
  return nick
}

/** Открыть «Друзья» на нужной вкладке (уведомление о заявке — сразу «Заявки»). */
export const FRIENDS_TAB_EVENT = 'm-friends-tab'
export function pickFriendsTab(tab: FriendsTab) {
  saveTab(tab)
  window.dispatchEvent(new CustomEvent(FRIENDS_TAB_EVENT, { detail: tab }))
}
