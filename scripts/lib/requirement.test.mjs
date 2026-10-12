import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { identifierRequirement } from './requirement.mjs'

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const tauriDir = resolve(here, '..', '..', 'src-tauri')

/** Expected bytes are what `csreq -r '=identifier "<id>"' -b` writes on macOS 14 and 26. */
describe('identifierRequirement', () => {
  const cases = [
    ['a', 'fade0c000000001800000001000000020000000161000000', 'короткий хвост добивается нулями до слова'],
    ['abcd', 'fade0c000000001800000001000000020000000461626364', 'длина кратна слову: лишнего слова нет'],
    ['abcde', 'fade0c000000001c0000000100000002000000056162636465000000', 'переход через границу слова меняет и длину блока'],
  ]

  for (const [identifier, expected, why] of cases) {
    test(`${identifier}: ${why}`, () => {
      expect(identifierRequirement(identifier).toString('hex')).toBe(expected)
    })
  }

  test('пустой идентификатор не превращается в требование, которому подходит что угодно', () => {
    expect(() => identifierRequirement('')).toThrow(/идентификатор/)
    expect(() => identifierRequirement(undefined)).toThrow(/идентификатор/)
  })
})

/**
 * The pin that matters: macOS keeps the microphone permission against these
 * exact bytes. A different identifier is a different app to the system, and
 * every player is asked for the microphone again.
 */
test('требование подписи лаунчера не меняется от сборки к сборке', () => {
  const { identifier } = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))
  expect(identifierRequirement(identifier).toString('hex')).toBe(
    'fade0c00000000280000000100000002000000146e65742e6d696c6c6964612e6c61756e63686572',
  )
})
