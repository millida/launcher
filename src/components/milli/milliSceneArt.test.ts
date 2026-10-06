import { describe, expect, it } from 'bun:test'
import { MOTES, PARTICLES, SHADOW, pixelEllipse } from './milliSceneArt'

describe('сцена Милли', () => {
  it('тень — три вложенных ступенчатых эллипса', () => {
    expect(SHADOW).toHaveLength(3)
    for (const d of SHADOW) expect(d.startsWith('M')).toBe(true)
    expect(SHADOW[0]!.length).toBeGreaterThan(SHADOW[2]!.length)
  })
  it('ступенчатый эллипс симметричен по горизонтали', () => {
    const d = pixelEllipse(10, 4, 2)
    for (const m of d.matchAll(/M(-?\d+) -?\d+h(\d+)/g)) expect(Number(m[1]) * -2).toBe(Number(m[2]))
  })
  it('частиц немного, разлёт вокруг', () => {
    expect(MOTES.length).toBeLessThanOrEqual(6)
    expect(PARTICLES.some((p) => p.dx < 0) && PARTICLES.some((p) => p.dx > 0)).toBe(true)
  })
})
