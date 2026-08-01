export const W = 320
export const H = 104

function rndArr(n: number, seed: number): number[] {
  const a: number[] = []
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647
    a.push(s / 2147483647)
  }
  return a
}

const R1 = rndArr(400, 7),
  R2 = rndArr(400, 42),
  R3 = rndArr(400, 1337)

function pxCircle(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  c.fillStyle = color
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y))
    c.fillRect(cx - half, cy + y, half * 2 + 1, 1)
  }
}

function hills(
  c: CanvasRenderingContext2D,
  base: number,
  color: string,
  amp: number,
  seed: number,
  off: number,
) {
  c.fillStyle = color
  c.beginPath()
  c.moveTo(-10, H)
  for (let x = -10; x <= W + 10; x += 8) {
    const y = base - Math.sin((x + seed * 100) * 0.05) * amp - R1[((x / 8 + seed * 30) | 0) % 400] * amp * 0.8
    c.lineTo(x + off, y)
  }
  c.lineTo(W + 10, H)
  c.closePath()
  c.fill()
  for (let i = 0; i < 14; i++) {
    const x = (R2[(i + seed * 20) % 400] * W + off) % W
    const y =
      base - Math.sin((x - off + seed * 100) * 0.05) * amp - R1[(((x - off) / 8 + seed * 30) | 0) % 400] * amp * 0.8
    c.fillRect(x, y - 6, 1, 6)
    c.fillRect(x - 1, y - 4, 3, 2)
    c.fillRect(x - 2, y - 2, 5, 2)
  }
}

export interface Scene {
  name: string
  draw(c: CanvasRenderingContext2D, t: number, mx: number, my: number): void
}

