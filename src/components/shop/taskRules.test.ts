import { describe, expect, test } from 'bun:test'
import type { DiscordReward, TelegramReward } from '../../lib/rubies'
import { claimFailure, discordInvite, noneOpened, OPENED_TTL_MS, parseOpened, serializeOpened, STEP_FILL, taskStep, telegramLink, totalReward, type TaskFailure, type TaskOpened, type TaskStep } from './taskRules'

const tg = (over: Partial<TelegramReward>): TelegramReward => ({
  available: true,
  amount: 300,
  claimed: false,
  linked: true,
  botUrl: 'https://t.me/MillidaServiceBot',
  channelUrl: 'https://t.me/millida',
  ...over,
})
const dc = (over: Partial<DiscordReward>): DiscordReward => ({
  available: true,
  amount: 300,
  claimed: false,
  linked: true,
  inviteUrl: 'https://discord.gg/ec8xAhDSH7',
  ...over,
})
const none: TaskOpened = { link: false, join: false }

describe('taskStep', () => {
  const cases: [TelegramReward | null, TaskOpened, TaskStep, string][] = [
    [null, none, 'hidden', 'old service without the route: no block at all'],
    [tg({ available: false }), none, 'hidden', 'bot is not a channel admin yet: a button that never pays is worse than none'],
    [tg({ amount: 0 }), none, 'hidden', 'zero reward is a misconfiguration, not an offer'],
    [tg({ claimed: true }), none, 'hidden', 'a paid reward leaves the shop: the block only took space after the claim'],
    [tg({ claimed: true, available: false }), none, 'hidden', 'a paid reward stays hidden even with the check off'],
    [tg({ linked: false }), none, 'link', 'without a linked account the service has no one to check'],
    [tg({ linked: false }), { link: true, join: false }, 'link-wait', 'the link is open: wait for the player to come back'],
    [tg({ linked: false }), { link: true, join: true }, 'link-wait', 'an unlinked account never skips to the check'],
    [tg({}), none, 'join', 'linked player subscribes first'],
    [tg({}), { link: true, join: false }, 'join', 'the linking is done, the subscription is not'],
    [tg({}), { link: false, join: true }, 'check', 'the channel was opened: only the check is left'],
  ]
  for (const [view, opened, verdict, why] of cases) {
    test(why, () => expect(taskStep(view, opened)).toBe(verdict))
  }
  test('the same rules hold for Discord', () => {
    expect(taskStep(dc({ linked: false }), none)).toBe('link')
    expect(taskStep(dc({}), none)).toBe('join')
    expect(taskStep(dc({}), { link: false, join: true })).toBe('check')
    expect(taskStep(dc({ claimed: true }), none)).toBe('hidden')
  })
})

test('the bar fills one segment per finished step and never reaches the end before the claim', () => {
  expect(STEP_FILL).toEqual({ link: 0, 'link-wait': 0, join: 1, check: 2 })
})

describe('claimFailure', () => {
  const cases: [unknown, TaskFailure, string][] = [
    [new Error('http 400'), 'miss', 'not subscribed yet is a plain 400'],
    [new Error('Подписки на канал пока не видно: подпишись и нажми «Проверить» ещё раз'), 'miss', 'the core passes the server text'],
    [new Error('http 409'), 'taken', 'the browser sees only the status'],
    [new Error('Этот Telegram уже получил награду за подписку на другом аккаунте Millida'), 'taken', 'the core passes the server text'],
    [new Error('http 503'), 'net', 'Telegram did not answer the check'],
    [new Error('Telegram не ответил на проверку подписки, попробуй через минуту'), 'net', 'the same, with the server text'],
    [new Error('Failed to fetch'), 'net', 'no connection'],
    [new Error('нет связи'), 'net', 'no connection from the core'],
    [new Error('http 401'), 'auth', 'an expired sign-in is not a missing subscription'],
    [new Error('http 403'), 'auth', 'a refused session is not a missing subscription'],
    [new Error('Unauthorized'), 'auth', 'the browser wording'],
  ]
  for (const [err, verdict, why] of cases) {
    test(why, () => expect(claimFailure(err)).toBe(verdict))
  }
})

describe('totalReward', () => {
  test('sums only the tasks that can still pay', () => {
    expect(totalReward([tg({}), dc({})])).toBe(600)
    expect(totalReward([tg({ claimed: true }), dc({})])).toBe(300)
    expect(totalReward([null, dc({ available: false })])).toBe(0)
  })
})

describe('telegramLink', () => {
  const cases: [unknown, string | null, string][] = [
    ['https://t.me/millida', 'https://t.me/millida', 'channel link opens'],
    ['https://t.me/MillidaServiceBot?start=abc', 'https://t.me/MillidaServiceBot?start=abc', 'bot link keeps its link token'],
    ['http://t.me/millida', null, 'plain http is refused'],
    ['https://t.me.evil.com/millida', null, 'look-alike host is refused'],
    ['javascript:alert(1)', null, 'script scheme from the network is refused'],
    [42, null, 'non-string from a broken response is refused'],
  ]
  for (const [input, verdict, why] of cases) {
    test(why, () => expect(telegramLink(input)).toBe(verdict))
  }
})

describe('discordInvite', () => {
  const cases: [unknown, string | null, string][] = [
    ['https://discord.gg/ec8xAhDSH7', 'https://discord.gg/ec8xAhDSH7', 'invite opens'],
    ['https://discord.com/invite/x', 'https://discord.com/invite/x', 'long invite opens'],
    ['http://discord.gg/x', null, 'plain http is refused'],
    ['https://discord.gg.evil.com/x', null, 'look-alike host is refused'],
    [undefined, null, 'a missing field from an old service is refused'],
  ]
  for (const [input, verdict, why] of cases) {
    test(why, () => expect(discordInvite(input)).toBe(verdict))
  }
})

describe('opened steps survive a rebuilt window, but not for long', () => {
  const now = 1_000_000_000_000
  const opened = { telegram: { link: true, join: false }, discord: { link: false, join: true } }
  test('saved a minute ago: the steps come back', () => {
    expect(parseOpened(serializeOpened(opened, now - 60_000), now)).toEqual(opened)
  })
  test('saved over the time limit ago: nothing is remembered', () => {
    expect(parseOpened(serializeOpened(opened, now - OPENED_TTL_MS - 1), now)).toEqual(noneOpened())
  })
  test('a clock set back, a broken string or no record: nothing is remembered', () => {
    expect(parseOpened(serializeOpened(opened, now + 5000), now)).toEqual(noneOpened())
    expect(parseOpened('{broken', now)).toEqual(noneOpened())
    expect(parseOpened(null, now)).toEqual(noneOpened())
  })
})
