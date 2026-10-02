import { describe, expect, it } from 'bun:test'
import { recolorPixels } from './variantArt'

const px = (...colors: number[][]) => new Uint8ClampedArray(colors.flat())
const hue = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return -1
  const d = max - min
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h * 60
}

describe('перекраска превью расцветки', () => {
  it('чёрную базу красит в цвет расцветки, а не оставляет копией', () => {
    // 3D-очки, афро, ангельские крылья: база чёрная, насыщенных пикселей нет.
    const d = px([20, 20, 22, 255], [45, 44, 48, 255], [8, 8, 8, 255])
    expect(recolorPixels(d, '000000', 'E02020')).toBe(3)
    for (let i = 0; i < d.length; i += 4) {
      const h = hue(d[i]!, d[i + 1]!, d[i + 2]!)
      expect(h === 0 || h > 340 || h < 20).toBe(true)
      expect(d[i]!).toBeGreaterThan(d[i + 1]! + 40)
    }
  })

  it('белую базу в чёрную расцветку уводит в тёмное, тень остаётся видна', () => {
    const d = px([250, 250, 250, 255], [190, 190, 195, 255])
    recolorPixels(d, 'FFFFFF', '000000')
    expect(d[0]!).toBeLessThan(70)
    // тень белой вещи не схлопывается с основным цветом
    expect(Math.abs(d[4]! - d[0]!)).toBeGreaterThan(20)
  })

  it('цветные детали чёрной вещи не трогает', () => {
    // красные глаза на чёрном шлеме — не цвет расцветки
    const d = px([10, 10, 10, 255], [220, 20, 20, 255])
    recolorPixels(d, '000000', '2040FF')
    expect([d[4], d[5], d[6]]).toEqual([220, 20, 20])
  })

  it('цветную базу перекрашивает по тону, чужой тон оставляет', () => {
    const d = px([200, 30, 30, 255], [30, 160, 40, 255])
    recolorPixels(d, 'CC2222', '2244DD')
    const h = hue(d[0]!, d[1]!, d[2]!)
    expect(h).toBeGreaterThan(200)
    expect(h).toBeLessThan(250)
    expect([d[4], d[5], d[6]]).toEqual([30, 160, 40])
  })

  it('прозрачное и неверный цвет не трогает', () => {
    const d = px([10, 10, 10, 0])
    expect(recolorPixels(d, '000000', 'FF0000')).toBe(0)
    expect(recolorPixels(px([10, 10, 10, 255]), '000000', 'zzz')).toBe(0)
  })
})
