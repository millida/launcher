import { describe, expect, it } from 'bun:test'
import { addCandidate, chatList, isMcNick } from './friendsView'
import type { Friend } from '../../state/friends'
import type { Room } from '../../state/rooms'

const friend = (p: Partial<Friend> & { userId: string }): Friend => ({ nickname: p.userId, ...p })
const room = (p: Partial<Room> & { id: string }): Room => ({ title: p.id, ownerId: 'me', members: [], ...p })

describe('поле «Ник друга»', () => {
  it('ник Minecraft — 3–16 символов латиницы, цифр и подчёркивания', () => {
    expect(isMcNick('Steve')).toBe(true)
    expect(isMcNick('ab')).toBe(false)
    expect(isMcNick('вася')).toBe(false)
    expect(isMcNick('a'.repeat(17))).toBe(false)
    expect(isMcNick('  Kir_228 ')).toBe(true)
  })

  it('не предлагает добавить того, кто уже друг, свой ник и уже отправленную заявку', () => {
    const friends = [friend({ userId: 'u1', nickname: 'Kirpich' })]
    const out = [{ id: 'r', nickname: 'PixelMaster' }]
    expect(addCandidate('kirpich', friends, out, 'Me')).toBe('')
    expect(addCandidate('me', friends, out, 'Me')).toBe('')
    expect(addCandidate('pixelmaster', friends, out, 'Me')).toBe('')
    expect(addCandidate('Kirp', friends, out, 'Me')).toBe('Kirp')
  })
})

describe('вкладка «Чаты»', () => {
  it('группы всегда, друзья — только с перепиской', () => {
    const items = chatList(
      [friend({ userId: 'пишет', lastMessageAt: 100 }), friend({ userId: 'молчит', lastMessageAt: null })],
      [room({ id: 'группа', lastMessageAt: 50 })],
      '',
    )
    expect(items.map((i) => i.key)).toEqual(['u:пишет', 'r:группа'])
  })

  it('без поля времени у всех — показывает всех друзей, непрочитанное сверху', () => {
    const items = chatList([friend({ userId: 'б' }), friend({ userId: 'а', unread: 1 })], [], '')
    expect(items.map((i) => i.title)).toEqual(['а', 'б'])
  })

  it('поиск находит группу по нику участника', () => {
    const items = chatList(
      [],
      [room({ id: 'г', title: 'Выживач', members: [{ userId: 'x', role: 'member', nickname: 'Grom228' }] })],
      'grom',
    )
    expect(items.length).toBe(1)
  })
})
