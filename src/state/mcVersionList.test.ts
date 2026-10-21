import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { ensureMcVersionList, useMcVersionList, versionOptions } from './mcVersionList'
import type { McVersion } from '../ipc/commands'

const LIST: McVersion[] = [
  { id: '26.2', kind: 'release' },
  { id: '26w05a', kind: 'snapshot' },
  { id: 'b1.7.3', kind: 'old_beta' },
]

describe('versionOptions', () => {
  const cases: [string, boolean, string | undefined, string[]][] = [
    ['off hides everything but releases', false, undefined, ['26.2']],
    ['on keeps the manifest order', true, undefined, ['26.2', '26w05a', 'b1.7.3']],
    ['pinned build version survives the release filter', false, '26w05a', ['26w05a', '26.2']],
    ['pinned is not duplicated when already listed', true, '26w05a', ['26.2', '26w05a', 'b1.7.3']],
  ]
  for (const [name, show, pinned, ids] of cases) {
    test(name, () => {
      expect(versionOptions(LIST, show, pinned).map((o) => o.value)).toEqual(ids)
    })
  }

  test('non-release versions are labelled so the choice is deliberate', () => {
    const labels = versionOptions(LIST, true).map((o) => o.label)
    expect(labels).toEqual(['26.2', '26w05a · снапшот', 'b1.7.3 · бета'])
  })
})

describe('ensureMcVersionList', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  // A snapshot released while the launcher stayed open used to stay invisible
  // until restart: the first answer was kept for the whole session.
  test('a later picker open asks again, back-to-back opens share one answer', async () => {
    let served = ['26.2']
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ versions: served.map((id) => ({ id, type: 'release' })) }))
    }) as unknown as typeof fetch
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      await ensureMcVersionList()
      expect(useMcVersionList.getState().list.map((v) => v.id)).toEqual(['26.2'])

      served = ['26w43a', '26.2']
      await ensureMcVersionList()
      expect(calls).toBe(1)

      clock.mockReturnValue(1_000_000 + 61_000)
      await ensureMcVersionList()
      expect(calls).toBe(2)
      expect(useMcVersionList.getState().list.map((v) => v.id)).toEqual(['26w43a', '26.2'])
    } finally {
      clock.mockRestore()
    }
  })
})
