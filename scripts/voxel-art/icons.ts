/**
 * Альтернативные иконки приложения — 3D-знак Millida в материалах и со своими сценами.
 *
 * Открывается dev-сервером Vite: http://127.0.0.1:5173/scripts/voxel-art/icons.html
 * Знак — плитка и глиф из public/millida-logo.svg (читаются оттуда же, не копируются),
 * выдавлены с фасками. У каждой иконки свой материал и элементы сцены: искры, пламя,
 * кристаллы, корона, слитки, алмазный камень, портал. Кадр — квадрат 1024 «в край»:
 * скругление, поля и тень накладывает scripts/gen-app-icons.py.
 * Сохранить: PAGE=icons node scripts/voxel-art/save.mjs <папка>, затем gen-app-icons.py --masters <папка>.
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

// Контуры берём из логотипа: плитка — контур клипа, глиф — белый путь; глиф сдвинут как в логотипе.
const logo = await (await fetch('/millida-logo.svg')).text()
const logoDoc = new DOMParser().parseFromString(logo, 'image/svg+xml')
const TILE_D = logoDoc.querySelector('clipPath path')!.getAttribute('d')!
const glyphEl = logoDoc.querySelector('g[transform] > path[fill="#FFFFFF"]')!
const GLYPH_D = glyphEl.getAttribute('d')!
const GLYPH_DY = Number(/translate\(0 (-?[\d.]+)\)/.exec(glyphEl.parentElement!.getAttribute('transform')!)![1])
const S = 10 / 376

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
const GLYPH = shapes(GLYPH_D, GLYPH_DY)
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
  /** Тёмная кайма вокруг глифа: читается на мелких размерах. */
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
const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p)
function glow(c: string, k = 1.6) {
  return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.6 })
}
function vox(parent: THREE.Object3D, x: number, y: number, z: number, s: number, m: Mat, rot = 0) {
  const b = new THREE.Mesh(cubeGeo, m)
  b.position.set(x, y, z)
  b.scale.setScalar(s)
  b.rotation.set(rot * 0.6, rot, rot * 0.3)
  b.castShadow = true
  parent.add(b)
  return b
}

/** Призма с острым концом, основание в нуле, растёт вверх по +Y. */
function crystalGeo(r: number, h: number) {
  const body = new THREE.CylinderGeometry(r, r * 1.08, h, 6, 1)
  body.translate(0, h / 2, 0)
  const tip = new THREE.ConeGeometry(r, r * 1.7, 6, 1)
  tip.translate(0, h + r * 0.85, 0)
  const m = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!
  m.computeVertexNormals()
  return m
}

/** Огранённый камень: восьмигранник с плоским столом и павильоном, центр в нуле. */
function gemGeo(r: number, h: number, cut: 'brilliant' | 'emerald' = 'brilliant') {
  const pts =
    cut === 'emerald'
      ? [[0, -h * 0.9], [r * 0.6, -h * 0.5], [r, -h * 0.2], [r, h * 0.45], [r * 0.82, h * 0.7], [0, h * 0.7]]
      : [[0, -h], [r, 0], [r, h * 0.2], [r * 0.6, h * 0.62], [0, h]]
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 8)
}

/** Слиток: трапеция в плоскости XZ, толщина по Y. */
function ingotGeo() {
  const sh = new THREE.Shape([new THREE.Vector2(-1.5, -0.8), new THREE.Vector2(1.5, -0.8), new THREE.Vector2(1.1, 0.8), new THREE.Vector2(-1.1, 0.8)])
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2, curveSegments: 1 })
  g.rotateX(-Math.PI / 2)
  g.center()
  return g
}

