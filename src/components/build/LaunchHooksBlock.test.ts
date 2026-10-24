import { describe, expect, test } from 'bun:test'
import { envFromText, envToText } from './LaunchHooksBlock'

describe('environment text', () => {
  const cases: Array<[string, string, { env: Record<string, string>; bad: string | null }]> = [
    ['blank lines are skipped', 'A=1\n\n  \nB=2', { env: { A: '1', B: '2' }, bad: null }],
    ['the value keeps its own = signs', 'OPTS=a=b', { env: { OPTS: 'a=b' }, bad: null }],
    ['a line without = is reported instead of silently dropped', 'A=1\noops', { env: { A: '1' }, bad: 'oops' }],
    ['a line starting with = has no name', '=x', { env: {}, bad: '=x' }],
  ]
  for (const [why, input, want] of cases) test(why, () => expect(envFromText(input)).toEqual(want))

  test('text round-trips so an untouched form is not dirty', () => {
    const env = { A: '1', B: 'x y' }
    expect(envFromText(envToText(env)).env).toEqual(env)
  })
})
