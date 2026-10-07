import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Group,
  MeshLambertMaterial,
  Mesh,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type Texture,
} from 'three'

type Vec3 = [number, number, number]
type FaceName = 'north' | 'east' | 'south' | 'west' | 'up' | 'down'

export interface BbFace {
  uv: [number, number, number, number]
  texture: number
  rotation: number
}

export interface BbCube {
  uuid: string
  from: Vec3
  to: Vec3
  origin: Vec3
  rotation: Vec3
  inflate: number
  faces: Partial<Record<FaceName, BbFace>>
}

export interface BbBone {
  uuid: string
  name: string
  origin: Vec3
  rotation: Vec3
  children: (BbBone | BbCube)[]
}

export interface BbTexture {
  source: string
  uvWidth: number
  uvHeight: number
}

export type BbChannel = 'rotation' | 'position' | 'scale'

export interface BbKeyframe {
  time: number
  value: Vec3
  interpolation: 'linear' | 'catmullrom' | 'step'
}

export interface BbClip {
  name: string
  loop: 'loop' | 'hold' | 'once'
  length: number
  tracks: { bone: string; channel: BbChannel; keys: BbKeyframe[] }[]
}

export interface BbModel {
  roots: (BbBone | BbCube)[]
  textures: BbTexture[]
  clips: BbClip[]
}

const FACES: FaceName[] = ['north', 'east', 'south', 'west', 'up', 'down']
const CHANNELS: BbChannel[] = ['rotation', 'position', 'scale']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(v: unknown, what: string): number {
  const n = typeof v === 'string' ? Number(v.trim() || '0') : v
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('bbmodel: ' + what + ' is not a number')
  return n
}

function vec(v: unknown, what: string, fallback?: Vec3): Vec3 {
  if (v === undefined && fallback) return fallback
  if (!Array.isArray(v) || v.length !== 3) throw new Error('bbmodel: ' + what + ' is not a vector')
  return [num(v[0], what), num(v[1], what), num(v[2], what)]
}

function parseCube(e: Record<string, unknown>, textureCount: number): BbCube {
  const uuid = String(e.uuid)
  const faces: BbCube['faces'] = {}
  const raw = isObj(e.faces) ? e.faces : {}
  for (const name of FACES) {
    const f = raw[name]
    // Blockbench does not render a face that has no texture assigned.
    if (!isObj(f) || f.texture === null || f.texture === undefined || f.texture === false) continue
    const texture = num(f.texture, 'face texture')
    if (!Number.isInteger(texture) || texture < 0 || texture >= textureCount) throw new Error('bbmodel: face texture out of range')
    const uv = f.uv
    if (!Array.isArray(uv) || uv.length !== 4) throw new Error('bbmodel: face uv')
    const rotation = f.rotation === undefined ? 0 : num(f.rotation, 'face rotation')
    if (![0, 90, 180, 270].includes(rotation)) throw new Error('bbmodel: face rotation')
    faces[name] = { uv: [num(uv[0], 'uv'), num(uv[1], 'uv'), num(uv[2], 'uv'), num(uv[3], 'uv')], texture, rotation }
  }
  return {
    uuid,
    from: vec(e.from, 'cube from'),
    to: vec(e.to, 'cube to'),
    origin: vec(e.origin, 'cube origin', [0, 0, 0]),
    rotation: vec(e.rotation, 'cube rotation', [0, 0, 0]),
    inflate: e.inflate === undefined ? 0 : num(e.inflate, 'inflate'),
    faces,
  }
}

function parseClip(a: Record<string, unknown>, bones: Set<string>): BbClip {
  const loop = a.loop === 'loop' || a.loop === 'hold' ? a.loop : 'once'
  const tracks: BbClip['tracks'] = []
  const animators = isObj(a.animators) ? a.animators : {}
  for (const [bone, an] of Object.entries(animators)) {
    if (!bones.has(bone) || !isObj(an) || an.type !== 'bone' || !Array.isArray(an.keyframes)) continue
    for (const channel of CHANNELS) {
      const keys: BbKeyframe[] = []
      for (const k of an.keyframes) {
        if (!isObj(k) || k.channel !== channel || !Array.isArray(k.data_points) || !isObj(k.data_points[0])) continue
        const d = k.data_points[0]
        const interpolation = k.interpolation === 'linear' || k.interpolation === 'step' ? k.interpolation : 'catmullrom'
        keys.push({ time: num(k.time, 'keyframe time'), value: [num(d.x, 'x'), num(d.y, 'y'), num(d.z, 'z')], interpolation })
      }
      if (keys.length) tracks.push({ bone, channel, keys: keys.sort((p, q) => p.time - q.time) })
    }
  }
  return { name: String(a.name ?? ''), loop, length: Math.max(0, num(a.length ?? 0, 'animation length')), tracks }
}

