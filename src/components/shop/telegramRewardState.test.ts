import { describe, expect, test } from 'bun:test'
import type { TelegramReward } from '../../lib/rubies'
import { telegramLink, telegramStep, type TelegramStep } from './telegramRewardState'

const view = (over: Partial<TelegramReward>): TelegramReward => ({
  available: true,
  amount: 300,
  claimed: false,
  linked: true,
  botUrl: 'https://t.me/MillidaServiceBot',
  channelUrl: 'https://t.me/millida',
  ...over,
})

describe('telegramStep', () => {
  const cases: [TelegramReward | null, TelegramStep, string][] = [
    [null, 'hidden', 'old service without the route: no block at all'],
    [view({ available: false }), 'hidden', 'bot is not a channel admin yet: a button that never pays is worse than none'],
    [view({ amount: 0 }), 'hidden', 'zero reward is a misconfiguration, not an offer'],
    [view({ linked: false }), 'link', 'without a linked Telegram the service has no one to check'],
    [view({}), 'subscribe', 'linked player subscribes and presses check'],
    [view({ claimed: true, available: false }), 'claimed', 'paid players keep seeing the reward as taken even if the check is off'],
  ]
  for (const [input, verdict, why] of cases) {
    test(why, () => expect(telegramStep(input)).toBe(verdict))
  }
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
