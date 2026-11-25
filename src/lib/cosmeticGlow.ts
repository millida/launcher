import { AddEquation, CanvasTexture, CustomBlending, DoubleSide, MeshBasicMaterial, OneFactor, type Texture } from 'three'

const GRID = 32
const HALO_SIZE = 64

export type Rgb = [number, number, number]

/** Emitted light: what it covers is brightened, never darkened, over the page as well as over the figure. */
export function lightMaterial(map: Texture): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map,
    vertexColors: true,
    transparent: true,
    alphaTest: 0.004,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  })
  // The canvas is see-through: coverage has to follow the light itself, or a dim glow lays a dark patch on the page.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <premultiplied_alpha_fragment>',
      'gl_FragColor.rgb = min( gl_FragColor.rgb * gl_FragColor.a * 1.25, vec3( 1.0 ) );\ngl_FragColor.a = max( gl_FragColor.r, max( gl_FragColor.g, gl_FragColor.b ) );',
    )
  }
  material.customProgramCacheKey = () => 'millida-light'
  return material
}

let halo: Texture | null = null

/** One soft round spot shared by every glow. */
export function haloTexture(): Texture | null {
  if (halo) return halo
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = HALO_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(HALO_SIZE, HALO_SIZE)
  const mid = (HALO_SIZE - 1) / 2
  for (let y = 0; y < HALO_SIZE; y += 1) {
    for (let x = 0; x < HALO_SIZE; x += 1) {
      const d = Math.min(1, Math.hypot(x - mid, y - mid) / mid)
      const k = (1 - d) * (1 - d) * (1 - d * 0.5)
      image.data.set([255, 255, 255, Math.round(255 * k)], (y * HALO_SIZE + x) * 4)
    }
  }
  ctx.putImageData(image, 0, 0)
  halo = new CanvasTexture(canvas)
  return halo
}

const cell = (value: number, round: (n: number) => number) => Math.min(GRID - 1, Math.max(0, round(value * GRID)))

/** Colour and strength of the light a piece of the effect picture gives off. */
export class LightMap {
  private cells: Float32Array | null = null
  private asked = false

  get ready(): boolean {
    return !!this.cells
  }

  read(image: unknown): void {
    if (this.asked || !image || typeof document === 'undefined') return
    this.asked = true
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = GRID
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(image as CanvasImageSource, 0, 0, GRID, GRID)
      const data = ctx.getImageData(0, 0, GRID, GRID).data
      const cells = new Float32Array(GRID * GRID * 4)
      for (let i = 0; i < GRID * GRID; i += 1) {
        const a = (data[i * 4 + 3] as number) / 255
        for (let c = 0; c < 3; c += 1) cells[i * 4 + c] = ((data[i * 4 + c] as number) / 255) * a
        cells[i * 4 + 3] = a
      }
      this.cells = cells
    } catch {
      // A picture whose pixels may not be read gives no glow; the effect itself is drawn all the same.
    }
  }

  /** Light of the picture between these UVs (0..1, v from the top): its colour into `out`, its strength returned. */
  at(u0: number, v0: number, u1: number, v1: number, out: Rgb): number {
    const cells = this.cells
    if (!cells) return 0
    const x0 = cell(Math.min(u0, u1), Math.floor)
    const x1 = Math.max(x0, cell(Math.max(u0, u1), (n) => Math.ceil(n) - 1))
    const y0 = cell(Math.min(v0, v1), Math.floor)
    const y1 = Math.max(y0, cell(Math.max(v0, v1), (n) => Math.ceil(n) - 1))
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = (y * GRID + x) * 4
        r += cells[i] as number
        g += cells[i + 1] as number
        b += cells[i + 2] as number
        n += 1
      }
    }
    const top = Math.max(r, g, b)
    if (top <= 0) return 0
    out[0] = r / top
    out[1] = g / top
    out[2] = b / top
    return top / n
  }
}
