import { describe, expect, test } from 'bun:test'
import { matchFriends } from './friendMatch'
import type { Friend } from '../../state/friends'

const friends: Friend[] = [{ userId: '1', nickname: 'Steve' }, { userId: '2', nickname: 'alex_PRO' }, { userId: '3' }]

describe('gift friend search', () => {
  const cases: Array<{ query: string; want: string[]; why: string }> = [
    { query: '', want: ['1', '2'], why: 'an empty search lists every friend that has a nickname to show' },
    { query: 'pro', want: ['2'], why: 'the nickname matches regardless of case' },
    { query: '  ste ', want: ['1'], why: 'spaces around the query do not hide the friend' },
    { query: 'zzz', want: [], why: 'no match gives an empty list, the picker then says so' },
  ]
  for (const c of cases) test(c.why, () => expect(matchFriends(friends, c.query).map((f) => f.userId)).toEqual(c.want))
})
