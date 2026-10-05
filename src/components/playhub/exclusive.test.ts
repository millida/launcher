import { describe, expect, test } from 'bun:test'
import { ONEBLOCK_PACK, isExclusive, isOwnServerPack, ownServerTagline } from './data'

const cases: Array<[string | null | undefined, boolean, string]> = [
  [ONEBLOCK_PACK, true, 'the OneBlock catalog pack wears the purple badge in For You, catalog rows and the lobby card'],
  ['ONEBLOCK', true, 'the OneBlock mode tile wears the same badge as the pack'],
  ['MCRU_ANARCHY', true, 'our anarchy tile opens «Режимы» as the exclusive'],
  ['ANARCHY', false, 'the rating category of foreign anarchy servers is not ours and must not wear the badge'],
  ['arcania', false, 'Arcania is premium, not exclusive: two badges on one card would contradict each other'],
  ['oneblock', false, 'mode codes are upper case; a lower-case slug is some other pack'],
  ['', false, 'an empty slug from a broken card must not light the badge'],
  [null, false, 'a card without slug must not light the badge'],
  [undefined, false, 'a card without slug must not light the badge'],
]

describe('isExclusive', () => {
  for (const [key, want, why] of cases)
    test(String(key), () => {
      expect(isExclusive(key), why).toBe(want)
    })
})

const ownCases: Array<[string | null | undefined, boolean, string]> = [
  ['prisonrpg', true, 'PrisonRPG is our server with MetaLabs: the feed card says «Наш сервер», not «Сборка»'],
  ['PrisonRPG', false, 'catalogue slugs are lower case; another spelling is some other pack'],
  [ONEBLOCK_PACK, false, 'OneBlock has its own tile with the badge; its pack card must not get a second one'],
  ['arcania', false, 'a partner premium pack is not a server we run'],
  ['', false, 'an empty slug from a broken card must not light the badge'],
  [null, false, 'a card without slug must not light the badge'],
]

describe('isOwnServerPack', () => {
  for (const [slug, want, why] of ownCases)
    test(String(slug), () => {
      expect(isOwnServerPack(slug), why).toBe(want)
    })
})

describe('ownServerTagline', () => {
  const cases: Array<[string | null | undefined, string | undefined, string]> = [
    ['prisonrpg', 'Прокопайся до ранга SSS+', 'the card line replaces «custom · native», which reads as garbage to a player'],
    ['arcania', undefined, 'other packs keep their loader and version line'],
    [null, undefined, 'a card without slug falls back to the usual line'],
  ]
  for (const [slug, want, why] of cases)
    test(String(slug), () => {
      expect(ownServerTagline(slug), why).toBe(want)
    })
})