/** Текстура жилок: белые линии на чёрном, для emissiveMap. */
function veins(seed = 0.5) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 512
  const c = cv.getContext('2d')!
  c.fillStyle = '#000'
  c.fillRect(0, 0, 512, 512)
  c.strokeStyle = '#fff'
  c.lineCap = 'round'
  const r = (() => {
    let s = Math.floor(seed * 1e6) + 11
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  })()
  for (let k = 0; k < 16; k++) {
    let x = r() * 512
    let y = r() * 512
    let a = r() * Math.PI * 2
    c.lineWidth = 4 + r() * 6
    c.beginPath()
    c.moveTo(x, y)
    for (let i = 0; i < 9; i++) {
      a += (r() - 0.5) * 1.4
      x += Math.cos(a) * 26
      y += Math.sin(a) * 26
      c.lineTo(x, y)
    }
    c.stroke()
  }
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / 11, 1 / 11)
  t.offset.set(0.5, 0.5)
  return t
}

/** Четырёхконечная звёздочка из пяти кубиков. */
function star(parent: THREE.Object3D, x: number, y: number, z: number, s: number, m: Mat) {
  vox(parent, x, y, z, s, m)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) vox(parent, x + dx * s * 0.7, y + dy * s * 0.7, z, s * 0.45, m)
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

/** Плитка занимает ~82% тела иконки (скругление macOS): элементы сцены выходят за край недалеко. */
const SCALE = 0.98

