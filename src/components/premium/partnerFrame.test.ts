import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PARTNER_FRAME, partnerFrame, type PackPartner } from './packView'

const cases: Array<[PackPartner | null | undefined, string, string]> = [
  [{ slug: 'arcania-labs', name: 'Arcania Labs' }, PARTNER_FRAME, 'a partner pack wears the running exclusive frame on its page and its catalog tile'],
  [null, '', 'the API sends null for an ordinary pack and for a partner whose deal is off'],
  [undefined, '', 'an older API without the field must not light the frame'],
  [{ slug: '', name: 'Broken' }, '', 'a partner without a slug is a broken answer, not an exclusive'],
]

describe('pack partner -> frame class', () => {
  for (const [partner, want, why] of cases)
    test(String(partner?.slug ?? partner), () => {
      expect(partnerFrame(partner), why).toBe(want)
    })
})

const read = (path: string) => readFileSync(join(import.meta.dir, path), 'utf8')

describe('frame pins', () => {
  const kit = read('../../styles/12-pixel.css')

  test('the frame is drawn by the pixel ring, not a border', () => {
    expect(kit, 'without the ring list entry the outline breaks on the cut corners').toContain(':root:root .' + PARTNER_FRAME + '::after {')
  })

  test('the frame steps instead of gliding', () => {
    expect(kit, 'a smooth transition reads as a gradient in the pixel language').toMatch(
      new RegExp('\\.' + PARTNER_FRAME + '::after \\{[^}]*animation: px-excl-run [^;]*steps\\('),
    )
  })

  test('reduced motion keeps the frame still', () => {
    expect(kit, 'people who asked the system for less motion must get a static frame').toMatch(
      new RegExp('prefers-reduced-motion: reduce\\) \\{\\s*\\.' + PARTNER_FRAME + '::after \\{ animation: none;'),
    )
  })

  test('the pack page and the catalog tiles take the class from the partner field', () => {
    expect(read('../playhub/PackPage.tsx'), 'the page header decides the frame by the partner, not by a hard-coded slug').toContain(
      'partnerFrame(view?.partner ?? detail?.partner)',
    )
    expect(read('../catalog/SiteRow.tsx').match(/partnerFrame\(card\.partner\)/g)?.length, 'both the row and the gallery card').toBe(2)
  })
})
