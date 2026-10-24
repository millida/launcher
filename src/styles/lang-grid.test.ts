import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LOCALES } from '../i18n/locales'

const kit = await Bun.file(new URL('./02-kit.css', import.meta.url)).text()

const ruleBody = (selector: string): string => {
  const at = kit.indexOf(selector + '{')
  expect(at, selector + ': the rule is gone from the kit, this pin looks at nothing').toBeGreaterThan(-1)
  return kit.slice(at + selector.length + 1, kit.indexOf('}', at))
}

describe('the language picker shows every language at once', () => {
  const cases: Array<{ selector: string; has: string[]; lacks: string[]; why: string }> = [
    {
      selector: '.lang-pop-grid',
      has: ['display:grid', 'grid-template-columns:repeat(3,'],
      lacks: ['overflow-y:auto', 'max-height'],
      why: 'twenty languages in three columns fit the smallest window; a scrolling list hid Russian below the fold',
    },
    {
      selector: '.mk-menu.lang-pop',
      has: ['position:fixed', 'max-height:none', 'overflow:visible'],
      lacks: [],
      why: 'the kit menu caps its height and scrolls; the picker must override both or the last rows get cut',
    },
  ]
  for (const c of cases)
    test(c.selector, () => {
      const body = ruleBody(c.selector)
      for (const part of c.has) expect(body, `${c.selector} lost "${part}": ${c.why}`).toContain(part)
      for (const part of c.lacks) expect(body, `${c.selector} got "${part}" back: ${c.why}`).not.toContain(part)
    })
})

test('every language has its flag file', () => {
  const dir = join(import.meta.dir, '..', '..', 'public', 'flags')
  const missing = LOCALES.filter((l) => !existsSync(join(dir, l.flag + '.svg'))).map((l) => l.code + ' -> ' + l.flag)
  expect(missing, 'a missing flag shows a broken image in the language picker').toEqual([])
})
