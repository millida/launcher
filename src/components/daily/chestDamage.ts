import {
  AddEquation,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  DstColorFactor,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OneFactor,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  SrcColorFactor,
  TextureLoader,
  UnsignedByteType,
  ZeroFactor,
  type Texture,
} from 'three'
import { breakingStages } from '../../ipc/commands'
import { FACES, cubeBox, faceCorners, type FaceName, type RigCube } from './bbModel'

export interface CrackCell {
  x: number
  y: number
  stage: number
  light: boolean
}

export interface ChestDamage {
  set(k: number): void
  dispose(): void
}

export const STAGES = 10
const BLOCK = 16
const MIN_FACE = 5
const LIFT = 0.04
const DARK_RGB = 60
const LIGHT_RGB = 150
const FALLBACK_SEED = 1913

const DIRS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clampStep = (v: number) => Math.max(-1, Math.min(1, v))
const quantize = (s: number) => Math.max(1, Math.min(STAGES, Math.ceil(s * STAGES - 1e-6))) / STAGES

/** Stand-in frames when no installed game version has the real ones: cracks spread from the middle over ten stages. */
export function crackCells(w: number, h: number, seed: number): CrackCell[] {
  const rnd = mulberry32(seed)
  const stage = new Float32Array(w * h).fill(Infinity)
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h
  const cx = Math.floor((w - 1) / 2 + (rnd() - 0.5) * 2)
  const cy = Math.floor((h - 1) / 2 + (rnd() - 0.5) * 2)
  const reach = Math.hypot(Math.max(cx, w - 1 - cx), Math.max(cy, h - 1 - cy))
  const mark = (x: number, y: number, s: number) => {
    const i = y * w + x
    if (s < stage[i]!) stage[i] = s
  }

  const walk = (x: number, y: number, dx: number, dy: number, s0: number, depth: number) => {
    const px = -dy
    const py = dx
    let drift = rnd() < 0.5 ? -1 : 1
    for (let i = 0; inside(x, y); i++) {
      const s = Math.max(s0, (Math.hypot(x - cx, y - cy) / reach) * 0.92 + 0.05)
      mark(x, y, s)
      if (depth < 2 && i > 1 && rnd() < 0.22) {
        const side = rnd() < 0.5 ? -1 : 1
        walk(x + clampStep(dx + px * side), y + clampStep(dy + py * side), clampStep(dx + px * side), clampStep(dy + py * side), s, depth + 1)
      }
      if (depth > 0 && rnd() < 0.3) return
      if (rnd() < 0.2) drift = -drift
      const jag = rnd() < 0.5 ? drift : 0
      x += clampStep(dx + px * jag)
      y += clampStep(dy + py * jag)
    }
  }

  const arms = 4 + Math.floor(rnd() * 2)
  const turn = Math.floor(rnd() * DIRS.length)
  for (let k = 0; k < arms; k++) {
    const [dx, dy] = DIRS[(turn + Math.round((k * DIRS.length) / arms)) % DIRS.length]!
    walk(cx, cy, dx, dy, 0, 0)
  }

  const cells: CrackCell[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = stage[y * w + x]!
      if (s !== Infinity) {
        cells.push({ x, y, stage: quantize(s), light: false })
        continue
      }
      const below = inside(x, y + 1) ? stage[(y + 1) * w + x]! : Infinity
      const right = inside(x + 1, y) ? stage[y * w + x + 1]! : Infinity
      const near = Math.min(below, right)
      if (near !== Infinity && rnd() < 0.35) cells.push({ x, y, stage: quantize(near), light: true })
    }
  }
  return cells
}

/** Which of the ten frames a 0..1 damage shows: none before the first hit, the last one at full damage. */
export const stageOf = (k: number) => (k <= 0 ? -1 : Math.min(STAGES - 1, Math.ceil(k * STAGES - 1e-6) - 1))

const frameTexture = (t: Texture) => {
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.generateMipmaps = false
  t.wrapS = t.wrapT = RepeatWrapping
  t.colorSpace = SRGBColorSpace
  t.needsUpdate = true
  return t
}

