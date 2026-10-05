import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import postcss from 'postcss'
import {
  ASPECT_CARRIER,
  NO_ASPECT_RATIO,
  NO_COLOR_MIX,
  aspectCarrier,
  collectRootTokens,
  formatColor,
  lowerForOldWebKit,
  parseColor,
  resolveColorMixes,
} from './old-webkit-css.mjs'

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const stylesDir = resolve(here, '..', 'src', 'styles')

const TOKENS = new Map([
  ['--m-accent', '#5EC64D'],
  ['--m-accent-rgb', '94,198,77'],
  ['--m-accent-soft', 'rgba(var(--m-accent-rgb),.13)'],
  ['--m-surface', '#1E1F20'],
  ['--m-ruby', 'hsl(347 76% 50%)'],
])
const lookup = (name) => TOKENS.get(name) ?? null

describe('color parsing', () => {
  const cases = [
    ['#fff', '#ffffff', 'three-digit hex is the most common shorthand in the kit'],
    ['#5EC64D', '#5ec64d', 'tokens are written in upper case'],
    ['#00000080', 'rgba(0,0,0,0.502)', 'eight-digit hex carries alpha'],
    ['rgba(94,198,77,.13)', 'rgba(94,198,77,0.13)', 'accent-soft is rgba over the rgb token'],
    ['rgb(94 198 77 / 50%)', 'rgba(94,198,77,0.5)', 'space syntax with slash alpha'],
    ['hsl(347 76% 50%)', '#e01f49', 'ruby tokens are space-separated hsl'],
    ['transparent', 'rgba(0,0,0,0)', 'glows mix toward transparent'],
  ]
  for (const [input, want, why] of cases) {
    test(input, () => {
      const parsed = parseColor(input)
      expect(parsed, `${input} must parse: ${why}`).not.toBeNull()
      expect(formatColor(parsed), why).toBe(want)
    })
  }

  test('unknown colors are refused, not guessed', () => {
    for (const input of ['currentColor', 'var(--x)', '#12345', 'lab(50% 10 10)']) {
      expect(parseColor(input), `${input} has no static value and must not turn into black`).toBeNull()
    }
  })
})

describe('color-mix evaluation', () => {
  const cases = [
    ['color-mix(in srgb, #fff 50%, #000)', '#808080', 'plain halfway mix'],
    ['color-mix(in srgb, var(--m-accent) 62%, #0b1f0e)', '#3e8735', 'the friends tile plate: lost on old WebKit before'],
    ['color-mix(in srgb, var(--m-accent) 34%, transparent)', 'rgba(94,198,77,0.34)', 'premultiplied: mixing with transparent keeps the hue'],
    ['color-mix(in srgb, #fff 20%, #000 20%)', 'rgba(128,128,128,0.4)', 'percentages under 100% fade the result'],
    ['color-mix(in srgb, var(--m-accent-soft) 50%, #000)', 'rgba(11,23,9,0.565)', 'a token defined through another token resolves'],
    ['color-mix(in srgb, var(--nope, #fff) 50%, #000)', '#808080', 'var() fallback is used when the variable is unknown'],
    ['inset 0 0 0 2px color-mix(in srgb, #fff 26%, transparent)', 'inset 0 0 0 2px rgba(255,255,255,0.26)', 'text around the mix is kept'],
    ['color-mix(in srgb, color-mix(in srgb, #fff 50%, #000) 50%, #000)', '#404040', 'nested mixes resolve innermost first'],
  ]
  for (const [input, want, why] of cases) {
    test(input, () => expect(resolveColorMixes(input, lookup), why).toBe(want))
  }

  test('a per-element tint falls back to the base surface', () => {
    let guessed = false
    const out = resolveColorMixes('color-mix(in srgb, var(--sh-tone) 14%, var(--m-surface))', lookup, new Set(), () => (guessed = true))
    expect(out, 'the tint is set inline per item; without it the plate must still be painted').toBe('#1e1f20')
    expect(guessed, 'an approximated fallback must be counted so the build log shows it').toBe(true)
  })

  test('a mix with nothing static is left alone', () => {
    expect(resolveColorMixes('color-mix(in srgb, var(--a) 50%, var(--b))', lookup)).toBeNull()
  })
})

