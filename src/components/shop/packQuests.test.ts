import { describe, expect, test } from 'bun:test'
import type { PackQuest } from '../../lib/rubies'
import { minuteWord, questPct, questState, questsToShow } from './packQuests'

const quest = (over: Partial<PackQuest>): PackQuest => ({
  code: 'oneblock_1h',
  title: 'Наиграй час в OneBlock',
  pack: 'oneblock-metalabs',
  packName: 'OneBlock',
  minutes: 0,
  needMinutes: 60,
  done: false,
  claimed: false,
  item: { code: 'CLOUD_WINGS', name: 'Облачные крылья', slot: 'WINGS', rarity: 'EPIC', preview: null },
  owned: false,
  fragments: null,
  ...over,
})

describe('questState', () => {
  const cases: [Partial<PackQuest>, ReturnType<typeof questState>, string][] = [
    [{}, { kind: 'play', left: 60 }, 'fresh quest asks for the whole hour'],
    [{ minutes: 59 }, { kind: 'play', left: 1 }, 'one minute left is still play, never a claim button'],
    [{ minutes: 60, done: false }, { kind: 'play', left: 1 }, 'the server verdict decides, not rounded minutes'],
    [{ minutes: 60, done: true }, { kind: 'claim' }, 'done and unclaimed shows the claim button'],
    [{ minutes: 60, done: true, claimed: true }, { kind: 'claimed' }, 'claimed must hide the button, otherwise a double claim is offered'],
    [{ owned: true }, { kind: 'owned' }, 'an owner of the item has nothing to earn'],
    [{ owned: true, claimed: true }, { kind: 'claimed' }, 'claimed wins over owned: the claim already happened'],
  ]
  test.each(cases)('%p -> %p (%s)', (over, expected, why) => {
    expect({ why, state: questState(quest(over)) }).toEqual({ why, state: expected })
  })
})

describe('questPct', () => {
  const cases: [Partial<PackQuest>, number, string][] = [
    [{ minutes: 30 }, 50, 'half an hour is half the bar'],
    [{ minutes: 90 }, 100, 'the bar never overflows its well'],
    [{ minutes: -3 }, 0, 'a broken counter never draws a negative bar'],
    [{ needMinutes: 0 }, 100, 'zero target must not divide by zero'],
  ]
  test.each(cases)('%p -> %p (%s)', (over, expected, why) => {
    expect({ why, pct: questPct(quest(over)) }).toEqual({ why, pct: expected })
  })
})

describe('minuteWord', () => {
  const cases: [number, string][] = [
    [1, 'минута'],
    [2, 'минуты'],
    [5, 'минут'],
    [11, 'минут'],
    [21, 'минута'],
    [44, 'минуты'],
  ]
  test.each(cases)('%p -> %p', (n, expected) => {
    expect(minuteWord(n)).toBe(expected)
  })
})

describe('questsToShow', () => {
  test('an old service without the endpoint shape yields no block instead of a crash', () => {
    expect(questsToShow(null)).toEqual([])
    expect(questsToShow({})).toEqual([])
    expect(questsToShow({ quests: 'x' })).toEqual([])
  })
  test('rows without an item are dropped: the card cannot draw them', () => {
    expect(questsToShow({ quests: [quest({}), { code: 'broken' }] }).map((q) => q.code)).toEqual(['oneblock_1h'])
  })
})
