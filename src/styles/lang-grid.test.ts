import { describe, expect, test } from 'bun:test'
import { LOCALES } from '../i18n/locales'
import { FLAG_COLORS, FLAG_COLUMNS, FLAG_ROWS, PX_COUNTRY_FLAGS, shadowRow } from '../components/pxFlags'

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

test('every language has a pixel flag of a full face', () => {
  const broken = LOCALES.filter((l) => {
    const rows = PX_COUNTRY_FLAGS[l.flag]
    return !rows || rows.length !== FLAG_ROWS || rows.some((r) => r.length !== FLAG_COLUMNS || [...r].some((c) => !(c in FLAG_COLORS)))
  }).map((l) => l.code + ' -> ' + l.flag)
  expect(broken, 'a language without a whole 16 x 11 flag shows a hole or a shifted frame in the picker').toEqual([])
})

test('every flag color has its face and shadow tokens in the kit', () => {
  const missing = Object.values(FLAG_COLORS).flatMap((name) => ['--pxf-' + name + ':', '--pxf-' + name + '-d:']).filter((token) => !kit.includes(token))
  expect(missing, 'a color without a token paints the cell transparent').toEqual([])
})

test.each([
  ['gggggggyyggggggg', 'gggggggggggggggg', 'an emblem touching the edge casts the field shadow, as on the Discord Brazil flag'],
  ['fffffwwwwwwrrrrr', 'fffffwwwwwwrrrrr', 'vertical stripes keep their own shades'],
  ['wwwwGGGGGGGGGGGG', 'wwwwGGGGGGGGGGGG', 'the Pakistani hoist stripe is part of the field'],
])('shadow of %s', (bottom, shadow) => {
  expect(shadowRow(bottom)).toBe(shadow)
})
