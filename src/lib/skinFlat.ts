// Плоская фигурка скина спереди — без WebGL. Нужна там, где 3D недоступно:
// облегчённый режим после сбоя видеокарты (lib/gpuLite) и заглушки превью.

type SkinArea = [number, number, number, number]

const AREAS_UNUSED_BY_SLIM: SkinArea[] = [
  [50, 16, 2, 4],
  [54, 20, 2, 12],
  [42, 48, 2, 4],
  [46, 52, 2, 12],
]

type PixelTest = (d: Uint8ClampedArray, i: number) => boolean

const isBlackPixel: PixelTest = (d, i) => d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0 && d[i + 3] === 255
const isWhitePixel: PixelTest = (d, i) => d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255 && d[i + 3] === 255

export function detectSlim(img: HTMLImageElement): boolean {
  if (img.height < img.width) return false
  try {
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return false
    g.drawImage(img, 0, 0)
    const s = img.width / 64
    const everyPixel = (a: SkinArea, ok: PixelTest) => {
      const d = g.getImageData(
        Math.round(a[0] * s),
        Math.round(a[1] * s),
        Math.max(1, Math.round(a[2] * s)),
        Math.max(1, Math.round(a[3] * s)),
      ).data
      for (let i = 0; i < d.length; i += 4) if (!ok(d, i)) return false
      return true
    }
    // Руки определяем сами (правка владельца 23.09.2026: переключатель убран).
    // Столбцы, которых у тонкой модели нет: у Alex они в основном прозрачные
    // или залиты одним цветом (чаще чёрным); у Steve это живые пиксели руки.
    const px: number[][] = []
    for (const r of AREAS_UNUSED_BY_SLIM) {
      const d = g.getImageData(
        Math.round(r[0] * s),
        Math.round(r[1] * s),
        Math.max(1, Math.round(r[2] * s)),
        Math.max(1, Math.round(r[3] * s)),
      ).data
      for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2], d[i + 3]])
    }
    if (!px.length) return false
    const clear = px.filter((p) => p[3] < 128).length / px.length
    if (clear >= 0.5) return true
    const solid = px.filter((p) => p[3] >= 128)
    const [r0, g0, b0] = solid[0]
    const flat = solid.every((p) => Math.abs(p[0] - r0) + Math.abs(p[1] - g0) + Math.abs(p[2] - b0) <= 6)
    return flat && (everyPixel(AREAS_UNUSED_BY_SLIM[1], isBlackPixel) || everyPixel(AREAS_UNUSED_BY_SLIM[1], isWhitePixel) || solid.length === px.length)
  } catch {
    return false
  }
}

/// Front projection of a skin texture; legacy 64x32 has no second layer and mirrors limbs.
export function drawFront(g: CanvasRenderingContext2D, img: HTMLImageElement, slim: boolean) {
  const s = img.width / 64
  const is64 = img.height >= img.width
  const armW = slim ? 3 : 4
  g.imageSmoothingEnabled = false
  g.clearRect(0, 0, 16, 32)
  const px = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => {
    try {
      g.drawImage(img, sx * s, sy * s, sw * s, sh * s, dx, dy, sw, sh)
    } catch {}
  }
  px(8, 8, 8, 8, 4, 0) // head
  px(20, 20, 8, 12, 4, 8) // body
  px(44, 20, armW, 12, 4 - armW, 8) // right arm
  if (is64) px(36, 52, armW, 12, 12, 8)
  else px(44, 20, armW, 12, 12, 8) // left arm (legacy: mirrored right arm)
  px(4, 20, 4, 12, 4, 20) // right leg
  if (is64) px(20, 52, 4, 12, 8, 20)
  else px(4, 20, 4, 12, 8, 20) // left leg
  if (is64) {
    px(40, 8, 8, 8, 4, 0) // hat layer
    px(20, 36, 8, 12, 4, 8) // jacket
    px(44, 36, armW, 12, 4 - armW, 8) // right sleeve
    px(52, 52, armW, 12, 12, 8) // left sleeve
    px(4, 36, 4, 12, 4, 20) // right pant
    px(4, 52, 4, 12, 8, 20) // left pant
  }
}
