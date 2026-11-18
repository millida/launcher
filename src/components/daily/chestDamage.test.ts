import { describe, expect, test } from 'bun:test'
import { STAGES, crackCells, faceUv, stageOf } from './chestDamage'

const FACES: [number, number][] = [
  [14, 8],
  [14, 14],
  [5, 5],
]

describe('crackCells', () => {
  test.each(FACES)('%ix%i stays inside the face and uses only the ten vanilla stages', (w, h) => {
    for (let seed = 0; seed < 40; seed++) {
      for (const c of crackCells(w, h, seed)) {
        expect(c.x >= 0 && c.x < w && c.y >= 0 && c.y < h).toBe(true)
        expect(Number.isInteger(Math.round(c.stage * STAGES * 1e6) / 1e6)).toBe(true)
        expect(c.stage >= 1 / STAGES && c.stage <= 1).toBe(true)
      }
    }
  })

  test('the same seed draws the same cracks, so a chest does not change its scars between frames', () => {
    expect(crackCells(14, 8, 5)).toEqual(crackCells(14, 8, 5))
  })

  test.each(FACES)('%ix%i: the first hit of three already shows a crack', (w, h) => {
    for (let seed = 0; seed < 40; seed++) {
      expect(crackCells(w, h, seed).filter((c) => !c.light && c.stage <= 1 / 3).length).toBeGreaterThan(0)
    }
  })

  test('cracks start in the middle of the face and reach its edge by the last stage', () => {
    for (let seed = 0; seed < 40; seed++) {
      const dark = crackCells(14, 14, seed).filter((c) => !c.light)
      const first = dark.filter((c) => c.stage === 1 / STAGES)
      expect(first.every((c) => c.x >= 3 && c.x <= 10 && c.y >= 3 && c.y <= 10)).toBe(true)
      expect(dark.some((c) => c.x === 0 || c.y === 0 || c.x === 13 || c.y === 13)).toBe(true)
    }
  })

  test('more hits reveal more cracks', () => {
    const cells = crackCells(14, 8, 3)
    const at = (k: number) => cells.filter((c) => c.stage <= k).length
    expect(at(1 / 3)).toBeLessThan(at(2 / 3))
    expect(at(2 / 3)).toBeLessThan(at(1))
  })
})

describe('stageOf', () => {
  test.each([
    [0, -1, 'no hit yet: no overlay at all'],
    [1 / 3, 3, 'first of three hits'],
    [2 / 3, 6, 'second of three hits'],
    [1, 9, 'last hit shows the last frame, destroy_stage_9'],
    [0.25, 2, 'first of four hits (x10)'],
    [0.01, 0, 'any damage shows at least the first frame'],
    [1.5, 9, 'never past the last frame'],
  ])('%p -> frame %p (%s)', (k, frame) => {
    expect(stageOf(k)).toBe(frame)
  })
})

describe('faceUv', () => {
  test('the middle of the frame lands on the middle of the face, so cracks start there and not at an edge', () => {
    const mid: [number, number, number] = [0, 4, -7]
    expect(faceUv('north', mid, mid)).toEqual([0.5, 0.5])
    expect(faceUv('east', [7, 4, 3], [7, 4, 0])).toEqual([0.5 + 3 / 16, 0.5])
    expect(faceUv('up', [-7, 16, 7], [0, 16, 0])).toEqual([0.5 - 7 / 16, 0.5 + 7 / 16])
  })
})
