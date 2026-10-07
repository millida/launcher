import { recolorPixels } from './variantRecolor'

type Ask = { id: number; bitmap: ImageBitmap; from: string | null; to: string }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Ask>) => void) | null
  postMessage(message: unknown): void
}

scope.onmessage = (e) => {
  const { id, bitmap, from, to } = e.data
  void (async () => {
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const g = canvas.getContext('2d', { willReadFrequently: true })
      if (!g) throw new Error('offscreen 2d context unavailable')
      g.drawImage(bitmap, 0, 0)
      const data = g.getImageData(0, 0, canvas.width, canvas.height)
      recolorPixels(data.data, from, to)
      g.putImageData(data, 0, 0)
      scope.postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/png' }) })
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    } finally {
      bitmap.close()
    }
  })()
}
