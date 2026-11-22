import { expect, test } from 'bun:test'
import { daysText, friendStatusText, normalizeInviteCode, tierProgress, tierRewardText } from './referrals'
import { colFill, trackPos } from '../components/friends/inviteTrackPos'

const TWO_HOURS = 7200

const statusCases: Array<[string, Parameters<typeof friendStatusText>[0], string]> = [
  ['counted friend reads as counted', { status: 'qualified', wait: null, playSeconds: TWO_HOURS }, 'Засчитан'],
  ['rejected friend never shows the fraud reason', { status: 'rejected', wait: null, playSeconds: 0 }, 'Не засчитан'],
  ['friend without a confirmed email is told what blocks him', { status: 'pending', wait: 'email', playSeconds: TWO_HOURS }, 'Ждёт подтверждения почты'],
  ['daily cap reads as a delay, not a refusal', { status: 'pending', wait: 'queue', playSeconds: TWO_HOURS }, 'Засчитаем в ближайшие сутки'],
  ['playing friend shows progress to the threshold', { status: 'pending', wait: 'play', playSeconds: 45 * 60 }, 'Играет 0:45 из 2:00'],
]
for (const [why, friend, text] of statusCases) test(why, () => expect(friendStatusText(friend, TWO_HOURS)).toBe(text))

const tiers = [{ friends: 1 }, { friends: 3 }, { friends: 5 }, { friends: 10 }]
const progressCases: Array<[string, number, number]> = [
  ['nobody yet is an empty bar', 0, 0],
  ['between 1 and 3 the bar is half way', 2, 0.5],
  ['a reached tier starts the next segment from zero', 5, 0],
  ['past the last tier the bar stays full', 12, 1],
]
for (const [why, qualified, value] of progressCases) test(why, () => expect(tierProgress(qualified, tiers)).toBe(value))

test('dictated code with spaces and lowercase still matches', () => expect(normalizeInviteCode(' ab cd-23xy ')).toBe('ABCD23XY'))
test('reward line joins chest and PLUS days', () =>
  expect(tierRewardText({ plusDays: 30, chestName: 'Редкий сундук' })).toBe('Редкий сундук + 30 дней PLUS'))
test('Russian plural of days', () => {
  expect(daysText(1)).toBe('1 день')
  expect(daysText(3)).toBe('3 дня')
  expect(daysText(14)).toBe('14 дней')
  expect(daysText(21)).toBe('21 день')
})

test('invite track fills between steps by friends counted', () => {
  const tiers = [1, 3, 5, 10, 25, 50].map((friends) => ({ friends }))
  expect(trackPos(0, tiers)).toBe(-0.5)
  expect(trackPos(1, tiers)).toBe(0)
  expect(trackPos(2, tiers)).toBe(0.5)
  expect(trackPos(50, tiers)).toBe(5.5)
  expect(trackPos(80, tiers)).toBe(5.5)
  const pos = trackPos(2, tiers)
  expect([0, 1, 2].map((i) => colFill(pos, i))).toEqual([1, 0, 0])
  expect(colFill(trackPos(4, tiers), 2)).toBe(0)
  expect(colFill(trackPos(7, tiers), 2)).toBeCloseTo(0.9)
})
