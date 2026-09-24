import { useEffect, useState } from 'react'

/**
 * Превью вещи-расцветки (модель v3.1). У вещи на CDN одно превью — базовой
 * расцветки; у каждой расцветки есть своя текстура и цвет. Карточке нужна
 * картинка СВОЕЙ расцветки: перекрашиваем превью на холсте — пиксели цвета
 * базовой расцветки (по тону) получают тон расцветки, светлота сохраняется.
 * Без цвета базовой — перекрашиваются все насыщенные пиксели. Результат
 * кэшируется: одна перекраска на пару «превью + цвет».
 */

const cache = new Map<string, Promise<string>>()

const hex = (c?: string | null) => {
  const s = (c || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(s)) return null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] as const
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function tint(src: string, from: string | null | undefined, to: string): Promise<string> {
  const key = src + '|' + (from || '') + '|' + to
  const known = cache.get(key)
  if (known) return known
  const job = new Promise<string>((resolve, reject) => {
    const target = hex(to)
    if (!target) return reject(new Error('цвет'))
    const [th, ts, tl] = rgb2hsl(target[0], target[1], target[2])
    const base = hex(from)
    const bh = base ? rgb2hsl(base[0], base[1], base[2]) : null
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const g = c.getContext('2d', { willReadFrequently: true })
        if (!g) return reject(new Error('холст'))
        g.drawImage(img, 0, 0)
        const data = g.getImageData(0, 0, c.width, c.height)
        const d = data.data
        // Светлота расцветки против базовой: чёрная расцветка темнит, белая светлит.
        const lk = bh ? (tl + 0.05) / (bh[2] + 0.05) : 1
        for (let i = 0; i < d.length; i += 4) {
          if ((d[i + 3] as number) < 16) continue
          const [h, s, l] = rgb2hsl(d[i] as number, d[i + 1] as number, d[i + 2] as number)
          if (s < 0.18) continue
          if (bh && bh[1] > 0.15 && hueGap(h, bh[0]) > 38) continue
          const ns = ts < 0.08 ? ts : Math.min(1, s * (ts / Math.max(0.2, bh ? bh[1] : s)))
          const nl = Math.min(0.97, Math.max(0.03, l * lk))
          const [r, gg, b] = hsl2rgb(th, ns, nl)
          d[i] = r
          d[i + 1] = gg
          d[i + 2] = b
        }
        g.putImageData(data, 0, 0)
        resolve(c.toDataURL('image/png'))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('картинка'))
    img.src = src
  })
  job.catch(() => cache.delete(key))
  cache.set(key, job)
  return job
}

/**
 * Адрес превью своей расцветки. `color` пуст или совпадает с базовой — само
 * превью. Пока перекраска не готова (или не удалась) — тоже превью.
 */
export function useVariantPreview(src: string | null | undefined, from?: string | null, color?: string | null): string | null | undefined {
  const need = !!src && !!color && hex(color) !== null && (from || '').toLowerCase().replace('#', '') !== color.toLowerCase().replace('#', '')
  const [out, setOut] = useState<string | null | undefined>(need ? null : src)
  useEffect(() => {
    if (!need || !src || !color) {
      setOut(src)
      return
    }
    let alive = true
    setOut(null)
    tint(src, from, color).then(
      (url) => alive && setOut(url),
      () => alive && setOut(src),
    )
    return () => {
      alive = false
    }
  }, [src, from, color, need])
  return out
}
