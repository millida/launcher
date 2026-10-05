import { describe, expect, test } from 'bun:test'
import { aspectSize, parseCarrier } from './aspectRatioFallback'

describe('parseCarrier', () => {
  const cases: [string, ReturnType<typeof parseCarrier>, string][] = [
    [' 1.7778 w', { ratio: 1.7778, axis: 'w' }, 'getPropertyValue keeps the leading space of a custom property'],
    ['1 h', { ratio: 1, axis: 'h' }, 'height-driven boxes take their width from the ratio'],
    ['none', { ratio: null, axis: 'w' }, 'aspect-ratio: auto must undo a size set by an earlier rule'],
    ['', null, 'an element without the carrier is not touched'],
    ['0 w', null, 'a zero ratio would divide by zero'],
  ]
  for (const [input, want, why] of cases) {
    test(JSON.stringify(input), () => expect(parseCarrier(input), why).toEqual(want))
  }
})

describe('aspectSize', () => {
  const cases: [Parameters<typeof aspectSize>[0], { width: number; height: number }, ReturnType<typeof aspectSize>, string][] = [
    [{ ratio: 16 / 9, axis: 'w' }, { width: 320, height: 0 }, { prop: 'height', px: 180 }, 'a catalog cover collapsed to 0 gets its 16:9 height back'],
    [{ ratio: 1, axis: 'h' }, { width: 0, height: 140 }, { prop: 'width', px: 140 }, 'a square stretched top to bottom gets its width'],
    [{ ratio: 16 / 9, axis: 'w' }, { width: 0, height: 0 }, null, 'a hidden element is left alone instead of being sized to 0'],
    [{ ratio: null, axis: 'w' }, { width: 320, height: 90 }, null, 'aspect-ratio: auto sizes nothing'],
  ]
  for (const [rule, box, want, why] of cases) {
    test(why, () => expect(aspectSize(rule, box), why).toEqual(want))
  }
})
