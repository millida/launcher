import { expect, test } from 'bun:test'
import { licenseRequired } from './servers'

const cases: Array<[string | null | undefined, boolean, string]> = [
  ['LICENSE', true, 'the owner said licence only: the Microsoft account warning is right'],
  ['CRACKED', false, 'a cracked server lets any nick in'],
  ['', false, 'OneBlock 28.09: no value on the card showed «Нужна лицензия» to every Millida account'],
  [null, false, 'an aggregated card without the field is not a licence-only server'],
  [undefined, false, 'an old API answer without the field'],
]

for (const [lic, want, why] of cases) {
  test('licenseRequired(' + String(lic) + '): ' + why, () => {
    expect(licenseRequired(lic)).toBe(want)
  })
}
