import { describe, expect, test } from 'bun:test'
import { maskProfanity } from './chatProfanity'

describe('chat swear filter', () => {
  const cases: Array<{ text: string; want: string; why: string }> = [
    { text: 'привет, как дела', want: 'привет, как дела', why: 'ordinary text is untouched' },
    { text: 'ну ты и сука', want: 'ну ты и с***', why: 'an obscene word is masked, the first letter stays' },
    { text: 'xуйня какая-то', want: 'x**** какая-то', why: 'Latin look-alikes do not get past it' },
    { text: 'what the fuck', want: 'what the f***', why: 'English swearing is masked too' },
    { text: 'купи хлеба и сукно', want: 'купи хлеба и сукно', why: 'words that only contain a root are not swearing' },
    { text: 'застрахуй дом', want: 'застрахуй дом', why: '«страхуй» must not be read as a swear word' },
    { text: 'сервер mc.ru:25565', want: 'сервер mc.ru:25565', why: 'addresses and numbers pass as they are' },
  ]
  for (const c of cases) test(c.why, () => expect(maskProfanity(c.text)).toBe(c.want))
})

describe('ban refusal in chat', () => {
  test('the server text with term and reason is shown, other errors are not', async () => {
    const { banReason } = await import('../state/chatSafety')
    expect(banReason(new Error('HTTP 403: Доступ к чатам ограничен. Причина: спам.'))).toBe('Доступ к чатам ограничен. Причина: спам.')
    expect(banReason(new Error('network down'))).toBeNull()
  })
})
