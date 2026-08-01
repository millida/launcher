// Icons are served same-origin from /block-icons, so getImageData does not taint the canvas.
const cache = new Map<string, string | null>()

function clamp(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}
function hex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
}

export function isBlockIcon(url: string): boolean {
  return url.includes('/block-icons/')
}

export function dominantColor(url: string): Promise<string | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) as string | null)
  return new Promise((res) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const n = 32
        const c = document.createElement('canvas')
        c.width = n
        c.height = n
        const g = c.getContext('2d')
        if (!g) {
          cache.set(url, null)
          res(null)
          return
        }
        g.drawImage(img, 0, 0, n, n)
        const d = g.getImageData(0, 0, n, n).data
        let r = 0,
          gr = 0,
          b = 0,
          cnt = 0,
          bestSat = -1,
          sr = 0,
          sg = 0,
          sb = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue
          r += d[i]
          gr += d[i + 1]
          b += d[i + 2]
          cnt++
          const mx = Math.max(d[i], d[i + 1], d[i + 2])
          const mn = Math.min(d[i], d[i + 1], d[i + 2])
          const sat = mx - mn
          if (sat > bestSat) {
            bestSat = sat
            sr = d[i]
            sg = d[i + 1]
            sb = d[i + 2]
          }
        }
        if (!cnt) {
          cache.set(url, null)
          res(null)
          return
        }
        const out = hex(r / cnt / 2 + sr / 2, gr / cnt / 2 + sg / 2, b / cnt / 2 + sb / 2)
        cache.set(url, out)
        res(out)
      } catch {
        cache.set(url, null)
        res(null)
      }
    }
    img.onerror = () => {
      cache.set(url, null)
      res(null)
    }
    img.src = url
  })
}

function shade(h: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  const num = m ? parseInt(m[1], 16) : 0
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  const t = amt < 0 ? 0 : 255
  const p = Math.abs(amt)
  return hex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p)
}

export function coverGradient(h: string): string {
  return 'radial-gradient(120% 100% at 50% 30%, ' + shade(h, 0.18) + ' 0%, ' + h + ' 48%, ' + shade(h, -0.28) + ' 100%)'
}
