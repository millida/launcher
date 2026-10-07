/**
 * Альтернативные иконки приложения — 3D-рендер знака Millida в разных материалах (06.10.2026).
 *
 * Открывается dev-сервером Vite: http://127.0.0.1:5173/scripts/voxel-art/icons.html
 * Знак (плитка со срезанными углами + белый глиф) выдавлен с фасками, у каждой иконки
 * свой материал и сцена. Кадр — квадрат 1024 «в край»: скругление, поля и тень
 * накладывает scripts/gen-app-icons.py. Сохранить: PAGE=icons node scripts/voxel-art/save.mjs <папка>.
 * В сборку лаунчера не входит.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const OUT = 1024
const N = 2048 // рендер вдвое крупнее — сглаживание при уменьшении
const FOV = 28
const DIST = 35

/* ---------- Знак ---------- */

const S = 10 / 376
const TILE_D = 'M24 0H352V24H376V352H352V376H24V352H0V24H24Z'
const GLYPH_D =
  'M210.071 120.946H120.949V254.654H254.641L254.642 165.517H299.209V254.654H299.222V299.222H76.3809V120.946H76.3672V76.3774H210.071V120.946ZM210.071 210.084H165.503V165.516H210.071V210.084ZM299.209 120.947H254.656V165.515H210.088V120.947H254.641V76.3784H299.209V120.947Z'

