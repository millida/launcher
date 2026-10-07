import { useEffect, useState } from 'react'

/**
 * Превью вещи-расцветки (модель v3.1). У вещи на CDN одно превью — той
 * расцветки, которую выбирает render_previews.py мода (белая, обычная, светлая…,
 * см. defaultVariant); у части расцветок есть своё превью. Расцветке без своего
 * перекрашиваем общее превью на холсте: из цвета показанной расцветки в свой.
 * Результат кэшируется: одна перекраска на пару «превью + цвет».
 *
 * Аудит всех вещей 02.10.2026: прежняя перекраска трогала только насыщенные
 * пиксели (s ≥ 0.18). У чёрной, белой и серой базы таких нет — карточки
 * «красных», «синих» и «белых» расцветок выходили копией чёрной базы. Теперь
 * у бесцветной базы перекрашиваются пиксели её светлоты: в серую цель — по
 * светлоте, в цветную — с подтяжкой к цвету. Точно расцветку повторит только
 * своё превью: перекраска — запасной путь, пока его нет.
 */

import { hexColor, recolorPixels } from './variantRecolor'
import { screenSettled } from './screenSettle'

export { hexColor, recolorPixels }

const cache = new Map<string, Promise<string>>()

type Reply = { id: number; blob?: Blob; error?: string }
const pending = new Map<number, { ok: (b: Blob) => void; fail: (e: Error) => void }>()
let worker: Worker | null | undefined
let seq = 0

function recolorWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null
  try {
    const w = new Worker(new URL('./variantArt.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<Reply>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.blob) p.ok(e.data.blob)
      else p.fail(new Error(e.data.error || 'перекраска'))
    }
    w.onerror = () => {
      worker = null
      w.terminate()
      for (const p of pending.values()) p.fail(new Error('перекраска'))
      pending.clear()
    }
    worker = w
  } catch {
    worker = null
  }
  return worker
}

async function recolorOffThread(img: HTMLImageElement, from: string | null, to: string): Promise<Blob> {
  const w = recolorWorker()
  if (!w) throw new Error('перекраска')
  const bitmap = await createImageBitmap(img)
  const id = ++seq
  return new Promise<Blob>((ok, fail) => {
    pending.set(id, { ok, fail })
    w.postMessage({ id, bitmap, from, to }, [bitmap])
  })
}

function recolorHere(img: HTMLImageElement, from: string | null, to: string): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return Promise.reject(new Error('холст'))
  g.drawImage(img, 0, 0)
  const data = g.getImageData(0, 0, c.width, c.height)
  recolorPixels(data.data, from, to)
  g.putImageData(data, 0, 0)
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('холст'))), 'image/png'))
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src
  try {
    await img.decode()
  } catch {
    throw new Error('картинка')
  }
  return img
}

function tint(src: string, from: string | null | undefined, to: string): Promise<string> {
  const key = src + '|' + (from || '') + '|' + to
  const known = cache.get(key)
  if (known) return known
  const job = (async () => {
    if (!hexColor(to)) throw new Error('цвет')
    // Recolouring is a per-pixel loop plus PNG encoding: off the transition frames and off the main thread.
    const loading = loadImage(src)
    loading.catch(() => undefined)
    await screenSettled()
    const img = await loading
    const base = from ?? null
    const blob = await recolorOffThread(img, base, to).catch(() => recolorHere(img, base, to))
    return URL.createObjectURL(blob)
  })()
  job.catch(() => cache.delete(key))
  cache.set(key, job)
  return job
}

/**
 * Адрес превью своей расцветки. `color` пуст или совпадает с базовой — само
 * превью. Пока перекраска не готова (или не удалась) — тоже превью.
 */
export function useVariantPreview(src: string | null | undefined, from?: string | null, color?: string | null): string | null | undefined {
  const need = !!src && !!color && hexColor(color) !== null && (from || '').toLowerCase().replace('#', '') !== color.toLowerCase().replace('#', '')
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
