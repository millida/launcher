import { describe, expect, test } from 'bun:test'
import { ONEBLOCK_PACK, isExclusive } from './data'

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
