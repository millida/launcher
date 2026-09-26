import { describe, expect, mock, test } from 'bun:test'

mock.module('./api', () => ({ LAUNCHER_API: '' }))
mock.module('./gameProfile', () => ({ loadCosmeticModel: async () => null }))

const { lobbyHitBox } = await import('./characterStage')

describe('lobbyHitBox', () => {
  const stage = { w: 960, h: 716 }
  const body = { minX: -0.2, maxX: 0.2, minY: -0.5, maxY: 0.58 }
  const box = lobbyHitBox(body, stage.w, stage.h)

  test('wardrobe click area is at most half the old full-stage area', () => {
    const oldArea = stage.w * stage.h
    expect(box.width * box.height, 'owner asked to shrink the zone 1.5-2x').toBeLessThanOrEqual(oldArea / 2)
  })
  test('wardrobe click area still covers the whole figure', () => {
    const top = ((1 - body.maxY) / 2) * stage.h
    const bottom = ((1 - body.minY) / 2) * stage.h
    const left = ((body.minX + 1) / 2) * stage.w
    const right = ((body.maxX + 1) / 2) * stage.w
    expect(box.top <= top && box.top + box.height >= bottom, 'a click on the head or feet must still open the wardrobe').toBe(true)
    expect(box.left <= left && box.left + box.width >= right, 'a click on the arms must still open the wardrobe').toBe(true)
  })
  test('empty space to the sides of the figure is outside', () => {
    expect(box.left, 'a click at the left edge of the stage is background, not the character').toBeGreaterThan(stage.w * 0.15)
    expect(box.left + box.width, 'a click at the right edge of the stage is background, not the character').toBeLessThan(stage.w * 0.85)
  })
})
