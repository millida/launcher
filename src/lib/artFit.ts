/**
 * Насколько вещь занимает свою картинку. Превью рисуются в одном кадре 160×160,
 * и мелкий питомец в нём — пятнышко посередине: «маленький кот» (владелец
 * 24.09.2026). Меряем непрозрачную часть и увеличиваем её до ~86% карточки.
 * CDN отдаёт превью с Access-Control-Allow-Origin: *, пиксели читать можно.
 */
const ART_FIT = new Map<string, string>()
const ART_FILL = 0.86
const ART_MAX_ZOOM = 1.8

export function artFit(img: HTMLImageElement): string {
  const key = img.currentSrc || img.src
  const known = ART_FIT.get(key)
  if (known !== undefined) return known
  let fit = ''
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d', { willReadFrequently: true })
    if (g && w && h) {
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, w, h).data
      let x0 = w
      let y0 = h
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if ((d[(y * w + x) * 4 + 3] as number) > 24) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
      if (x1 >= x0) {
        const span = Math.max((x1 - x0 + 1) / w, (y1 - y0 + 1) / h)
        const zoom = Math.min(ART_MAX_ZOOM, ART_FILL / span)
        if (zoom > 1.04) {
          const dx = ((w / 2 - (x0 + x1 + 1) / 2) / w) * 100
          const dy = ((h / 2 - (y0 + y1 + 1) / 2) / h) * 100
          fit = 'scale(' + zoom.toFixed(3) + ') translate(' + dx.toFixed(2) + '%, ' + dy.toFixed(2) + '%)'
        }
      }
    }
  } catch {
    // Картинка без CORS: оставляем как есть.
  }
  ART_FIT.set(key, fit)
  return fit
}
