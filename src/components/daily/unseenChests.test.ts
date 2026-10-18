import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { PendingChest } from '../../lib/rubies'

mock.module('../../state/accounts', () => ({ MILLIDA_USER_KEY: 'm-millida-uid' }))

const { chestsToReplay, forgetUnseen, markUnseen, parseUnseen, readUnseen, withUnseen } = await import('./unseenChests')

const chest = (id: string, tier: PendingChest['tier'] = 'COMMON'): PendingChest => ({
  id,
  tier,
  source: 'playday:2026-10-18:1',
  title: 'Обычный',
  createdAt: '2026-10-18T16:00:00.000Z',
})

function memoryStore(uid: string | null) {
  const data = new Map<string, string>()
  if (uid) data.set('m-millida-uid', uid)
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('chests opened but never shown', () => {
  test.each([
    {
      why: 'the server opened it (no longer pending): its stored rewards must be replayed after a restart',
      unseen: ['a'],
      pending: [],
      offered: [],
      replay: ['a'],
    },
    {
      why: 'still pending means the open never reached the server: it stays in «Мои сундуки», no replay window',
      unseen: ['a'],
      pending: ['a'],
      offered: [],
      replay: [],
    },
    {
      why: 'already offered this session: a flaky network must not pop the window on every reload',
      unseen: ['a'],
      pending: [],
      offered: ['a'],
      replay: [],
    },
    {
      why: 'only opened ones are replayed, in the order they were opened',
      unseen: ['a', 'b', 'c'],
      pending: ['b'],
      offered: [],
      replay: ['a', 'c'],
    },
    {
      why: 'nothing unseen, nothing to show',
      unseen: [],
      pending: [],
      offered: [],
      replay: [],
    },
  ])('$why', ({ unseen, pending, offered, replay, why }) => {
    const got = chestsToReplay(unseen.map((id) => chest(id)), pending.map((id) => chest(id)), new Set(offered)).map((c) => c.id)
    expect(got, why).toEqual([...replay])
  })

  test.each([
    { raw: null, ids: [], why: 'no record yet' },
    { raw: '{broken', ids: [], why: 'a corrupt record must not break the chest window' },
    { raw: JSON.stringify({ id: 'a' }), ids: [], why: 'not a list' },
    { raw: JSON.stringify([chest('a'), { id: 'b', tier: 'GOLD' }, { id: '' }]), ids: ['a'], why: 'an entry from another version with an unknown tier or no id is dropped' },
  ])('parse: $why', ({ raw, ids, why }) => {
    expect(parseUnseen(raw).map((c) => c.id), why).toEqual([...ids])
  })

  test('marking the same chest twice keeps one entry and the list stays bounded', () => {
    let list: PendingChest[] = []
    list = withUnseen(list, chest('a'))
    list = withUnseen(list, chest('a'))
    expect(list.map((c) => c.id), 'a retry re-marks the chest and must not make it replay twice').toEqual(['a'])
    for (let i = 0; i < 40; i++) list = withUnseen(list, chest('x' + i))
    expect(list.length, 'the record lives in localStorage and must not grow without bound').toBe(20)
    expect(list[list.length - 1]!.id, 'the newest chest must survive the cap').toBe('x39')
  })

  test('the record is per Millida account and is removed once shown', () => {
    const store = memoryStore('u1')
    markUnseen(chest('a'), store)
    expect(readUnseen(store).map((c) => c.id), 'a marked chest must survive a restart').toEqual(['a'])
    expect(readUnseen(memoryStore('u2')).length, 'another account on this computer must not replay someone else').toBe(0)
    forgetUnseen('a', store)
    expect(store.data.has('m-chest-unseen:u1'), 'a shown chest must not replay again').toBe(false)
    const anonymous = memoryStore(null)
    markUnseen(chest('a'), anonymous)
    expect(anonymous.data.size, 'without an account there is nobody to replay for').toBe(0)
  })

  test('the opening window marks before sending and forgets only after the summary', () => {
    const host = source('./ChestOpen.tsx')
    expect(host, 'the mark must be written before the request, or a lost answer leaves nothing to replay').toMatch(
      /markUnseen\(chest\)\s*\n\s*return openOnce\(/,
    )
    expect(host, 'closing the window before the rewards were shown must keep the mark').toContain('onDone={(shown) => shown && forgetUnseen(chest.id)}')
    const reveal = source('../chest/CaseReveal.tsx')
    expect(reveal, 'closing early must report «not shown»').toContain('if (asked.current && !finished.current) onDone(false)')
    expect(reveal, 'reaching the summary must report «shown»').toContain('onDone(true)')
  })

  test('a chest the server refuses for good is forgotten', () => {
    const store = source('../../state/daily.ts')
    const forgets = store.match(/drop\(\)\s*\n\s*forgetUnseen\(id\)/g) ?? []
    expect(forgets.length, '«уже открыт» without a replay and «Сундука нет» would otherwise replay a failing window every session').toBe(2)
  })
})