describe('aspect-ratio carrier', () => {
  const decls = (text) => postcss.parse(`a{${text}}`).first.nodes
  const cases = [
    ['16 / 9', '', '1.7778 w', 'covers take their height from the card width'],
    ['1', 'position:absolute;top:0;bottom:0', '1 h', 'a box stretched top to bottom takes its width from its height'],
    ['16 / 9', 'height:120px', '1.7778 h', 'an explicit height drives the width'],
    ['1', 'width:10px;height:10px', 'none', 'both sides set: the ratio never applied'],
    ['auto', '', 'none', 'auto switches an inherited ratio off'],
    ['auto 4 / 3', '', '1.3333 w', 'auto with a ratio still sizes elements without intrinsic size'],
  ]
  for (const [value, rest, want, why] of cases) {
    test(`${value} ${rest}`, () => expect(aspectCarrier(value, decls(rest)), why).toBe(want))
  }
})

describe('lowerForOldWebKit', () => {
  const sample = [
    ':root{--m-accent:#5EC64D}',
    '.ht-server{--ht-bg:color-mix(in srgb, var(--m-accent) 62%, #0b1f0e);padding:4px}',
    '@media (max-width:600px){.x{background:color-mix(in srgb, #fff 50%, #000)}}',
    '.cover{aspect-ratio:16/9}',
    '@keyframes k{from{color:color-mix(in srgb, #fff 50%, #000)}}',
  ].join('\n')
  const { css, stats } = lowerForOldWebKit(sample)

  test('original rules are untouched', () => {
    const original = postcss.parse(sample)
    const lowered = postcss.parse(css)
    const kept = []
    lowered.walkRules((r) => {
      if (r.parent?.type === 'atrule' && r.parent.name === 'supports') return
      kept.push(r.toString())
    })
    const before = []
    original.walkRules((r) => before.push(r.toString()))
    expect(kept, 'modern engines must render exactly what they rendered before').toEqual(before)
  })

  test('fallbacks sit in @supports blocks right after their rule', () => {
    expect(css).toContain(`.ht-server{--ht-bg:color-mix(in srgb, var(--m-accent) 62%, #0b1f0e);padding:4px}\n@supports ${NO_COLOR_MIX}`)
    expect(css).toMatch(/@media \(max-width:600px\)\{\.x\{[^}]*\}\s*@supports not \(color: color-mix[^{]*\{\s*\.x\s*\{\s*background:\s*#808080/)
    expect(css).toContain(`@supports ${NO_ASPECT_RATIO}`)
    expect(css).toContain(`${ASPECT_CARRIER}:1.7778 w`)
  })

  test('keyframes are skipped: @supports is not allowed inside them', () => {
    expect(stats.colorMix, 'the keyframe mix is not counted').toBe(2)
    expect(css.match(/@supports/g)?.length).toBe(3)
  })

  test('a lazy chunk resolves tokens defined in the main stylesheet', () => {
    const main = ':root{--m-accent:#5EC64D;--m-surface:#1E1F20}'
    const lazy = '.daily{background:color-mix(in srgb, var(--m-accent) 20%, var(--m-surface))}'
    const alone = lowerForOldWebKit(lazy)
    const shared = lowerForOldWebKit(lazy, collectRootTokens([main, lazy]))
    expect(alone.stats.unresolved.length, 'without the shared tokens the chunk has nothing static').toBe(1)
    expect(shared.stats.unresolved, 'screens loaded on demand must get fallbacks too').toEqual([])
    expect(shared.css).toContain('.daily{background:#2b4029}')
  })

  test('every color-mix in the launcher styles gets a fallback', () => {
    const files = [...new Bun.Glob('**/*.css').scanSync(stylesDir)].sort((a, b) =>
      a.includes('02-kit') ? -1 : b.includes('02-kit') ? 1 : a.localeCompare(b),
    )
    const all = files.map((f) => readFileSync(join(stylesDir, f), 'utf8')).join('\n')
    const { stats: full } = lowerForOldWebKit(all)
    expect(full.unresolved, 'a new color-mix with nothing static paints transparent on macOS 10.13-11').toEqual([])
    expect(full.colorMixLowered).toBe(full.colorMix)
    expect(full.colorMix).toBeGreaterThan(100)
  })
})