function shapes(d: string, dy = 0): THREE.Shape[] {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`)
  const out: THREE.Shape[] = []
  for (const p of data.paths)
    for (const sh of SVGLoader.createShapes(p)) {
      const pts = sh.getPoints().map((v) => new THREE.Vector2((v.x - 188) * S, (188 - v.y - dy) * S))
      out.push(new THREE.Shape(pts))
    }
  return out
}

const TILE = shapes(TILE_D)[0]
const GLYPH = shapes(GLYPH_D, -8) // глиф в логотипе поднят на 8
// Точка в центре — самый маленький кусок глифа.
const area = (s: THREE.Shape) => Math.abs(THREE.ShapeUtils.area(s.getPoints()))
const GLYPH_SORTED = [...GLYPH].sort((a, b) => area(a) - area(b))
const DOT = GLYPH_SORTED[0]
const GLYPH_BODY = GLYPH_SORTED.slice(1)

type Mat = THREE.Material
interface MarkOpts {
  tile: Mat | [Mat, Mat]
  glyph: Mat
  dot?: Mat
  /** Отдельная геометрия точки (камень) вместо плоской клетки. */
  dotGem?: boolean
  depth?: number
  bevel?: number
  seg?: number
  glyphDepth?: number
  glyphBevel?: number
  glyphSeg?: number
  /** Глиф крупнее плитки — для мелких размеров. */
  glyphScale?: number
  /** Тёмная кайма вокруг глифа: читается на 16–32 px. */
  outline?: string
  outlineW?: number
}

function mark(o: MarkOpts): THREE.Group {
  const g = new THREE.Group()
  const depth = o.depth ?? 1.1
  const bevel = o.bevel ?? 0.38
  const tileGeo = new THREE.ExtrudeGeometry(TILE, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: o.seg ?? 8,
    curveSegments: 1,
  })
  const tile = new THREE.Mesh(tileGeo, o.tile as THREE.Material)
  tile.castShadow = true
  tile.receiveShadow = true
  g.add(tile)
  const front = depth + bevel
  const gd = o.glyphDepth ?? 0.45
  const gb = o.glyphBevel ?? 0.13
  const opts = { depth: gd, bevelEnabled: true, bevelThickness: gb, bevelSize: gb * 0.8, bevelSegments: o.glyphSeg ?? 5, curveSegments: 1 }
  const gg = new THREE.Group()
  gg.scale.set(o.glyphScale ?? 1, o.glyphScale ?? 1, 1)
  g.add(gg)
  if (o.outline) {
    const ow = o.outlineW ?? 0.16
    const ring = new THREE.Mesh(
      new THREE.ExtrudeGeometry(GLYPH, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelOffset: ow, bevelSegments: 1, curveSegments: 1 }),
      new THREE.MeshBasicMaterial({ color: o.outline, toneMapped: false }),
    )
    ring.position.z = front + 0.005
    gg.add(ring)
  }
  const glyph = new THREE.Mesh(new THREE.ExtrudeGeometry(GLYPH_BODY, opts), o.glyph)
  glyph.position.z = front + gb - 0.02
  glyph.castShadow = true
  gg.add(glyph)
  const dotGeo = o.dotGem
    ? new THREE.ExtrudeGeometry(DOT, { depth: gd * 0.6, bevelEnabled: true, bevelThickness: 0.42, bevelSize: 0.3, bevelOffset: -0.18, bevelSegments: 1, curveSegments: 1 })
    : new THREE.ExtrudeGeometry(DOT, opts)
  const dot = new THREE.Mesh(dotGeo, o.dot ?? o.glyph)
  dot.position.z = front + (o.dotGem ? 0.42 : gb) - 0.02
  dot.castShadow = true
  gg.add(dot)
  // Центр по глубине — к нулю, чтобы поворот шёл вокруг середины.
  g.position.z = -front / 2
  const wrap = new THREE.Group()
  wrap.add(g)
  return wrap
}

/* ---------- Детали сцен ---------- */

const rnd = (() => {
  let s = 777
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
})()

const cubeGeo = new THREE.BoxGeometry(1, 1, 1)
function glow(c: string, k = 1.6) {
  return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.6 })
}
function vox(parent: THREE.Object3D, x: number, y: number, z: number, s: number, m: Mat, rot = 0) {
  const b = new THREE.Mesh(cubeGeo, m)
  b.position.set(x, y, z)
  b.scale.setScalar(s)
  b.rotation.set(rot * 0.6, rot, rot * 0.3)
  parent.add(b)
  return b
}

function crystalGeo(r: number, h: number) {
  const body = new THREE.CylinderGeometry(r, r * 1.08, h, 6, 1)
  body.translate(0, h / 2, 0)
  const tip = new THREE.ConeGeometry(r, r * 1.7, 6, 1)
  tip.translate(0, h + r * 0.85, 0)
  const m = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!
  m.computeVertexNormals()
  return m
}

function crown(gold: Mat, gems: Mat[]): THREE.Group {
  const c = new THREE.Group()
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.1, 1.3, 12, 1, true), gold)
  ;(band.material as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide
  c.add(band)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.22, 6, 24), gold)
  rim.rotation.x = Math.PI / 2
  rim.position.y = -0.62
  c.add(rim)
  const ball = new THREE.SphereGeometry(0.32, 12, 8)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.9, 4), gold)
    spike.position.set(Math.sin(a) * 2.22, 1.5, Math.cos(a) * 2.22)
    spike.rotation.y = a + Math.PI / 4
    c.add(spike)
    const b = new THREE.Mesh(ball, gold)
    b.position.set(Math.sin(a) * 2.22, 2.5, Math.cos(a) * 2.22)
    c.add(b)
    const gm = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), gems[i % gems.length])
    gm.position.set(Math.sin(a) * 2.32, 0, Math.cos(a) * 2.32)
    gm.rotation.y = a
    gm.scale.set(1, 1.25, 0.6)
    c.add(gm)
  }
  c.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return c
}

/* ---------- Фоны (2D) ---------- */

type Stops = [number, string][]
function radial(g: CanvasRenderingContext2D, n: number, cx: number, cy: number, r: number, stops: Stops) {
  const gr = g.createRadialGradient(cx * n, cy * n, 0, cx * n, cy * n, r * n)
  for (const [o, c] of stops) gr.addColorStop(o, c)
  g.fillStyle = gr
  g.fillRect(0, 0, n, n)
}
function grain(g: CanvasRenderingContext2D, n: number, k = 6) {
  const d = g.getImageData(0, 0, n, n)
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (rnd() - 0.5) * k
    d.data[i] += v
    d.data[i + 1] += v
    d.data[i + 2] += v
  }
  g.putImageData(d, 0, 0)
}
function rays(g: CanvasRenderingContext2D, n: number, cx: number, cy: number, count: number, color: string, alpha: number) {
  g.save()
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.13
    const w = 0.07 + (i % 3) * 0.03
    g.beginPath()
    g.moveTo(cx * n, cy * n)
    g.arc(cx * n, cy * n, n * 1.2, a - w / 2, a + w / 2)
    g.closePath()
    const gr = g.createRadialGradient(cx * n, cy * n, 0, cx * n, cy * n, n * 0.75)
    gr.addColorStop(0, color)
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.globalAlpha = alpha * (i % 2 ? 0.6 : 1)
    g.fill()
  }
  g.restore()
}

/** Четырёхлучевой блик поверх кадра. */
function glint(g: CanvasRenderingContext2D, x: number, y: number, r: number, color = '#ffffff') {
  const n = g.canvas.width
  x *= n
  y *= n
  r *= n
  g.save()
  g.globalCompositeOperation = 'lighter'
  const halo = g.createRadialGradient(x, y, 0, x, y, r * 0.7)
  halo.addColorStop(0, color)
  halo.addColorStop(1, 'rgba(0,0,0,0)')
  g.globalAlpha = 0.55
  g.fillStyle = halo
  g.fillRect(x - r, y - r, r * 2, r * 2)
  g.globalAlpha = 1
  g.fillStyle = color
  for (const [sx, sy] of [[1, 0.09], [0.09, 1]]) {
    g.beginPath()
    g.moveTo(x - r * sx, y)
    g.quadraticCurveTo(x, y, x, y - r * sy)
    g.quadraticCurveTo(x, y, x + r * sx, y)
    g.quadraticCurveTo(x, y, x, y + r * sy)
    g.quadraticCurveTo(x, y, x - r * sx, y)
    g.fill()
  }
  g.beginPath()
  g.moveTo(x, y - r)
  g.quadraticCurveTo(x, y, x + r * 0.09, y)
  g.quadraticCurveTo(x, y, x, y + r)
  g.quadraticCurveTo(x, y, x - r * 0.09, y)
  g.quadraticCurveTo(x, y, x, y - r)
  g.fill()
  g.restore()
}

/* ---------- Сцены ---------- */

interface Spec {
  id: string
  bg: (g: CanvasRenderingContext2D, n: number) => void
  build: (scene: THREE.Scene) => THREE.Object3D
  rot?: [number, number, number]
  scale?: number
  y?: number
  exposure?: number
  env?: number
  /** Студийные софтбоксы вместо комнаты — чёткие блики на металле и лаке. */
  studio?: boolean
  bloom?: [number, number, number]
  shadow?: number
  key?: [number, number, number, number, string]
  overlay?: (g: CanvasRenderingContext2D) => void
}

const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p)

const SPECS: Spec[] = [
  {
    id: 'default',
    bg: (g, n) => {
      radial(g, n, 0.35, 0.22, 1.05, [[0, '#ffffff'], [0.45, '#e9f6e4'], [1, '#bfdcb6']])
      grain(g, n, 4)
    },
    build: () =>
      mark({
          outline: '#1f5a17',
        tile: phys({ color: '#5ec64d', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
        glyph: phys({ color: '#ffffff', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }),
      }),
    shadow: 0.32,
    studio: true,
    env: 0.9,
  },
  {
    id: 'spark',
    rot: [0.12, 0.22, 0],
    bg: (g, n) => {
      g.fillStyle = '#04110a'
      g.fillRect(0, 0, n, n)
      radial(g, n, 0.5, 0.48, 0.62, [[0, 'rgba(110,255,90,0.38)'], [0.4, 'rgba(40,150,60,0.2)'], [1, 'rgba(0,0,0,0)']])
      rays(g, n, 0.5, 0.48, 14, 'rgba(150,255,110,0.16)', 1)
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      const m = mark({
          outline: '#000000',
        tile: phys({ color: '#0b3a17', roughness: 0.2, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }),
        glyph: phys({ color: '#a8ff3a', emissive: '#7dff1e', emissiveIntensity: 0.26, roughness: 0.3, clearcoat: 1 }),
      })
      root.add(m)
      const pl = new THREE.PointLight('#9cff4a', 30, 30, 1.6)
      pl.position.set(0, 0, 6)
      scene.add(pl)
      // Искры-кубики по орбите и молнии из угловых клеток.
      const cols = ['#eaff9a', '#b6ff4a', '#7dff5a', '#fff6b0']
      for (let i = 0; i < 22; i++) {
        const a = rnd() * Math.PI * 2
        const r = 6.6 + rnd() * 3.4
        const s = 0.14 + rnd() * rnd() * 0.4
        vox(root, Math.cos(a) * r, Math.sin(a) * r * 0.92, -1 + rnd() * 5, s, glow(cols[i % 4], 0.7), rnd() * 3)
      }
      const bolt = (x: number, y: number, dx: number, dy: number, steps: number) => {
        let px = x
        let py = y
        for (let i = 0; i < steps; i++) {
          const side = i % 2 ? 1 : -1
          px += dx + side * dy * 0.45
          py += dy - side * dx * 0.45
          vox(root, px, py, 2.4, 0.42 - i * 0.04, glow('#e8ff8a', 0.9))
        }
      }
      bolt(-5.6, 2.5, -0.55, 0.12, 5)
      bolt(5.7, -2.2, 0.55, -0.12, 5)
      bolt(2.0, 5.8, 0.15, 0.5, 4)
      bolt(-2.4, -5.9, -0.15, -0.5, 4)
      return root
    },
    bloom: [0.55, 0.3, 0.75],
    shadow: 0.15,
    studio: true,
    env: 1.1,
    exposure: 1.05,
    overlay: (g) => {
      glint(g, 0.2, 0.2, 0.07, '#f4ffc8')
      glint(g, 0.8, 0.8, 0.05, '#f4ffc8')
      glint(g, 0.84, 0.26, 0.035, '#f4ffc8')
    },
  },
  {
    id: 'flame',
    bg: (g, n) => {
      g.fillStyle = '#120403'
      g.fillRect(0, 0, n, n)
      radial(g, n, 0.5, 1.05, 0.9, [[0, 'rgba(255,150,40,0.95)'], [0.35, 'rgba(220,60,15,0.7)'], [0.7, 'rgba(90,10,5,0.35)'], [1, 'rgba(0,0,0,0)']])
      grain(g, n, 6)
    },
    build: (scene) => {
      const root = new THREE.Group()
      // Каменная плитка с лавовыми трещинами на лицевой стороне.
      const cv = document.createElement('canvas')
      cv.width = cv.height = 512
      const c = cv.getContext('2d')!
      c.fillStyle = '#000'
      c.fillRect(0, 0, 512, 512)
      c.strokeStyle = '#fff'
      c.lineCap = 'round'
      for (let k = 0; k < 16; k++) {
        let x = rnd() * 512
        let y = rnd() * 512
        let a = rnd() * Math.PI * 2
        c.lineWidth = 2 + rnd() * 5
        c.beginPath()
        c.moveTo(x, y)
        for (let i = 0; i < 9; i++) {
          a += (rnd() - 0.5) * 1.4
          x += Math.cos(a) * 26
          y += Math.sin(a) * 26
          c.lineTo(x, y)
        }
        c.stroke()
      }
      const cracks = new THREE.CanvasTexture(cv)
      cracks.wrapS = cracks.wrapT = THREE.RepeatWrapping
      cracks.repeat.set(1 / 11, 1 / 11)
      cracks.offset.set(0.5, 0.5)
      const rock = phys({ color: '#2a1c18', roughness: 0.82, emissive: '#ff5a10', emissiveIntensity: 1.6, emissiveMap: cracks })
      const rockSide = phys({ color: '#22140f', roughness: 0.9, emissive: '#ff4a0c', emissiveIntensity: 1.2, emissiveMap: cracks })
      root.add(
        mark({
          outline: '#1a0302',
          tile: [rock, rockSide],
          glyph: phys({ color: '#ffd84a', emissive: '#ffa21a', emissiveIntensity: 0.42, roughness: 0.35, metalness: 0.3 }),
          seg: 3,
        }),
      )
      const pl = new THREE.PointLight('#ff7a20', 140, 40, 1.4)
      pl.position.set(0, -9, 5)
      scene.add(pl)
      // Огонь — столбики вокселей: у основания жарче, к верху мельче и краснее.
      const heat = ['#fff4b8', '#ffd23a', '#ff9418', '#ff5a10', '#d8260a', '#7a1206']
      const mats = heat.map((h, i) => glow(h, i > 3 ? 0.55 : 0.8))
      for (let x = -10.5; x <= 10.5; x += 0.95) {
        const side = Math.abs(x) / 10.5
        const h = 3 + rnd() * 3 + side * side * 9
        for (const z of [-2.2, 3.2]) {
          if (z > 0 && Math.abs(x) < 4.5) continue
          let y = -10.5
          let s = 1.05
          while (y < -10.5 + h) {
            const t = (y + 10.5) / h
            const mi = Math.min(heat.length - 1, Math.floor(t * heat.length))
            vox(root, x + (rnd() - 0.5) * 0.35, y, z + (rnd() - 0.5) * 0.6, s, mats[mi])
            y += s * 0.92
            s = Math.max(0.3, s * 0.88)
          }
        }
      }
      for (let i = 0; i < 26; i++) vox(root, (rnd() - 0.5) * 20, -4 + rnd() * 14, -1 + rnd() * 5, 0.14 + rnd() * 0.22, mats[1 + (i % 3)], rnd() * 3)
      return root
    },
    bloom: [0.45, 0.4, 0.95],
    shadow: 0.2,
    env: 0.45,
    key: [-8, 12, 12, 1.4, '#ffd8b0'],
  },
  {
    id: 'amethyst',
    rot: [0.22, -0.3, 0.03],
    bg: (g, n) => {
      radial(g, n, 0.5, 0.38, 0.95, [[0, '#7b3fd0'], [0.45, '#3b1477'], [1, '#12052a']])
      rays(g, n, 0.5, 0.38, 12, 'rgba(230,180,255,0.10)', 1)
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      const crys = (tint: string) =>
        phys({ color: tint, emissive: '#7a2bd6', emissiveIntensity: 0.18, transmission: 1, thickness: 2.5, ior: 1.55, roughness: 0.06, attenuationColor: '#b46cff', attenuationDistance: tint === '#ecd8ff' ? 7 : 2.4, flatShading: true, specularIntensity: 1, clearcoat: 1 })
      root.add(
        mark({
          outline: '#260a52',
          tile: crys('#ecd8ff'),
          glyph: phys({ color: '#f6eeff', roughness: 0.25, clearcoat: 1, emissive: '#c9a6ff', emissiveIntensity: 0.05 }),
          seg: 1,
          bevel: 0.6,
        }),
      )
      // Друза кристаллов растёт снизу и из-за плитки.
      const cl: [number, number, number, number, number, number, number][] = [
        // x, y, z, r, h, наклон z, наклон x
        [-4.6, -7.6, -1.2, 1.3, 7.0, 0.45, 0.1],
        [-6.6, -7.0, -1.8, 0.9, 4.6, 0.95, -0.1],
        [-2.6, -8.4, 1.8, 0.75, 3.0, 0.2, 0.4],
        [4.4, -7.8, -1.0, 1.4, 8.2, -0.38, 0.05],
        [6.6, -7.0, -1.8, 0.85, 4.4, -0.95, -0.2],
        [2.6, -8.6, 1.9, 0.7, 2.8, -0.28, 0.4],
        [0.8, -8.8, 2.6, 0.55, 2.0, 0.05, 0.6],
      ]
      const tints = ['#c48aff', '#a865ff', '#dcb8ff', '#9b52ff']
      cl.forEach(([x, y, z, r, h, tz, tx], i) => {
        const m = new THREE.Mesh(crystalGeo(r, h), crys(tints[i % 4]))
        m.position.set(x, y, z)
        m.rotation.set(tx, i * 0.7, tz)
        if (y > 0) m.rotation.z += Math.PI * 0.25
        m.castShadow = true
        root.add(m)
      })
      const rim = new THREE.DirectionalLight('#ff9cf0', 2.2)
      rim.position.set(12, 6, -10)
      scene.add(rim)
      const rim2 = new THREE.DirectionalLight('#7cc4ff', 1.6)
      rim2.position.set(-12, -4, -6)
      scene.add(rim2)
      return root
    },
    bloom: undefined,
    shadow: 0.35,
    env: 1.15,
    overlay: (g) => {
      glint(g, 0.24, 0.19, 0.06, '#f3dcff')
      glint(g, 0.73, 0.74, 0.045, '#f3dcff')
      glint(g, 0.84, 0.36, 0.03, '#f3dcff')
    },
  },
  {
    id: 'legend',
    rot: [0.13, -0.17, 0],
    bg: (g, n) => {
      radial(g, n, 0.5, 0.3, 1.0, [[0, '#2f2a7a'], [0.5, '#151447'], [1, '#05051a']])
      rays(g, n, 0.5, -0.1, 18, 'rgba(255,214,120,0.22)', 1)
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      const gold = phys({ color: '#ffc547', metalness: 1, roughness: 0.2, clearcoat: 0.6 })
      const gem = (c: string) => phys({ color: c, transmission: 0.55, thickness: 1, ior: 1.8, roughness: 0.04, flatShading: true, emissive: c, emissiveIntensity: 0.35, clearcoat: 1 })
      root.add(
        mark({
          outline: '#050a2e',
          tile: phys({ color: '#0e1b6a', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.5, sheenColor: '#6a7dff' }),
          glyph: gold,
          dot: gem('#ff2448'),
          dotGem: true,
        }),
      )
      const cr = crown(gold, [gem('#ff2448'), gem('#2ee68a'), gem('#3a8bff')])
      cr.scale.setScalar(0.64)
      cr.position.set(3.5, 4.4, 1.8)
      cr.rotation.set(0.3, 0.2, -0.38)
      root.add(cr)
      const spot = new THREE.SpotLight('#fff0c8', 380, 60, 0.42, 0.6, 1.2)
      spot.position.set(-3, 22, 18)
      spot.target.position.set(0, 0, 0)
      scene.add(spot, spot.target)
      const rim = new THREE.DirectionalLight('#8aa4ff', 1.8)
      rim.position.set(14, 4, -8)
      scene.add(rim)
      return root
    },
    bloom: [0.2, 0.3, 1.2],
    shadow: 0.45,
    studio: true,
    env: 1.0,
    key: [-10, 14, 12, 1.6, '#ffffff'],
    overlay: (g) => {
      glint(g, 0.2, 0.22, 0.05, '#ffe7a8')
      glint(g, 0.8, 0.8, 0.04, '#ffe7a8')
    },
  },
  {
    id: 'gold',
    rot: [0.2, -0.24, 0],
    bg: (g, n) => {
      radial(g, n, 0.32, 0.2, 1.1, [[0, '#4a3410'], [0.55, '#21160a'], [1, '#0b0704']])
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      root.add(
        mark({
          outline: '#5a3000',
          tile: phys({ color: '#e89a22', metalness: 1, roughness: 0.2 }),
          glyph: phys({ color: '#fff6e0', roughness: 0.25, clearcoat: 1 }),
          seg: 1,
          bevel: 0.75,
          depth: 1.3,
          glyphSeg: 1,
          glyphBevel: 0.18,
        }),
      )
      const a = new THREE.DirectionalLight('#fff2d0', 2.4)
      a.position.set(10, -6, 10)
      scene.add(a)
      return root
    },
    bloom: undefined,
    shadow: 0.55,
    studio: true,
    env: 1.5,
    overlay: (g) => {
      glint(g, 0.27, 0.25, 0.075, '#fff6dc')
      glint(g, 0.77, 0.75, 0.045, '#fff6dc')
    },
  },
  {
    id: 'diamond',
    rot: [0.16, 0.28, -0.02],
    bg: (g, n) => {
      radial(g, n, 0.4, 0.28, 1.05, [[0, '#7fe3ff'], [0.45, '#1f8fd6'], [1, '#062a5c']])
      rays(g, n, 0.4, 0.28, 16, 'rgba(220,250,255,0.12)', 1)
      grain(g, n, 4)
    },
    build: (scene) => {
      const root = new THREE.Group()
      const glass = (c = '#f4fdff') =>
        phys({ color: c, transmission: 1, thickness: 3.2, ior: 2.1, dispersion: 4, roughness: 0, attenuationColor: '#a8ecff', attenuationDistance: 9, specularIntensity: 1, clearcoat: 1, flatShading: true })
      root.add(
        mark({
          outline: '#06306a',
          tile: glass(),
          glyph: phys({ color: '#ffffff', roughness: 0.22, clearcoat: 1, emissive: '#d8f6ff', emissiveIntensity: 0.05 }),
          seg: 2,
          bevel: 0.8,
          glyphSeg: 1,
        }),
      )
      const shard = (x: number, y: number, z: number, s: number, rz: number) => {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), glass('#e8fbff'))
        m.scale.set(s * 0.7, s * 1.8, s * 0.7)
        m.position.set(x, y, z)
        m.rotation.set(0.2, 0.6, rz)
        m.castShadow = true
        root.add(m)
      }
      shard(-7.4, -6.6, 1.5, 1.5, 0.45)
      shard(6.8, 5.6, -0.5, 1.1, 0.5)
      shard(8.4, -4.6, 2, 0.8, -0.35)
      shard(-8.2, 4.8, -1, 0.7, -0.4)
      const rim = new THREE.DirectionalLight('#dff8ff', 2.0)
      rim.position.set(12, 8, -6)
      scene.add(rim)
      return root
    },
    bloom: undefined,
    shadow: 0.38,
    studio: true,
    env: 1.4,
    overlay: (g) => {
      glint(g, 0.29, 0.26, 0.085)
      glint(g, 0.7, 0.71, 0.05)
      glint(g, 0.83, 0.3, 0.03)
      glint(g, 0.18, 0.72, 0.03)
    },
  },
]

/* ---------- Мелкие размеры (16–64 px) ----------
 * Плитка во весь кадр, глиф крупнее и в тёмной кайме, без россыпей и сцен:
 * у каждой иконки своя семья цвета, знак читается с 16 px. */

function small(id: string, o: MarkOpts, extra?: (scene: THREE.Scene, root: THREE.Group) => void, more: Partial<Spec> = {}): Spec {
  return {
    id: id + '-small',
    bg: (g, n) => {
      g.fillStyle = '#000'
      g.fillRect(0, 0, n, n)
    },
    build: (scene) => {
      const root = new THREE.Group()
      root.add(mark({ outlineW: 0.2, seg: 6, ...o }))
      extra?.(scene, root)
      return root
    },
    rot: [0.05, -0.07, 0],
    scale: 1.76,
    y: 0,
    shadow: 0,
    studio: true,
    env: 1,
    ...more,
  }
}

const SMALL: Spec[] = [
  small('default', {
    tile: phys({ color: '#5ec64d', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    glyph: phys({ color: '#ffffff', roughness: 0.3, clearcoat: 1 }),
    outline: '#1f5a17',
  }),
  small(
    'spark',
    {
      tile: phys({ color: '#0a2410', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
      glyph: phys({ color: '#a8ff3a', emissive: '#7dff1a', emissiveIntensity: 0.3, roughness: 0.3, clearcoat: 1 }),
      outline: '#000000',
    },
    (scene) => {
      const pl = new THREE.PointLight('#9cff4a', 40, 30, 1.6)
      pl.position.set(0, 0, 6)
      scene.add(pl)
    },
    { bloom: [0.3, 0.2, 0.85], overlay: (g) => glint(g, 0.8, 0.2, 0.09, '#f4ffc8') },
  ),
  small(
    'flame',
    {
      tile: phys({ color: '#b81e08', roughness: 0.4, clearcoat: 0.6, emissive: '#ff3a00', emissiveIntensity: 0.18 }),
      glyph: phys({ color: '#ffe14a', emissive: '#ffc000', emissiveIntensity: 0.4, roughness: 0.3, clearcoat: 1 }),
      outline: '#3a0602',
    },
    (scene) => {
      const pl = new THREE.PointLight('#ffb020', 260, 40, 1.3)
      pl.position.set(0, -12, 6)
      scene.add(pl)
    },
    { exposure: 0.85 },
  ),
  small('amethyst', {
    tile: phys({ color: '#7d3ff0', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, flatShading: true }),
    glyph: phys({ color: '#f4eaff', roughness: 0.25, clearcoat: 1 }),
    outline: '#260a52',
    seg: 1,
  }),
  small('legend', {
    tile: phys({ color: '#13227a', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 }),
    glyph: phys({ color: '#ffc547', metalness: 1, roughness: 0.38 }),
    dot: phys({ color: '#ff2448', roughness: 0.15, clearcoat: 1, emissive: '#ff2448', emissiveIntensity: 0.35 }),
    outline: '#050a2e',
  }),
  small('gold', {
    tile: phys({ color: '#f0a828', metalness: 1, roughness: 0.22 }),
    glyph: phys({ color: '#fffaf0', roughness: 0.25, clearcoat: 1 }),
    outline: '#5a3000',
  }, undefined, { env: 1.4 }),
  small('diamond', {
    tile: phys({ color: '#38c4f5', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, flatShading: true }),
    glyph: phys({ color: '#ffffff', roughness: 0.2, clearcoat: 1 }),
    outline: '#06306a',
    seg: 1,
  }, undefined, { overlay: (g) => glint(g, 0.78, 0.22, 0.1) }),
]

/* ---------- Рендер ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(N, N, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.VSMShadowMap
const pmrem = new THREE.PMREMGenerator(renderer)
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
const studioTex = (() => {
  const sc = new THREE.Scene()
  sc.background = new THREE.Color('#08080a')
  const panel = (w: number, h: number, x: number, y: number, z: number, k: number, c = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    sc.add(m)
  }
  panel(9, 6, -2, 10, 6, 5)
  panel(2.5, 12, -10, 1, 5, 3.5)
  panel(2.5, 12, 10, 2, -1, 2.5)
  panel(16, 1.6, 0, -3, 11, 1.6)
  panel(24, 6, 0, -10, 0, 0.5, '#ffe2b0')
  panel(6, 6, 6, 6, -10, 1.2, '#cfe0ff')
  panel(14, 7, 3, 5, 13, 1.1, '#fff4e0')
  return pmrem.fromScene(sc, 0.015).texture
})()

function shoot(sp: Spec): string {
  const scene = new THREE.Scene()
  scene.environment = sp.studio ? studioTex : envTex
  scene.environmentIntensity = sp.env ?? 1
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200)
  cam.position.set(0, 0, DIST)
  cam.lookAt(0, 0, 0)

  // Фон — плоскость за знаком, на неё падает тень и сквозь неё видно преломление.
  const BZ = -3
  const h = 2 * Math.tan(((FOV / 2) * Math.PI) / 180) * (DIST - BZ) * 1.01
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1024
  sp.bg(cv.getContext('2d')!, 1024)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const back = new THREE.Mesh(new THREE.PlaneGeometry(h, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
  back.position.z = BZ
  scene.add(back)
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(h, h), new THREE.ShadowMaterial({ opacity: sp.shadow ?? 0.3 }))
  catcher.position.z = BZ + 0.01
  catcher.receiveShadow = true
  scene.add(catcher)

  const [kx, ky, kz, ki, kc] = sp.key ?? [-7, 11, 16, 1.8, '#ffffff']
  const key = new THREE.DirectionalLight(kc, ki)
  key.position.set(kx, ky, kz)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = key.shadow.camera.bottom = -16
  key.shadow.camera.right = key.shadow.camera.top = 16
  key.shadow.camera.near = 1
  key.shadow.camera.far = 80
  key.shadow.radius = 14
  key.shadow.blurSamples = 20
  key.shadow.bias = -0.0005
  scene.add(key)
  scene.add(new THREE.HemisphereLight('#ffffff', '#404050', 0.5))

  const obj = sp.build(scene)
  const [rx, ry, rz] = sp.rot ?? [0.17, -0.22, 0]
  obj.rotation.set(rx, ry, rz)
  obj.scale.setScalar(sp.scale ?? 1.14)
  obj.position.y = sp.y ?? 0.15
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true
  })
  scene.add(obj)

  renderer.toneMappingExposure = sp.exposure ?? 1
  const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, samples: 4 })
  const comp = new EffectComposer(renderer, rt)
  comp.setPixelRatio(1)
  comp.setSize(N, N)
  comp.addPass(new RenderPass(scene, cam))
  if (sp.bloom) comp.addPass(new UnrealBloomPass(new THREE.Vector2(N, N), sp.bloom[0], sp.bloom[1], sp.bloom[2]))
  comp.addPass(new OutputPass())
  comp.render()

  const out = document.createElement('canvas')
  out.width = out.height = OUT
  const g = out.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(renderer.domElement, 0, 0, OUT, OUT)
  sp.overlay?.(g)
  rt.dispose()
  return out.toDataURL('image/png')
}

const only = new URLSearchParams(location.search).get('only')
const art: Record<string, string> = {}
const outEl = document.getElementById('out')!
for (const sp of [...SPECS, ...SMALL]) {
  if (only && !only.split(',').includes(sp.id)) continue
  art[sp.id] = shoot(sp)
  const f = document.createElement('figure')
  f.innerHTML = '<img width="256" src="' + art[sp.id] + '"><figcaption>' + sp.id + '</figcaption>'
  outEl.appendChild(f)
}
;(window as unknown as { __art: Record<string, string> }).__art = art