export function parseBbModel(text: string): BbModel {
  const j: unknown = JSON.parse(text)
  if (!isObj(j) || !Array.isArray(j.elements) || !Array.isArray(j.outliner) || !Array.isArray(j.textures)) throw new Error('bbmodel: not a Blockbench model')
  const textures: BbTexture[] = j.textures.map((t) => {
    if (!isObj(t) || typeof t.source !== 'string' || !t.source.startsWith('data:image/png;base64,')) throw new Error('bbmodel: texture must be an embedded png')
    return { source: t.source, uvWidth: num(t.uv_width ?? t.width, 'uv_width'), uvHeight: num(t.uv_height ?? t.height, 'uv_height') }
  })
  const cubes = new Map<string, BbCube>()
  for (const e of j.elements) if (isObj(e) && (e.type === undefined || e.type === 'cube') && e.visibility !== false) cubes.set(String(e.uuid), parseCube(e, textures.length))
  const groups = new Map<string, Record<string, unknown>>()
  for (const g of Array.isArray(j.groups) ? j.groups : []) if (isObj(g)) groups.set(String(g.uuid), g)
  const bones = new Set<string>()

  const node = (n: unknown, depth: number): BbBone | BbCube | null => {
    if (depth > 32) throw new Error('bbmodel: outliner is too deep')
    if (typeof n === 'string') return cubes.get(n) ?? null
    if (!isObj(n)) return null
    const uuid = String(n.uuid)
    // Older files keep bone properties inline in the outliner, newer ones in groups.
    const g = groups.get(uuid) ?? n
    if (g.visibility === false) return null
    bones.add(uuid)
    const children = (Array.isArray(n.children) ? n.children : []).map((c) => node(c, depth + 1)).filter((c): c is BbBone | BbCube => !!c)
    return { uuid, name: String(g.name ?? ''), origin: vec(g.origin, 'bone origin', [0, 0, 0]), rotation: vec(g.rotation, 'bone rotation', [0, 0, 0]), children }
  }
  const roots = j.outliner.map((n) => node(n, 0)).filter((n): n is BbBone | BbCube => !!n)
  const clips = (Array.isArray(j.animations) ? j.animations : []).filter(isObj).map((a) => parseClip(a, bones))
  return { roots, textures, clips }
}

const isBone = (n: BbBone | BbCube): n is BbBone => 'children' in n

/** Mirrors Blockbench: values hold outside the key range, catmullrom spans the neighbouring keys. */
export function sampleTrack(keys: BbKeyframe[], t: number): Vec3 {
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (!first || !last) return [0, 0, 0]
  if (t <= first.time) return first.value
  if (t >= last.time) return last.value
  let i = 0
  while (i < keys.length - 2 && keys[i + 1]!.time <= t) i++
  const a = keys[i]!
  const b = keys[i + 1]!
  if (b.time === a.time || a.interpolation === 'step') return a.value
  const k = (t - a.time) / (b.time - a.time)
  if (a.interpolation === 'catmullrom' || b.interpolation === 'catmullrom') {
    const before = keys[i - 1] ?? a
    const after = keys[i + 2] ?? b
    const curve = new CatmullRomCurve3([before, a, b, after].map((x) => new Vector3(...x.value)))
    const p = curve.getPoint((k + 1) / 3)
    return [p.x, p.y, p.z]
  }
  return [a.value[0] + (b.value[0] - a.value[0]) * k, a.value[1] + (b.value[1] - a.value[1]) * k, a.value[2] + (b.value[2] - a.value[2]) * k]
}

export function clipTime(clip: BbClip, t: number): number {
  if (clip.length <= 0) return 0
  if (clip.loop === 'loop') return ((t % clip.length) + clip.length) % clip.length
  return Math.min(Math.max(0, t), clip.length)
}

function faceCorners(face: FaceName, a: Vec3, b: Vec3): Vec3[] {
  const [x0, y0, z0] = a
  const [x1, y1, z1] = b
  switch (face) {
    case 'east':
      return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0]]
    case 'west':
      return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1]]
    case 'up':
      return [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1]]
    case 'down':
      return [[x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [x1, y0, z0]]
    case 'south':
      return [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1]]
    case 'north':
      return [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0]]
  }
}

function faceUv(f: BbFace, tex: BbTexture): [number, number][] {
  const [u1, v1, u2, v2] = f.uv
  const ring: [number, number][] = [
    [u1, v1],
    [u2, v1],
    [u2, v2],
    [u1, v2],
  ]
  const steps = f.rotation / 90
  const at = (corner: number) => ring[(corner - steps + 4) % 4]!
  const [tl, tr, br, bl] = [at(0), at(1), at(2), at(3)]
  return [tl, tr, bl, br].map(([u, v]) => [u / tex.uvWidth, 1 - v / tex.uvHeight])
}