const SPECS: Spec[] = [
  {
    id: 'spark',
    rot: [0.1, 0.18, 0],
    bg: (g, n) => {
      g.fillStyle = '#04110a'
      g.fillRect(0, 0, n, n)
      radial(g, n, 0.5, 0.5, 0.62, [[0, 'rgba(110,255,90,0.38)'], [0.4, 'rgba(40,150,60,0.2)'], [1, 'rgba(0,0,0,0)']])
      rays(g, n, 0.5, 0.5, 14, 'rgba(150,255,110,0.16)', 1)
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      root.add(
        mark({
          outline: '#000000',
          tile: phys({ color: '#0a3014', roughness: 0.35, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.2 }),
          glyph: phys({ color: '#b6ff3a', emissive: '#7dff1e', emissiveIntensity: 0.12, roughness: 0.3, clearcoat: 1 }),
        }),
      )
      const pl = new THREE.PointLight('#9cff4a', 18, 30, 1.6)
      pl.position.set(0, 0, 6)
      scene.add(pl)
      // Молнии: ступенчатые цепочки кубиков, бьют из краёв плитки наружу.
      const bolt = (x: number, y: number, dx: number, dy: number, steps: number, size: number) => {
        const len = Math.hypot(dx, dy)
        const ux = dx / len
        const uy = dy / len
        for (let i = 0; i < steps; i++) {
          const off = (i % 2 ? 0.45 : -0.45) * size
          const px = x + ux * i * size * 1.25 - uy * off
          const py = y + uy * i * size * 1.25 + ux * off
          vox(root, px, py, 2.4, size * (1 - i * 0.07), glow(i < 2 ? '#f0ffb0' : '#b8ff3a', 1.5))
        }
      }
      bolt(-5.2, 1.4, -1, 0.2, 5, 0.5)
      bolt(5.2, -1.4, 1, -0.2, 5, 0.5)
      bolt(1.6, 5.2, 0.25, 1, 4, 0.46)
      bolt(-1.8, -5.2, -0.25, -1, 4, 0.46)
      // Искры вокруг знака.
      const cols = ['#eaff9a', '#b6ff4a', '#7dff5a', '#fff6b0']
      for (let i = 0; i < 16; i++) {
        const a = rnd() * Math.PI * 2
        const r = 5.9 + rnd() * 1.1
        vox(root, Math.cos(a) * r, Math.sin(a) * r, 1.5 + rnd() * 2, 0.13 + rnd() * 0.16, glow(cols[i % 4], 1.0), rnd() * 3)
      }
      return root
    },
    bloom: [0.45, 0.3, 0.95],
    shadow: 0.15,
    studio: true,
    env: 0.45,
    exposure: 1.05,
    scale: SCALE,
    overlay: (g) => {
      glint(g, 0.2, 0.2, 0.07, '#f4ffc8')
      glint(g, 0.84, 0.26, 0.04, '#f4ffc8')
    },
  },
  {
    id: 'flame',
    rot: [0.12, -0.16, 0],
    bg: (g, n) => {
      g.fillStyle = '#120403'
      g.fillRect(0, 0, n, n)
      radial(g, n, 0.5, 1.02, 0.95, [[0, 'rgba(255,150,40,0.95)'], [0.35, 'rgba(220,60,15,0.7)'], [0.7, 'rgba(90,10,5,0.35)'], [1, 'rgba(0,0,0,0)']])
      grain(g, n, 6)
    },
    build: (scene) => {
      const root = new THREE.Group()
      root.add(
        mark({
          outline: '#3a0602',
          tile: phys({ color: '#d8321a', roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25, emissive: '#c02000', emissiveIntensity: 0.12 }),
          glyph: phys({ color: '#ffe04a', emissive: '#ffb010', emissiveIntensity: 0.35, roughness: 0.3, clearcoat: 1 }),
        }),
      )
      const pl = new THREE.PointLight('#ff7a20', 60, 40, 1.4)
      pl.position.set(0, -9, 5)
      scene.add(pl)
      // Языки пламени: столбики вокселей, у основания жарче, вверху мельче и краснее.
      const heat = ['#ffe866', '#ffc21a', '#ff8a10', '#ff4a0a', '#c81a06', '#6a0c04']
      const mats = heat.map((h, i) => glow(h, i > 3 ? 0.4 : 0.6))
      const tongue = (x: number, z: number, base: number, hgt: number, size: number) => {
        let y = base
        let s = size
        while (y < base + hgt) {
          const t = (y - base) / hgt
          const mi = Math.min(heat.length - 1, Math.floor(t * heat.length))
          vox(root, x + (rnd() - 0.5) * 0.3 * (t + 0.3), y, z, s, mats[mi], rnd() * 3)
          y += s * 0.85
          s = Math.max(0.3, s * 0.95)
        }
      }
      for (let x = -5.2; x <= 5.2; x += 0.6) {
        const e = Math.abs(x) / 5.2
        tongue(x, 2.3 + rnd() * 0.5, -5.7, 1.8 + rnd() * 1.8 + (1 - e * e) * 3.4, 0.68)
      }
      // Языки по бокам плитки.
      for (const sx of [-5.6, 5.6]) for (let k = 0; k < 2; k++) tongue(sx, 1 + k * 0.6, -5 + k * 1.2, 2.2 + rnd() * 1.4, 0.5)
      // Угли.
      for (let i = 0; i < 26; i++) vox(root, (rnd() - 0.5) * 13, -6 + rnd() * 12.5, 1 + rnd() * 3, 0.1 + rnd() * 0.16, mats[1 + (i % 3)], rnd() * 3)
      return root
    },
    bloom: [0.45, 0.4, 0.95],
    shadow: 0.2,
    env: 0.6,
    key: [-8, 12, 12, 1.2, '#ffffff'],
    scale: SCALE,
  },
  {
    id: 'amethyst',
    rot: [0.2, -0.26, 0.03],
    bg: (g, n) => {
      radial(g, n, 0.5, 0.42, 0.95, [[0, '#7b3fd0'], [0.45, '#3b1477'], [1, '#12052a']])
      rays(g, n, 0.5, 0.42, 12, 'rgba(230,180,255,0.10)', 1)
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      const crys = (tint: string, t = 1) =>
        phys({ color: tint, emissive: '#7a2bd6', emissiveIntensity: 0.18, transmission: t, thickness: 2.5, ior: 1.55, roughness: 0.06, attenuationColor: '#b46cff', attenuationDistance: 2.4, flatShading: true, specularIntensity: 1, clearcoat: 1 })
      root.add(
        mark({
          outline: '#260a52',
          tile: crys('#c9a2ff'),
          glyph: phys({ color: '#f6eeff', roughness: 0.25, clearcoat: 1, emissive: '#c9a6ff', emissiveIntensity: 0.05 }),
          seg: 1,
          bevel: 0.6,
        }),
      )
      // Друзы в четырёх углах плитки: кристаллы торчат наружу по диагонали.
      const tints = ['#c48aff', '#a865ff', '#dcb8ff', '#9b52ff']
      const cluster = (cx: number, cy: number, k: number) => {
        const a = Math.atan2(cy, cx)
        const set: [number, number, number, number][] = [
          // сдвиг вдоль стороны, радиус, высота, наклон
          [0, 0.7, 3.2, 0],
          [-0.55, 0.5, 2.2, 0.45],
          [0.55, 0.5, 2.0, -0.45],
        ]
        for (const [off, r, h, tilt] of set) {
          const m = new THREE.Mesh(crystalGeo(r, h), crys(tints[(k + Math.round(off * 3)) & 3]))
          const px = cx - Math.sin(a) * off
          const py = cy + Math.cos(a) * off
          m.position.set(px, py, 0.6)
          m.rotation.set(0, 0, a - Math.PI / 2 + tilt)
          m.castShadow = true
          root.add(m)
        }
      }
      cluster(4.3, 4.3, 0)
      cluster(-4.3, 4.3, 1)
      cluster(-4.3, -4.3, 2)
      cluster(4.3, -4.3, 3)
      const rim = new THREE.DirectionalLight('#ff9cf0', 2.2)
      rim.position.set(12, 6, -10)
      scene.add(rim)
      const rim2 = new THREE.DirectionalLight('#7cc4ff', 1.6)
      rim2.position.set(-12, -4, -6)
      scene.add(rim2)
      return root
    },
    shadow: 0.35,
    env: 1.15,
    scale: SCALE,
    overlay: (g) => {
      glint(g, 0.24, 0.19, 0.06, '#f3dcff')
      glint(g, 0.8, 0.8, 0.04, '#f3dcff')
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
      const ruby = phys({ color: '#ff2448', transmission: 0.55, thickness: 1, ior: 1.8, roughness: 0.04, flatShading: true, emissive: '#ff2448', emissiveIntensity: 0.35, clearcoat: 1 })
      root.add(
        mark({
          outline: '#050a2e',
          tile: phys({ color: '#13227a', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.5, sheenColor: '#6a7dff' }),
          glyph: gold,
          dot: ruby,
          dotGem: true,
        }),
      )
      // Пиксельная корона на верхнем крае: три зубца, камни на вершинах.
      const C = 0.7
      const crownGems = ['#3a8bff', '#ff2448', '#2ee68a']
      const cells: [number, number, Mat | null][] = []
      for (let x = -2; x <= 2; x++) {
        cells.push([x, 0, null], [x, 1, null])
        if (Math.abs(x) % 2 === 0) cells.push([x, 2, null])
      }
      const crownM = phys({ color: '#ffc547', metalness: 0.9, roughness: 0.3, emissive: '#7a5200', emissiveIntensity: 0.35, clearcoat: 0.6 })
      for (const [x, y] of cells) vox(root, x * C, 4.4 + y * C, 2.2, C * 0.98, crownM)
      crownGems.forEach((c, i) => vox(root, (i - 1) * 2 * C, 4.4 + 2.55 * C, 2.2, C * 0.7, glow(c, 0.9)))
      // Звёздочки вокруг.
      const starM = glow('#ffe7a8', 1.4)
      star(root, -5.1, 3.0, 2.2, 0.2, starM)
      star(root, 5.0, 2.4, 2.2, 0.18, starM)
      star(root, -4.6, -4.2, 2.2, 0.16, starM)
      star(root, 4.9, -4.6, 2.2, 0.2, starM)
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
    scale: SCALE,
    y: -0.25,
    overlay: (g) => {
      glint(g, 0.2, 0.3, 0.05, '#ffe7a8')
      glint(g, 0.8, 0.76, 0.04, '#ffe7a8')
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
          tile: phys({ color: '#f5b230', metalness: 0.9, roughness: 0.25, emissive: '#6a3d00', emissiveIntensity: 0.35 }),
          glyph: phys({ color: '#fff6e0', roughness: 0.25, clearcoat: 1 }),
          seg: 1,
          bevel: 0.75,
          depth: 1.3,
          glyphSeg: 1,
          glyphBevel: 0.18,
        }),
      )
      const gold = phys({ color: '#ffc13a', metalness: 0.7, roughness: 0.3, clearcoat: 0.5, emissive: '#5a3300', emissiveIntensity: 0.3 })
      // Слитки внизу, перед плиткой: два и три.
      const ingot = (x: number, y: number, z: number, rz: number) => {
        const m = new THREE.Mesh(ingotGeo(), gold)
        m.position.set(x, y, z)
        m.rotation.set(0.35, 0, rz)
        m.castShadow = true
        root.add(m)
      }
      ingot(-2.7, -5.1, 2.6, -0.05)
      ingot(-2.6, -4.2, 2.8, 0.04)
      ingot(-2.8, -3.3, 2.5, -0.08)
      ingot(2.9, -5.3, 2.6, 0.03)
      ingot(2.8, -4.4, 2.8, -0.04)
      // Монеты в верхнем углу.
      for (const [x, y, z, rz] of [[4.6, 4.5, 2.6, 0.2], [5.4, 3.5, 1.8, -0.1]] as [number, number, number, number][]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.22, 28), gold)
        c.rotation.set(Math.PI / 2 + 0.25, 0, rz)
        c.position.set(x, y, z)
        c.castShadow = true
        root.add(c)
      }
      const a = new THREE.DirectionalLight('#fff2d0', 2.4)
      a.position.set(10, -6, 10)
      scene.add(a)
      return root
    },
    shadow: 0.55,
    studio: true,
    env: 1.5,
    scale: SCALE,
    overlay: (g) => {
      glint(g, 0.25, 0.22, 0.075, '#fff6dc')
      glint(g, 0.8, 0.72, 0.045, '#fff6dc')
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
          tile: glass('#bff0ff'),
          glyph: phys({ color: '#ffffff', roughness: 0.22, clearcoat: 1, emissive: '#d8f6ff', emissiveIntensity: 0.05 }),
          dot: phys({ color: '#e6fbff', roughness: 0, metalness: 0, clearcoat: 1, emissive: '#9ff0ff', emissiveIntensity: 0.35, flatShading: true }),
          dotGem: true,
          seg: 2,
          bevel: 0.8,
          glyphSeg: 1,
        }),
      )
      // Осколки льда по краям.
      const shard = (x: number, y: number, z: number, s: number, rz: number) => {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), glass('#e8fbff'))
        m.scale.set(s * 0.7, s * 1.8, s * 0.7)
        m.position.set(x, y, z)
        m.rotation.set(0.2, 0.6, rz)
        m.castShadow = true
        root.add(m)
      }
      shard(-5.6, -4.4, 1.6, 1.4, 0.45)
      shard(5.5, 4.2, 0.2, 1.2, 0.5)
      shard(5.7, -4.0, 1.8, 1.0, -0.35)
      shard(-5.4, 4.0, 1.4, 0.8, -0.3)
      const rim = new THREE.DirectionalLight('#dff8ff', 2.0)
      rim.position.set(12, 8, -6)
      scene.add(rim)
      return root
    },
    shadow: 0.38,
    studio: true,
    env: 1.4,
    scale: SCALE,
    overlay: (g) => {
      glint(g, 0.29, 0.26, 0.085)
      glint(g, 0.7, 0.71, 0.05)
      glint(g, 0.18, 0.72, 0.03)
    },
  },
  {
    id: 'emerald',
    rot: [0.14, -0.2, 0],
    bg: (g, n) => {
      radial(g, n, 0.5, 0.45, 0.95, [[0, '#0c6a48'], [0.5, '#063a28'], [1, '#02100b']])
      rays(g, n, 0.5, 0.45, 14, 'rgba(120,255,190,0.12)', 1)
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      const emerald = (c = '#1fd07e') =>
        phys({ color: c, transmission: 0.45, thickness: 2.2, ior: 1.58, roughness: 0.08, attenuationColor: '#0a8f54', attenuationDistance: 3, emissive: c, emissiveIntensity: 0.12, clearcoat: 1, flatShading: true })
      root.add(
        mark({
          outline: '#03261a',
          tile: phys({ color: '#14b06e', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0.05 }),
          glyph: phys({ color: '#ffffff', roughness: 0.2, clearcoat: 1, emissive: '#c8ffe4', emissiveIntensity: 0.06 }),
          seg: 3,
        }),
      )
      // Кристаллы изумрудной руды: призмы из нижнего края и огранённые камни перед плиткой.
      const ore: [number, number, number, number, number, number][] = [
        // x, y, r, h, наклон, поворот
        [-3.6, -5.1, 0.7, 3.2, 0.25, 0.4],
        [-1.2, -5.5, 0.55, 2.4, -0.2, 0.9],
        [2.8, -5.2, 0.8, 3.6, -0.3, 0.2],
        [4.9, -4.4, 0.6, 2.6, -0.5, 1.1],
      ]
      for (const [x, y, r, h, tz, ry] of ore) {
        const m = new THREE.Mesh(crystalGeo(r, h), emerald())
        m.position.set(x, y, 1.2)
        m.rotation.set(0.1, ry, tz)
        m.castShadow = true
        root.add(m)
      }
      const cut = (x: number, y: number, z: number, r: number, h: number, rz: number) => {
        const m = new THREE.Mesh(gemGeo(r, h, 'emerald'), emerald('#38f0a0'))
        m.position.set(x, y, z)
        m.rotation.set(0.3, 0, rz)
        m.castShadow = true
        root.add(m)
      }
      cut(-5.2, 3.8, 2.4, 0.85, 1.4, 0.3)
      cut(5.3, 2.9, 2.2, 0.7, 1.2, -0.25)
      const rim = new THREE.DirectionalLight('#bfffe0', 1.8)
      rim.position.set(-12, 8, -6)
      scene.add(rim)
      return root
    },
    shadow: 0.35,
    studio: true,
    env: 1.2,
    scale: SCALE,
    overlay: (g) => {
      glint(g, 0.78, 0.22, 0.07, '#e6fff2')
      glint(g, 0.22, 0.78, 0.04, '#e6fff2')
    },
  },
  {
    id: 'quartz',
    rot: [0.15, 0.2, 0],
    bg: (g, n) => {
      radial(g, n, 0.5, 0.42, 1.0, [[0, '#8a2f5e'], [0.5, '#3e1229'], [1, '#14060d']])
      rays(g, n, 0.5, 0.42, 12, 'rgba(255,220,240,0.12)', 1)
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      root.add(
        mark({
          outline: '#5a1a3c',
          tile: phys({ color: '#ec6aa2', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, transmission: 0.25, thickness: 1.5, ior: 1.54, sheen: 0.4, sheenColor: '#ffd0e6' }),
          glyph: phys({ color: '#ffffff', roughness: 0.2, clearcoat: 1, emissive: '#ffe0f0', emissiveIntensity: 0.05 }),
          seg: 4,
        }),
      )
      // Кварцевые столбы: растут из нижнего края, два мелких — из верхних углов.
      const pillar = (x: number, y: number, z: number, r: number, h: number, tilt: number, c: string, tx = 0) => {
        const m = new THREE.Mesh(crystalGeo(r, h), phys({ color: c, transmission: 0.6, thickness: 2, ior: 1.54, roughness: 0.05, flatShading: true, clearcoat: 1, emissive: c, emissiveIntensity: 0.06 }))
        m.position.set(x, y, z)
        m.rotation.set(tx, 0, tilt)
        m.castShadow = true
        root.add(m)
      }
      pillar(-4.8, -5.3, 1.8, 0.7, 3.4, 0.12, '#fff5fa')
      pillar(-2.6, -5.6, 2.4, 0.8, 3.8, -0.06, '#ffd6e8')
      pillar(2.9, -5.5, 2.2, 0.8, 3.6, -0.1, '#ffc2dc')
      pillar(5.0, -4.6, 1.6, 0.6, 2.8, -0.3, '#fff5fa')
      pillar(-5.4, 3.6, 1.2, 0.5, 2.6, 0.6, '#ffd6e8')
      pillar(5.5, 4.2, 1.0, 0.45, 2.2, -0.7, '#fff5fa')
      const rim = new THREE.DirectionalLight('#ffe6f2', 2.0)
      rim.position.set(12, 8, -6)
      scene.add(rim)
      return root
    },
    shadow: 0.3,
    studio: true,
    env: 1.25,
    scale: SCALE,
    overlay: (g) => {
      glint(g, 0.26, 0.22, 0.07, '#fff0f8')
      glint(g, 0.76, 0.66, 0.04, '#fff0f8')
    },
  },
  {
    id: 'obsidian',
    rot: [0.16, -0.2, 0.02],
    bg: (g, n) => {
      g.fillStyle = '#07040c'
      g.fillRect(0, 0, n, n)
      radial(g, n, 0.5, 0.5, 0.6, [[0, 'rgba(150,80,255,0.42)'], [0.5, 'rgba(70,30,140,0.2)'], [1, 'rgba(0,0,0,0)']])
      grain(g, n, 5)
    },
    build: (scene) => {
      const root = new THREE.Group()
      const v = veins(0.37)
      const obs = phys({ color: '#150c24', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#9a5cff', emissiveMap: v, emissiveIntensity: 1.1, metalness: 0.1 })
      root.add(
        mark({
          outline: '#0a0416',
          tile: [obs, phys({ color: '#140c22', roughness: 0.3 })],
          glyph: phys({ color: '#b98cff', emissive: '#9a5cff', emissiveIntensity: 0.55, roughness: 0.25, clearcoat: 1 }),
          seg: 3,
        }),
      )
      // Портал: кольцо из кубиков за плиткой и мягкое свечение в нём.
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(6.4, 48),
        new THREE.MeshBasicMaterial({ color: '#9a5cff', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
      )
      halo.position.z = -2.6
      root.add(halo)
      const ring = new THREE.Group()
      ring.rotation.set(0.5, 0, 0.35)
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2
        const r = 6.1 + (rnd() - 0.5) * 0.9
        const col = i % 3 ? '#b98cff' : '#f0e0ff'
        vox(ring, Math.cos(a) * r, Math.sin(a) * r * 0.85, -1.4 + (rnd() - 0.5) * 0.8, 0.16 + rnd() * 0.22, glow(col, 1.3), rnd() * 3)
      }
      root.add(ring)
      const pl = new THREE.PointLight('#a070ff', 35, 40, 1.4)
      pl.position.set(0, 0, 7)
      scene.add(pl)
      const rim = new THREE.DirectionalLight('#c8a0ff', 1.6)
      rim.position.set(10, 8, -8)
      scene.add(rim)
      return root
    },
    bloom: [0.5, 0.4, 0.8],
    shadow: 0.2,
    env: 0.3,
    scale: SCALE,
    overlay: (g) => {
      glint(g, 0.8, 0.2, 0.05, '#e4d0ff')
    },
  },
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
  obj.scale.setScalar(sp.scale ?? SCALE)
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
for (const sp of SPECS) {
  if (only && !only.split(',').includes(sp.id)) continue
  art[sp.id] = shoot(sp)
  const f = document.createElement('figure')
  f.innerHTML = '<img width="256" src="' + art[sp.id] + '"><figcaption>' + sp.id + '</figcaption>'
  outEl.appendChild(f)
}
;(window as unknown as { __art: Record<string, string> }).__art = art
