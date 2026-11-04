// Encodes the frame strip of a shop shot off the main thread (shotEncode.ts).

type Ask = { id: number; bitmap: ImageBitmap }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Ask>) => void) | null
  postMessage(message: unknown): void
}

scope.onmessage = (e) => {
  const { id, bitmap } = e.data
  void (async () => {
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const g = canvas.getContext('2d')
      if (!g) throw new Error('offscreen 2d context unavailable')
      g.drawImage(bitmap, 0, 0)
      // WebKit cannot encode WebP and returns PNG: the type comes from the blob, not from the request.
      scope.postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 }) })
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    } finally {
      bitmap.close()
    }
  })()
}
