import { describe, expect, test } from 'bun:test'
import { versionOptions } from './mcVersionList'
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
