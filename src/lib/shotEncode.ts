/**
 * Turns the frame strip of a shop shot into an image. WKWebView cannot encode WebP, and the PNG
 * of a 16-frame strip on the main thread made tiles and scrolling wait for it. Where
 * OffscreenCanvas exists (WebView2, recent WebKit) a worker encodes it; otherwise (the WebKit of
 * the Intel build) the main thread does.
 */

type Reply = { id: number; blob?: Blob; error?: string }
const pending = new Map<number, (b: Blob | null) => void>()
let worker: Worker | null | undefined
let seq = 0

function encodeWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null
  try {
    const w = new Worker(new URL('./shotEncode.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<Reply>) => {
      const done = pending.get(e.data.id)
      if (!done) return
      pending.delete(e.data.id)
      done(e.data.blob ?? null)
    }
    w.onerror = () => {
      // The worker did not start: the main thread encodes from now on, waiting shots get null and encode there.
      worker = null
      w.terminate()
      for (const done of pending.values()) done(null)
      pending.clear()
    }
    worker = w
  } catch {
    worker = null
  }
  return worker
}

function encodeHere(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((ok) => {
    try {
      canvas.toBlob((b) => ok(b), 'image/webp', 0.9)
    } catch {
      ok(null)
    }
  })
}

/** Кадр, уже снятый с холста (createImageBitmap в такте отрисовки), — в картинку в worker'е. */
export async function encodeBitmap(bitmap: ImageBitmap): Promise<Blob | null> {
  const w = encodeWorker()
  if (w) {
    const id = ++seq
    const blob = await new Promise<Blob | null>((ok) => {
      pending.set(id, ok)
      w.postMessage({ id, bitmap }, [bitmap])
    })
    if (blob) return blob
    // The worker failed after taking the bitmap: it is gone, nothing left to encode here.
    return null
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    return await encodeHere(canvas)
  } finally {
    bitmap.close()
  }
}

export async function encodeStrip(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const w = encodeWorker()
  if (w) {
    try {
      const bitmap = await createImageBitmap(canvas)
      const id = ++seq
      const blob = await new Promise<Blob | null>((ok) => {
        pending.set(id, ok)
        w.postMessage({ id, bitmap }, [bitmap])
      })
      if (blob) return blob
    } catch {
      // The bitmap failed: encode here.
    }
  }
  return encodeHere(canvas)
}
