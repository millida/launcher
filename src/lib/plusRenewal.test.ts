import { expect, test } from 'bun:test'
import { plusReminderDue, plusReminderKey, plusRenews, type PlusReminderStage } from './plusRenewal'

const NOW = new Date(2026, 10, 20, 12, 0).getTime()
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString()

type DueCase = [why: string, active: boolean, paidUntil: string | null, renews: boolean, want: PlusReminderStage | null]

const DUE: DueCase[] = [
  ['the last day of a one-off month is "today"', true, at(20, 23), false, 'today'],
  ['three calendar days ahead already warns', true, at(23, 1), false, 'soon'],
  ['tomorrow is "soon", not "today"', true, at(21, 9), false, 'soon'],
  ['four days ahead is too early', true, at(24, 9), false, null],
  ['a renewing subscription needs no reminder', true, at(20, 23), true, null],
  ['an inactive PLUS has nothing to renew', false, at(21, 9), false, null],
  ['a period that already ended is not "today"', true, at(20, 11), false, null],
  ['no end date means no reminder', true, null, false, null],
  ['a broken end date means no reminder', true, 'not-a-date', false, null],
]

for (const [why, active, paidUntil, renews, want] of DUE) {
  test('PLUS reminder: ' + why, () => {
    expect(plusReminderDue({ active, paidUntil, renews, now: NOW })?.stage ?? null).toBe(want)
  })
}

test('PLUS reminder counts the days left on the player clock', () => {
  expect(plusReminderDue({ active: true, paidUntil: at(23, 1), renews: false, now: NOW })?.daysLeft).toBe(3)
  expect(plusReminderDue({ active: true, paidUntil: at(20, 23), renews: false, now: NOW })?.daysLeft).toBe(0)
})

type RenewCase = [why: string, status: { canceled: boolean; autoRenew?: boolean }, checkout: 'gateway' | 'balance', want: boolean]

const RENEWS: RenewCase[] = [
  ['a live gateway subscription renews', { canceled: false }, 'gateway', true],
  ['a cancelled gateway subscription does not', { canceled: true }, 'gateway', false],
  ['a month bought from the balance (rupees or dollars) never renews', { canceled: false }, 'balance', false],
  ['the server word wins when it is sent', { canceled: false, autoRenew: true }, 'balance', true],
  ['the server word wins over a live-looking status too', { canceled: false, autoRenew: false }, 'gateway', false],
]

for (const [why, status, checkout, want] of RENEWS) {
  test('PLUS renews: ' + why, () => {
    expect(plusRenews(status, checkout)).toBe(want)
  })
}

test('each stage of each paid period is reminded once', () => {
  const end = at(23, 1)
  expect(plusReminderKey(end, 'soon')).not.toBe(plusReminderKey(end, 'today'))
  expect(plusReminderKey(end, 'soon')).not.toBe(plusReminderKey(at(30, 1), 'soon'))
})
