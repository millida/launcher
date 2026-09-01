import { describe, expect, it } from 'bun:test'
import { chatItems, chatWhen, unreadOf } from './overlayChats'
import type { Friend } from '../state/friends'
import type { Room } from '../state/rooms'

const friend = (p: Partial<Friend> & { userId: string }): Friend => ({ nickname: p.userId, ...p })

const room = (p: Partial<Room> & { id: string }): Room => ({
  title: p.id,
  ownerId: 'me',
  members: [],
  ...p,
})

// Вход → вердикт. Список переписок в оверлее открыт поверх игры: неверный
// порядок здесь стоит человеку не «неудобства», а пропущенного сообщения — до
// второй строки в бою никто не долистывает.
describe('список переписок оверлея', () => {
  it('непрочитанное поднимается выше свежего прочитанного', () => {
    const items = chatItems(
      [
        friend({ userId: 'свежий', lastMessageAt: 900 }),
        friend({ userId: 'непрочитанный', lastMessageAt: 100, unread: 2 }),
      ],
      [],
    )
    expect(items.map((i) => i.title)).toEqual(['непрочитанный', 'свежий'])
  })

  it('группы и личка в одном списке, порядок решает время последнего сообщения', () => {
    const items = chatItems(
      [friend({ userId: 'друг', lastMessageAt: 100 })],
      [room({ id: 'группа', lastMessageAt: 500 })],
    )
    expect(items.map((i) => i.key)).toEqual(['r:группа', 'u:друг'])
  })

  it('без переписки сверху стоит тот, кто в сети', () => {
    const items = chatItems([friend({ userId: 'офлайн' }), friend({ userId: 'онлайн', online: true })], [])
    expect(items[0].title).toBe('онлайн')
  })

  it('поиск фильтрует без учёта регистра и пробелов по краям', () => {
    const items = chatItems([friend({ userId: 'Steve' }), friend({ userId: 'Alex' })], [], '  st ')
    expect(items.map((i) => i.title)).toEqual(['Steve'])
  })

  it('счётчик в шапке складывает личку и группы', () => {
    const items = chatItems([friend({ userId: 'друг', unread: 3 })], [room({ id: 'группа', unread: 4 })])
    expect(unreadOf(items)).toBe(7)
  })

  it('подпись группы считает участников, а голосовой канал вытесняет её', () => {
    const members = [
      { userId: 'a', role: 'owner', nickname: 'a' },
      { userId: 'b', role: 'member', nickname: 'b' },
    ]
    const [quiet] = chatItems([], [room({ id: 'тихая', members })])
    const [loud] = chatItems([], [room({ id: 'голос', members, voice: [{ userId: 'a', since: 0, muted: false, screen: false }] })])
    expect(quiet.subtitle).toBe('2 участника')
    expect(loud.subtitle).toBe('1 в голосовом')
  })

  const day = 86_400_000
  const now = new Date('2026-08-31T21:30:00').getTime()
  const whenCases: Array<[string, number, string]> = [
    ['сегодня показываем часы — по ним видно, насколько свежее сообщение', now - 3_600_000, '20:30'],
    ['вчерашнее время вводит в заблуждение: пишем словом', now - day, 'вчера'],
    ['всё старше — дата, иначе «23:53» выглядит как только что', now - 5 * day, '26 авг'],
    ['переписки не было — колонка пустая', 0, ''],
  ]
  for (const [why, ts, want] of whenCases) {
    it('время в строке: ' + why, () => {
      expect(chatWhen(ts, now)).toBe(want)
    })
  }
})