function cubeGeometry(c: BbCube, textures: BbTexture[]): BufferGeometry | null {
  // An inverted cube (from > to) must stay inverted: Blockbench draws outlines this way.
  const grow = (lo: number, hi: number, d: number): [number, number] => (lo <= hi ? [lo - d, hi + d] : [lo + d, hi - d])
  const xs = grow(c.from[0], c.to[0], c.inflate)
  const ys = grow(c.from[1], c.to[1], c.inflate)
  const zs = grow(c.from[2], c.to[2], c.inflate)
  const a: Vec3 = [xs[0] - c.origin[0], ys[0] - c.origin[1], zs[0] - c.origin[2]]
  const b: Vec3 = [xs[1] - c.origin[0], ys[1] - c.origin[1], zs[1] - c.origin[2]]
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const g = new BufferGeometry()
  const byTexture = new Map<number, number[]>()
  for (const name of FACES) {
    const f = c.faces[name]
    if (!f) continue
    const base = pos.length / 3
    for (const p of faceCorners(name, a, b)) pos.push(...p)
    for (const t of faceUv(f, textures[f.texture]!)) uv.push(...t)
    const list = byTexture.get(f.texture) ?? []
    list.push(base, base + 2, base + 1, base + 2, base + 3, base + 1)
    byTexture.set(f.texture, list)
  }
  if (!pos.length) return null
  let start = 0
  for (const [texture, list] of byTexture) {
    index.push(...list)
    g.addGroup(start, list.length, texture)
    start += list.length
  }
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

const DEG = Math.PI / 180

export interface BbRig {
  root: Group
  /** Крышка модели (кость chest_up): к ней добавляют приоткрытие поверх клипа. */
  lid: Group | null
  pose(clip: BbClip | null, t: number): void
  dispose(): void
}

/**
 * Перекраска текстуры модели под цвет (ящики магазина, 06.10.2026): у каждого
 * пикселя оттенок становится оттенком `tint`, светлота остаётся своей,
 * насыщенность — пропорционально насыщенности цвета. Так из трёх моделей
 * сундука получаются восемь своих, а не фильтр поверх готовой картинки.
 */
export function tintPixels(data: Uint8ClampedArray, tint: string): void {
  const n = parseInt(tint.replace('#', ''), 16)
  const [th, ts] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255)
  const k = Math.min(1.4, ts / 0.7)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue
    const [, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!)
    const [r, g, b] = hslToRgb(th, Math.min(1, s * k + (ts > 0.3 ? 0.08 : 0)), l)
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)]
}

export function buildBbRig(model: BbModel, tint?: string): BbRig {
  const loader = new TextureLoader()
  const maps: Texture[] = model.textures.map((t) => {
    const map = loader.load(t.source, (ready) => {
      if (!tint) return
      const img = ready.image as HTMLImageElement
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      if (!g) return
      g.drawImage(img, 0, 0)
      const px = g.getImageData(0, 0, c.width, c.height)
      tintPixels(px.data, tint)
      g.putImageData(px, 0, 0)
      ;(ready as unknown as { image: unknown }).image = c
      ready.needsUpdate = true
    })
    map.magFilter = NearestFilter
    map.minFilter = NearestFilter
    map.generateMipmaps = false
    map.colorSpace = SRGBColorSpace
    return map
  })
  const materials: Material[] = maps.map((map) => new MeshLambertMaterial({ map, alphaTest: 0.5 }))
  const geometries: BufferGeometry[] = []
  const rest = new Map<string, { obj: Group; position: Vec3; rotation: Vec3 }>()
  let lid: Group | null = null

  const place = (n: BbBone | BbCube, parentOrigin: Vec3): Group => {
    const obj = new Group()
    const position: Vec3 = [n.origin[0] - parentOrigin[0], n.origin[1] - parentOrigin[1], n.origin[2] - parentOrigin[2]]
    obj.position.set(...position)
    obj.rotation.order = 'ZYX'
    obj.rotation.set(n.rotation[0] * DEG, n.rotation[1] * DEG, n.rotation[2] * DEG)
    if (isBone(n)) {
      rest.set(n.uuid, { obj, position, rotation: n.rotation })
      if (n.name === 'chest_up') lid = obj
      for (const c of n.children) obj.add(place(c, n.origin))
    } else {
      const geo = cubeGeometry(n, model.textures)
      if (geo) {
        geometries.push(geo)
        obj.add(new Mesh(geo, materials))
      }
    }
    return obj
  }

  const root = new Group()
  for (const n of model.roots) root.add(place(n, [0, 0, 0]))

  return {
    root,
    lid,
    pose(clip, t) {
      for (const { obj, position, rotation } of rest.values()) {
        obj.position.set(...position)
        obj.rotation.set(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG)
        obj.scale.set(1, 1, 1)
      }
      if (!clip) return
      const at = clipTime(clip, t)
      for (const tr of clip.tracks) {
        const bone = rest.get(tr.bone)
        if (!bone) continue
        const [x, y, z] = sampleTrack(tr.keys, at)
        const o = bone.obj
        if (tr.channel === 'rotation') o.rotation.set(o.rotation.x + x * DEG, o.rotation.y + y * DEG, o.rotation.z + z * DEG)
        else if (tr.channel === 'position') o.position.set(o.position.x + x, o.position.y + y, o.position.z + z)
        else o.scale.set(x, y, z)
      }
    },
    dispose() {
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      maps.forEach((m) => m.dispose())
    },
  }
}
