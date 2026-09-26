import { textureSource } from './textureSource'

export function loadImg(url: string): Promise<HTMLImageElement> {
  return textureSource(url).then(
    (src) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        if (!/^(data|blob):/i.test(src)) i.crossOrigin = 'anonymous'
        i.onload = () => res(i)
        i.onerror = () => rej(new Error('текстура недоступна: ' + url))
        i.src = src
      }),
  )
}

type SkinArea = [number, number, number, number]

const AREAS_UNUSED_BY_SLIM: SkinArea[] = [
  [50, 16, 2, 4],
  [54, 20, 2, 12],
  [42, 48, 2, 4],
  [46, 52, 2, 12],
]

type Pixel = [number, number, number, number]

export type SkinPixels = (area: SkinArea) => Pixel[]

/// Columns the slim model does not have: on an Alex-type skin they are mostly
/// transparent or one flat colour (usually black), on a Steve-type skin they
/// hold real arm pixels.
export function slimFromPixels(width: number, height: number, read: SkinPixels): boolean {
  if (height < width) return false
  const px = AREAS_UNUSED_BY_SLIM.flatMap(read)
  if (!px.length) return false
  const clear = px.filter((p) => p[3] < 128).length / px.length
  if (clear >= 0.5) return true
  const solid = px.filter((p) => p[3] >= 128)
  const [r0, g0, b0] = solid[0]
  const flat = solid.every((p) => Math.abs(p[0] - r0) + Math.abs(p[1] - g0) + Math.abs(p[2] - b0) <= 6)
  const every = (ok: (p: Pixel) => boolean) => read(AREAS_UNUSED_BY_SLIM[1]).every(ok)
  const black = (p: Pixel) => p[0] === 0 && p[1] === 0 && p[2] === 0 && p[3] === 255
  const white = (p: Pixel) => p[0] === 255 && p[1] === 255 && p[2] === 255 && p[3] === 255
  return flat && (every(black) || every(white) || solid.length === px.length)
}

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
    const read: SkinPixels = (a) => {
      const d = g.getImageData(
        Math.round(a[0] * s),
        Math.round(a[1] * s),
        Math.max(1, Math.round(a[2] * s)),
        Math.max(1, Math.round(a[3] * s)),
      ).data
      const out: Pixel[] = []
      for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2], d[i + 3]])
      return out
    }
    return slimFromPixels(img.width, img.height, read)
  } catch {
    return false
  }
}

export function detectSlimFromUrl(url: string): Promise<boolean> {
  return loadImg(url).then(detectSlim)
}
