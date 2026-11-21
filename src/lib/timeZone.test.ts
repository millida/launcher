import { expect, test } from 'bun:test'
import { validTimeZone } from './timeZone'

const ZONES: Array<[why: string, raw: string | null | undefined, want: string | null]> = [
  ['an Indian clock passes as is', 'Asia/Kolkata', 'Asia/Kolkata'],
  ['spaces around are trimmed', ' Asia/Karachi ', 'Asia/Karachi'],
  ['a three-part zone is a real IANA name', 'America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
  ['offset zones keep their sign', 'Etc/GMT+5', 'Etc/GMT+5'],
  ['a bare name carries no region', 'UTC', null],
  ['a line break never reaches a header', 'Asia/Kolkata\r\nX-Evil: 1', null],
  ['an overlong value is dropped', 'Asia/' + 'a'.repeat(64), null],
  ['nothing stays nothing', undefined, null],
]

for (const [why, raw, want] of ZONES) {
  test('time zone: ' + why, () => {
    expect(validTimeZone(raw)).toBe(want)
  })
}