function fallbackFrames(): Texture[] {
  const cells = crackCells(BLOCK, BLOCK, FALLBACK_SEED)
  return Array.from({ length: STAGES }, (_, i) => {
    const data = new Uint8Array(BLOCK * BLOCK * 4)
    for (const c of cells) {
      if (c.stage > (i + 1) / STAGES) continue
      const o = (c.y * BLOCK + c.x) * 4
      data[o] = data[o + 1] = data[o + 2] = c.light ? LIGHT_RGB : DARK_RGB
      data[o + 3] = 255
    }
    return frameTexture(new DataTexture(data, BLOCK, BLOCK, RGBAFormat, UnsignedByteType))
  })
}

async function loadFrames(): Promise<Texture[]> {
  try {
    const urls = await breakingStages()
    if (urls.length !== STAGES) return fallbackFrames()
    const loader = new TextureLoader()
    return (await Promise.all(urls.map((u) => loader.loadAsync(u)))).map(frameTexture)
  } catch {
    return fallbackFrames()
  }
}

/** The frames are shared by every chest and live as long as the page. */
let frames: Promise<Texture[]> | null = null
export const breakingFrames = () => (frames ??= loadFrames())

const OUT: Record<FaceName, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
}

/**
 * One frame covers 16 model pixels, as on a block, and its middle sits in the middle of the face:
 * the cracks grow from the centre of each half of the chest instead of from its corner.
 */
export function faceUv(face: FaceName, p: [number, number, number], mid: [number, number, number]): [number, number] {
  const d: [number, number, number] = [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]]
  const [u, v] = face === 'east' || face === 'west' ? [d[2], d[1]] : face === 'up' || face === 'down' ? [d[0], d[2]] : [d[0], d[1]]
  return [0.5 + u / BLOCK, 0.5 + v / BLOCK]
}

const span = (p: [number, number, number], q: [number, number, number]) => Math.round(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))

function faceGeometry(rc: RigCube): BufferGeometry | null {
  const { cube } = rc
  if (cube.from.some((v, i) => v > cube.to[i]!)) return null
  const [a, b] = cubeBox(cube)
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (const face of FACES) {
    if (!cube.faces[face] || face === 'down' || (face === 'up' && !rc.inLid)) continue
    const corners = faceCorners(face, a, b)
    if (span(corners[0]!, corners[1]!) < MIN_FACE || span(corners[0]!, corners[2]!) < MIN_FACE) continue
    const n = OUT[face]
    const at = pos.length / 3
    const mid = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k]!, 0) / corners.length) as [number, number, number]
    for (const c of corners) {
      pos.push(c[0] + n[0] * LIFT, c[1] + n[1] * LIFT, c[2] + n[2] * LIFT)
      uv.push(...faceUv(face, c, mid))
    }
    index.push(at, at + 2, at + 1, at + 2, at + 3, at + 1)
  }
  if (!pos.length) return null
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  return g
}

/**
 * The game's block-breaking overlay on the model faces: the frame for the current stage is blended as
 * result = 2 * frame * surface (the game's crumbling blend), so it darkens the chest texture instead of covering it.
 */
export function buildChestDamage(cubes: RigCube[], stages: Texture[]): ChestDamage | null {
  // Alpha factors keep the surface alpha: the chest canvas is composited over the page.
  const material = new MeshBasicMaterial({
    map: stages[0] ?? null,
    alphaTest: 0.1,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: DstColorFactor,
    blendDst: SrcColorFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  })
  const meshes: Mesh[] = []
  for (const rc of cubes) {
    const g = faceGeometry(rc)
    if (!g) continue
    const m = new Mesh(g, material)
    m.visible = false
    m.renderOrder = 2
    rc.holder.add(m)
    meshes.push(m)
  }
  if (!meshes.length) {
    material.dispose()
    return null
  }

  return {
    set(k) {
      const i = stageOf(k)
      for (const m of meshes) m.visible = i >= 0
      if (i >= 0 && stages[i]) material.map = stages[i]!
    },
    dispose() {
      for (const m of meshes) {
        m.removeFromParent()
        m.geometry.dispose()
      }
      material.dispose()
    },
  }
}
