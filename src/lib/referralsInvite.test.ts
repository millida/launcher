import { beforeEach, expect, mock, test } from 'bun:test'

mock.module('./api', () => ({ api: async () => ({}) }))

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const { dropInviteCode, peekInviteCode, rememberInviteCode, takeInviteCode, tierRewardText, withInviteRef } = await import('./referrals')

beforeEach(() => store.clear())

test('invite code from a link survives until it is taken', () => {
  rememberInviteCode(' ab-cd 2345 ')
  expect(peekInviteCode()).toBe('ABCD2345')
  expect(peekInviteCode()).toBe('ABCD2345')
  expect(takeInviteCode()).toBe('ABCD2345')
  expect(peekInviteCode()).toBe('')
})

test('the web login page gets the code as ref, once', () => {
  expect(withInviteRef('https://millida.net/auth/launcher?code=X')).toBe('https://millida.net/auth/launcher?code=X')
  rememberInviteCode('ABCD2345')
  expect(withInviteRef('https://millida.net/auth/launcher?code=X')).toBe('https://millida.net/auth/launcher?code=X&ref=ABCD2345')
  expect(withInviteRef('https://millida.net/auth/launcher?ref=OTHER')).toBe('https://millida.net/auth/launcher?ref=OTHER')
  dropInviteCode()
  expect(peekInviteCode()).toBe('')
})

test('tier text lists the icon, the chest and the PLUS days', () => {
  expect(
    tierRewardText({ plusDays: 14, chestName: null, perks: [{ id: 'icon-spark', kind: 'icon', name: 'Искра' }] }),
  ).toBe('Иконка «Искра» + 14 дней PLUS')
})