export const SCENES: Record<string, Scene> = {
  taiga: {
    name: 'Тайга на рассвете',
    draw(c, t, mx, my) {
      const g = c.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#0C2622')
      g.addColorStop(0.55, '#17493B')
      g.addColorStop(0.82, '#3E8A54')
      g.addColorStop(1, '#7BC96F')
      c.fillStyle = g
      c.fillRect(0, 0, W, H)
      const sx = (W * 0.63 + mx * 4) | 0,
        sy = (H * 0.3 + my * 3) | 0
      pxCircle(c, sx, sy, 11, 'rgba(245,213,120,.10)')
      pxCircle(c, sx, sy, 8, 'rgba(245,213,120,.20)')
      pxCircle(c, sx, sy, 5, '#F5D578')
      pxCircle(c, sx, sy, 3, '#FBEBB4')
      for (let i = 0; i < 5; i++) {
        const cx = ((R1[i] * W + t * (2 + i) * 0.9) % (W + 60)) - 30 + mx * (3 + i)
        const cy = 8 + R2[i] * 22 + my * 2
        c.fillStyle = 'rgba(220,238,225,' + (0.1 + R3[i] * 0.08) + ')'
        c.fillRect(cx, cy, 26 + R3[i] * 18, 4)
        c.fillRect(cx + 5, cy - 3, 16 + R3[i] * 10, 3)
      }
      hills(c, H * 0.68, '#123B2E', 9, 1, mx * 2)
      hills(c, H * 0.82, '#0D2B22', 7, 2, mx * 5)
      hills(c, H * 0.95, '#081D17', 5, 3, mx * 9)
      c.fillStyle = 'rgba(200,240,170,.55)'
      for (let i = 0; i < 26; i++) {
        const px = (R1[i + 40] * W + Math.sin(t * 0.6 + i) * 6 + mx * 6) % W
        const py = H - ((t * (4 + R2[i + 40] * 7) + R3[i + 40] * H * 3) % (H + 10))
        if (R3[i] > 0.4) c.fillRect(px, py, 1, 1)
      }
    },
  },
  sunset: {
    name: 'Закат в саванне',
    draw(c, t, mx, my) {
      const g = c.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#241134')
      g.addColorStop(0.45, '#6E2A3C')
      g.addColorStop(0.75, '#C75B32')
      g.addColorStop(1, '#E8A13C')
      c.fillStyle = g
      c.fillRect(0, 0, W, H)
      const sx = (W * 0.5 + mx * 5) | 0,
        sy = (H * 0.6 + my * 3) | 0
      pxCircle(c, sx, sy, 14, 'rgba(255,180,90,.12)')
      pxCircle(c, sx, sy, 10, 'rgba(255,180,90,.26)')
      pxCircle(c, sx, sy, 7, '#FFB868')
      pxCircle(c, sx, sy, 4, '#FFD9A0')
      for (let i = 0; i < 4; i++) {
        const cx = ((R2[i] * W + t * (1.5 + i)) % (W + 70)) - 35 + mx * (3 + i)
        c.fillStyle = 'rgba(40,16,40,' + (0.28 + R3[i] * 0.16) + ')'
        c.fillRect(cx, 12 + R1[i] * 26 + my * 2, 30 + R3[i] * 22, 4)
      }
      c.fillStyle = '#1C0E14'
      c.fillRect(0, H * 0.88, W, H * 0.12)
      for (let i = 0; i < 5; i++) {
        const x = (R1[i + 9] * W + mx * 6) % W,
          y = H * 0.88
        c.fillRect(x, y - 8, 1, 8)
        c.fillRect(x - 4, y - 10, 9, 2)
        c.fillRect(x - 2, y - 11, 5, 1)
      }
      c.fillStyle = 'rgba(20,8,16,.8)'
      for (let i = 0; i < 4; i++) {
        const bx = ((t * (6 + i * 2) + R2[i + 20] * W) % (W + 20)) - 10 + mx * 4
        const by = 14 + R3[i + 20] * 20 + Math.sin(t * 2 + i) * 2 + my * 2
        c.fillRect(bx, by, 2, 1)
        c.fillRect(bx - 2, by - 1, 2, 1)
        c.fillRect(bx + 2, by - 1, 2, 1)
      }
    },
  },
  cave: {
    name: 'Лавовая пещера',
    draw(c, t, mx, _my) {
      c.fillStyle = '#0A0C10'
      c.fillRect(0, 0, W, H)
      const pulse = 0.5 + Math.sin(t * 1.4) * 0.15
      const g = c.createLinearGradient(0, H * 0.72, 0, H)
      g.addColorStop(0, 'rgba(120,40,16,0)')
      g.addColorStop(0.5, 'rgba(200,70,26,' + (0.35 * pulse + 0.25) + ')')
      g.addColorStop(1, '#E8622A')
      c.fillStyle = g
      c.fillRect(0, H * 0.72, W, H * 0.28)
      c.fillStyle = 'rgba(255,140,60,' + (0.5 + pulse * 0.3) + ')'
      for (let i = 0; i < 8; i++) {
        const lx = (R1[i + 60] * W + mx * 3) % W
        c.fillRect(lx, H - 4 - R2[i + 60] * 4, 4 + R3[i + 60] * 6, 2)
      }
      c.fillStyle = '#14171D'
      for (let i = 0; i < 12; i++) {
        const x = ((i * 30 + R1[i + 80] * 18 + mx * 7) % (W + 20)) - 10
        const l = 6 + R2[i + 80] * 16
        c.fillRect(x, 0, 5, l)
        c.fillRect(x + 1, l, 3, 3)
      }
      c.fillStyle = '#0E1116'
      for (let i = 0; i < 9; i++) {
        const x = ((i * 40 + R3[i + 80] * 22 + mx * 12) % (W + 20)) - 10
        const l = 10 + R1[i + 90] * 22
        c.fillRect(x, 0, 7, l)
        c.fillRect(x + 2, l, 3, 4)
      }
      for (let i = 0; i < 22; i++) {
        const ex = (R2[i + 100] * W + Math.sin(t + i) * 4 + mx * 5) % W
        const ey = H - ((t * (5 + R3[i + 100] * 9) + R1[i + 100] * H * 2) % (H * 0.8))
        c.fillStyle = 'rgba(255,' + ((120 + R3[i + 100] * 80) | 0) + ',50,' + (0.3 + R2[i + 100] * 0.5) + ')'
        c.fillRect(ex, ey, 1, 1)
      }
    },
  },
  end: {
    name: 'Край (Энд)',
    draw(c, t, mx, my) {
      const g = c.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#0D0716')
      g.addColorStop(0.6, '#1A0F2B')
      g.addColorStop(1, '#241638')
      c.fillStyle = g
      c.fillRect(0, 0, W, H)
      for (let i = 0; i < 40; i++) {
        const a = 0.2 + Math.abs(Math.sin(t * (0.5 + R3[i] * 1.5) + i)) * 0.6
        c.fillStyle = 'rgba(220,200,255,' + a + ')'
        c.fillRect(R1[i + 120] * W + mx * 2, R2[i + 120] * H * 0.7, 1, 1)
      }
      const isl: [number, number, number, number][] = [
        [0.2, 0.5, 26, 1],
        [0.55, 0.34, 36, 2],
        [0.82, 0.6, 20, 3],
      ]
      isl.forEach(([fx, fy, w, ph], i) => {
        const x = fx * W + mx * (4 + i * 3),
          y = fy * H + Math.sin(t * 0.7 + ph) * 2.5 + my * (2 + i)
        c.fillStyle = '#D8DCA8'
        c.fillRect(x, y, w, 3)
        c.fillStyle = '#8E86B8'
        c.fillRect(x + 2, y + 3, w - 4, 3)
        c.fillRect(x + 5, y + 6, w - 10, 2)
        c.fillStyle = '#5E5590'
        c.fillRect(x + 8, y + 8, w - 16, 2)
        if (i === 1) {
          c.fillStyle = '#150F22'
          c.fillRect(x + w / 2 - 2, y - 10, 4, 10)
          c.fillStyle = '#B08CFF'
          c.fillRect(x + w / 2 - 1, y - 12, 2, 2)
        }
      })
      c.fillStyle = 'rgba(176,140,255,.6)'
      for (let i = 0; i < 18; i++) {
        const px = (R3[i + 140] * W + Math.sin(t + i) * 3 + mx * 5) % W
        const py = ((t * (3 + R1[i + 140] * 6) + R2[i + 140] * H * 2) % (H + 8)) - 4
        c.fillRect(px, py, 1, 1)
      }
    },
  },
}

export interface VideoWp {
  id: string
  name: string
  src: string
  poster: string
}

// `src` is empty when the clip was not fetched from the CDN (see assets.json): the poster
// stays in the repo, so such a wallpaper degrades to a still frame instead of a black box.
export const VIDEOS: VideoWp[] = [
  { id: 'bg1', name: 'Вишнёвая роща', src: '', poster: '/bg/bg1.jpg' },
  { id: 'bg2', name: 'Уютная пещера', src: '', poster: '/bg/bg2.jpg' },
  { id: 'bg3', name: 'Солнечный город', src: '', poster: '/bg/bg3.jpg' },
  { id: 'bg4', name: 'У камина', src: '', poster: '/bg/bg4.jpg' },
].map((v) => (__BUNDLED_VIDEOS__.includes(v.id) ? { ...v, src: '/bg/' + v.id + '.mp4' } : v))

export const isVideoWp = (id: string) => VIDEOS.some((v) => v.id === id)

const brokenVideos = new Set<string>()

export const markVideoBroken = (id: string) => brokenVideos.add(id)

export const videoSrcOf = (id: string) => {
  if (brokenVideos.has(id)) return ''
  return VIDEOS.find((v) => v.id === id)?.src || ''
}
