import { expect, test } from 'bun:test'
import { incompatibleWith } from './compat'

// input -> verdict. The badge accuses a mod of breaking the build, so it must
// stay silent whenever the jar did not state an exact list of versions.
const CASES: [string | undefined, string, boolean, string][] = [
  ['1.21.11', '26.1.2', true, 'the reported case: 1.21.11 content inside a 26.1.2 build'],
  ['26.1.2', '26.1.2', false, 'exact match'],
  ['1.21, 1.21.1', '1.21.1', false, 'listed among several exact versions'],
  ['>=1.21.11', '26.1.2', false, 'a range says nothing about the upper bound'],
  ['1.20.x', '1.20.1', false, 'wildcards cover the build'],
  ['1.19.2-1.20.1', '1.20.1', false, 'dashed range'],
  [undefined, '26.1.2', false, 'unscanned jar'],
  ['1.21.11', '', false, 'unknown build version'],
]

test('only an exact version list can mark content as incompatible', () => {
  for (const [mc, build, want, why] of CASES) {
    expect(incompatibleWith(mc, build), why).toBe(want)
  }
})
