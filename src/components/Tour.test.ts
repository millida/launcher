import { expect, mock, test } from 'bun:test'

mock.module('../lib/prefs', () => ({ readPref: (_k: string, f: string) => f, writePref: () => {} }))
mock.module('../state/ui', () => ({ setScreen: () => {} }))

const { cardPos } = await import('./Tour')

const VW = 890
const VH = 560
const CARD_H = 190
const CARD_W = 320

const overlaps = (
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

const cases = [
  {
    why: 'play button in the bottom-right corner: no room right or below, the card used to be clamped on top of it',
    box: { left: 520, top: 400, width: 340, height: 110 },
  },
  { why: 'tile on the left edge: the card goes to its right', box: { left: 10, top: 40, width: 130, height: 90 } },
  { why: 'account chip at the top-right: no room right, the card drops below', box: { left: 640, top: 30, width: 200, height: 50 } },
  { why: 'wide bottom plate: card must sit above, not on the plate', box: { left: 140, top: 420, width: 600, height: 100 } },
]

for (const c of cases) {
  test(c.why, () => {
    const pos = cardPos(c.box, CARD_H, VW, VH)
    const card = { left: pos.left, top: pos.top, width: CARD_W, height: CARD_H }
    expect(overlaps(card, c.box), 'tour card covers the highlighted control, the user cannot see what the step explains').toBe(false)
    expect(pos.top >= 0 && pos.top + CARD_H <= VH, 'tour card leaves the window vertically').toBe(true)
    expect(pos.left >= 0 && pos.left + CARD_W <= VW, 'tour card leaves the window horizontally').toBe(true)
  })
}
