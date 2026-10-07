import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Material,
  type Texture,
} from 'three'
import { acquireChestGl } from './chestGl'
import type { ChestTier } from '../../lib/rubies'
import { onRenderGate, renderLive } from '../../lib/renderGate'
import { CHEST_PALETTE, faceCanvas, type FaceKind } from './chestPaint'
import { buildBbRig, type BbRig } from './bbModel'
import { chestModel, type ChestModel } from './chestModels'

/**
 * Воксельный сундук Minecraft на three.js (23.09.2026, «сундуки выглядят
 * совсем хуёво, нужно конкретно охуенно»).
 *
 * Модуль грузится только через `import('./chestScene')` из Chest3D.tsx, поэтому
 * three не попадает в главный чанк лаунчера.
 *
 * Размеры — в текселях, как у сундука в игре: корпус 14×10×14, крышка
 * 14×5×14 на петле у задней кромки, замок 2×4×1. Текстуры рисует chestPaint.ts.
 *
 * Режимы:
 * - `closed` — забран сегодня: стоит, чуть покачивается, без света;
 * - `ready`  — ждёт: подпрыгивает, крышка подрагивает, светится ореол;
 * - `shake`  — открывается: тряска нарастает, из щели бьёт свет;
 * - `open`   — крышка откинута, столб света цвета редкости, искры, лучи.
 */
/** Свой цвет модели по силе сундука: легендарный — золото на модели алмазного. */
const tintOf = (_tier: ChestTier): string | undefined => undefined

export type ChestMode = 'closed' | 'ready' | 'shake' | 'open'
export type ChestLook = 'voxel' | 'model'

export interface ChestScene {
  setMode(mode: ChestMode): void
  /** Сундук на экране: за краем прокрутки в покое не рисуется. */
  setVisible(visible: boolean): void
  setTier(tier: ChestTier): void
  resize(w: number, h: number): void
  dispose(): void
}

export interface ChestSceneOptions {
  tier: ChestTier
  mode: ChestMode
  reduced: boolean
  /** Крупный план (окно награды) или витрина (шапка окна трека). */
  framing?: 'hero' | 'reveal'
  look?: ChestLook
  /** Свой цвет сундука (ящики магазина): текстура модели и свет перекрашены. */
  tint?: string
  /** Кадр читается с холста (снимки сундуков в PNG, scripts/chest-shots.mjs). */
  preserve?: boolean
  /** Крышка распахнулась — сигнал для звука и карточек. */
  onOpened?: () => void
  /** Общий контекст WebGL отобрали — дальше плоский рисунок. */
  onLost?: () => void
}

const tex = (canvas: HTMLCanvasElement): Texture => {
  const t = new CanvasTexture(canvas)
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.generateMipmaps = false
  t.colorSpace = SRGBColorSpace
  return t
}

/** Шесть граней бокса в порядке three: +x, -x, +y, -y, +z (перед), -z. */
function boxMaterials(tier: ChestTier, w: number, h: number, d: number, faces: FaceKind[], seed: number) {
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ]
  return faces.map((kind, i) => {
    const [fw, fh] = dims[i]!
    return new MeshLambertMaterial({ map: tex(faceCanvas(kind, tier, fw, fh, seed + i * 7)) })
  })
}

/** Мягкое пятно света для ореола: радиальная заливка на холсте. */
function glowTexture(): Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Лучи «солнца» за сундуком, как на экране награды в Brawl Stars. */
function raysTexture(): Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.translate(128, 128)
  const n = 14
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 128)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, 128, a - 0.09, a + 0.09)
    ctx.closePath()
    ctx.fill()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Столб света: ярко у основания, тает кверху. */
function beamTexture(): Texture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 128, 0, 0)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 128)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Луч из щели: мягкие края по ширине, плавное таяние кверху. */
function fanTexture(): Texture {
  const w = 64
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1) // 0 — верх, 1 — основание
    const fade = Math.pow(v, 1.7)
    for (let x = 0; x < w; x++) {
      const u = (x / (w - 1)) * 2 - 1
      const edge = Math.pow(Math.max(0, 1 - u * u), 2.2)
      const a = Math.round(255 * fade * edge)
      const i = (y * w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = a
    }
  }
  ctx.putImageData(img, 0, 0)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

const SPARKS = 56
/** Приоткрытие крышки: ~17°, дыхание ±3°. */
const AJAR = 0.3
const BREATH = 0.052
const FAN = [
  { a: -0.62, w: 5, h: 17, o: 0.5, sp: 0.9, ph: 0.3, core: false },
  { a: -0.36, w: 6, h: 22, o: 0.75, sp: 1.3, ph: 2.1, core: false },
  { a: -0.14, w: 4, h: 26, o: 0.9, sp: 1.1, ph: 4.0, core: true },
  { a: 0.1, w: 7, h: 25, o: 0.85, sp: 0.8, ph: 1.2, core: false },
  { a: 0.34, w: 5, h: 21, o: 0.7, sp: 1.5, ph: 3.3, core: true },
  { a: 0.6, w: 5, h: 16, o: 0.5, sp: 1.0, ph: 5.2, core: false },
]
const MODEL_SCALE = 15 / 16
const SHAKE_IDLE_SPEED = 1.8
const easeOutBack = (t: number) => {
  const c1 = 2.2
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function createChestScene(canvas: HTMLCanvasElement, opts: ChestSceneOptions): ChestScene | null {
  // Свой холст — 2D: кадр рисует общий контекст сундуков (chestGl).
  const ctx2dOrNull = canvas.getContext('2d')
  if (!ctx2dOrNull) return null
  const glOrNull = acquireChestGl(() => opts.onLost?.())
  if (!glOrNull) return null
  const ctx2d: CanvasRenderingContext2D = ctx2dOrNull
  const gl = glOrNull

  const scene = new Scene()
  const reveal = opts.framing === 'reveal'
  const camera = new PerspectiveCamera(reveal ? 32 : 30, 1, 1, 400)
  // Designer models carry decorations above the lid and jump while opening, so they need a taller frame.
  const aim = (tall: boolean) => {
    if (tall) camera.position.set(0, reveal ? 26 : 22, reveal ? 84 : 62)
    else camera.position.set(0, reveal ? 20 : 17, reveal ? 70 : 48)
    camera.lookAt(0, tall ? (reveal ? 15 : 12) : reveal ? 12 : 8.5, 0)
  }

  scene.add(new AmbientLight(0xffffff, 1.35))
  const sun = new DirectionalLight(0xffffff, 2.1)
  sun.position.set(20, 40, 30)
  scene.add(sun)
  const inner = new PointLight(0xffffff, 0, 60, 1.6)
  inner.position.set(0, 13, 3)
  scene.add(inner)

  // Ореол и лучи — за сундуком.
  const glowMat = new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true })
  const glow = new Sprite(glowMat)
  glow.position.set(0, 8, -12)
  scene.add(glow)

  const raysMat = new MeshBasicMaterial({
    map: raysTexture(),
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
  })
  const rays = new Mesh(new PlaneGeometry(1, 1), raysMat)
  rays.position.set(0, 10, -20)
  scene.add(rays)

  const chest = new Group()
  scene.add(chest)
  const hop = new Group()
  chest.add(hop)

  let body: Mesh | null = null
  let lidPivot: Group | null = null
  let owned: Material[] = []
  let rig: BbRig | null = null
  let rigModel: ChestModel | null = null

  // Столб света и искры.
  const beamMat = new MeshBasicMaterial({
    map: beamTexture(),
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
  })
  // Столб тает кверху в пределах кадра: край холста не должен резать свет.
  const BEAM_H = 30
  const beam = new Mesh(new CylinderGeometry(6.5, 5, BEAM_H, 20, 1, true), beamMat)
  beam.position.set(0, 10 + BEAM_H / 2, 0)
  beam.scale.set(1, 0.001, 1)
  hop.add(beam)
  const coreMat = beamMat.clone()
  const core = new Mesh(new CylinderGeometry(3, 2.4, BEAM_H, 12, 1, true), coreMat)
  core.position.copy(beam.position)
  core.scale.copy(beam.scale)
  hop.add(core)

  const sparkMat = new MeshBasicMaterial({ color: 0xffffff })
  const sparks = new InstancedMesh(new BoxGeometry(0.9, 0.9, 0.9), sparkMat, SPARKS)
  sparks.instanceMatrix.setUsage(DynamicDrawUsage)
  sparks.frustumCulled = false
  hop.add(sparks)
  const sp = Array.from({ length: SPARKS }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s: 1, g: 42 }))
  const dummy = new Object3D()

  // Свет из щели: веер лучей + пятно света на открытом верху корпуса.
  const fanTex = fanTexture()
  const fan = new Group()
  hop.add(fan)
  const fanGeo = new PlaneGeometry(1, 1)
  fanGeo.translate(0, 0.5, 0)
  const fanBeams = FAN.map((f) => {
    const mat = new MeshBasicMaterial({ map: fanTex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, side: DoubleSide })
    const m = new Mesh(fanGeo, mat)
    m.scale.set(f.w, f.h, 1)
    m.rotation.z = f.a
    m.renderOrder = 3
    fan.add(m)
    return { m, mat, f }
  })
  const gapTex = glowTexture()
  const gapMat = new SpriteMaterial({ map: gapTex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
  const gapGlow = new Sprite(gapMat)
  gapGlow.renderOrder = 4
  hop.add(gapGlow)
  const poolMat = new MeshBasicMaterial({ map: gapTex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
  const pool = new Mesh(new PlaneGeometry(12.6, 12.6), poolMat)
  pool.rotation.x = -Math.PI / 2
  hop.add(pool)
  let fanK = 0
  let gapY = 10

  let tier = opts.tier
  let mode: ChestMode = opts.mode
  let modeAt = performance.now()
  let opened = false
  let lidAngle = 0
  let frameSize = 60

  function build() {
    if (body) hop.remove(body)
    if (lidPivot) hop.remove(lidPivot)
    body = null
    lidPivot = null
    owned.forEach((m) => {
      ;(m as MeshLambertMaterial).map?.dispose()
      m.dispose()
    })
    owned = []
    if (rig) {
      hop.remove(rig.root)
      rig.dispose()
      rig = null
    }
    rigModel = opts.look === 'model' ? chestModel(tier) : null
    aim(!!rigModel)
    gapY = rigModel ? 7.6 : 10
    fan.position.set(0, gapY + 0.2, 8.5)
    gapGlow.position.set(0, gapY + 1.2, 8)
    pool.position.set(0, gapY + 0.08, 0)
    if (rigModel) {
      rig = buildBbRig(rigModel.model, opts.tint ?? tintOf(tier))
      // Model front faces -z (north); the scene shows +z to the camera.
      rig.root.rotation.y = Math.PI
      rig.root.scale.setScalar(MODEL_SCALE)
      hop.add(rig.root)
    } else buildVoxel()
    paint()
  }

  function buildVoxel() {
    const bodyMats = boxMaterials(tier, 14, 10, 14, ['bodySide', 'bodySide', 'inside', 'bottom', 'bodyFront', 'bodyBack'], 11)
    body = new Mesh(new BoxGeometry(14, 10, 14), bodyMats)
    body.position.set(0, 5, 0)
    hop.add(body)

    lidPivot = new Group()
    lidPivot.position.set(0, 10, -7)
    const lidMats = boxMaterials(tier, 14, 5, 14, ['lidSide', 'lidSide', 'lidTop', 'inside', 'lidFront', 'lidSide'], 23)
    const lid = new Mesh(new BoxGeometry(14, 5, 14), lidMats)
    lid.position.set(0, 2.5, 7)
    lidPivot.add(lid)
    const latchMats = boxMaterials(tier, 2, 4, 1, ['latch', 'latch', 'latch', 'latch', 'latch', 'latch'], 3)
    const latch = new Mesh(new BoxGeometry(2, 4, 1), latchMats)
    latch.position.set(0, 0.5, 14.5)
    lidPivot.add(latch)
    hop.add(lidPivot)
    owned = [...bodyMats, ...lidMats, ...latchMats]
  }

  function paint() {
    const t = opts.tint ?? tintOf(tier)
    const p = t ? { glow: t, spark: '#ffffff' } : CHEST_PALETTE[tier]
    const glowColor = new Color(p.glow)
    glowMat.color.copy(glowColor)
    raysMat.color.copy(glowColor)
    beamMat.color.copy(glowColor)
    coreMat.color.set(p.spark)
    gapMat.color.copy(glowColor)
    poolMat.color.copy(glowColor)
    for (const b of fanBeams) b.mat.color.set(b.f.core ? p.spark : p.glow)
    inner.color.copy(glowColor)
    const c1 = new Color(p.glow)
    const c2 = new Color(p.spark)
    const white = new Color(0xffffff)
    for (let i = 0; i < SPARKS; i++) sparks.setColorAt(i, i % 3 === 0 ? white : i % 2 ? c1 : c2)
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true
  }
  build()

  // Вид три четверти: видно перед и правый бок, как у предмета в инвентаре.
  chest.rotation.y = -0.5
  chest.position.y = reveal ? 2 : 0

  /** Лёгкие искры, плывущие вверх из щели. */
  function emitGap(n: number) {
    let left = n
    for (const s of sp) {
      if (left <= 0) break
      if (s.life > 0) continue
      s.x = (Math.random() - 0.5) * 11
      s.z = 3 + Math.random() * 4.5
      s.y = gapY + 0.6
      s.vx = (Math.random() - 0.5) * 2.4
      s.vz = (Math.random() - 0.2) * 1.4
      s.vy = 6 + Math.random() * 7
      s.g = 1.2 + Math.random() * 1.6
      s.max = s.life = 1.7 + Math.random() * 1.2
      s.s = 0.28 + Math.random() * 0.4
      left--
    }
  }

  function emit(n: number, power: number) {
    let left = n
    for (const s of sp) {
      if (left <= 0) break
      if (s.life > 0) continue
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 5
      s.x = Math.cos(a) * r
      s.z = Math.sin(a) * r
      s.y = 10
      const sp2 = (0.5 + Math.random()) * power
      s.vx = Math.cos(a) * sp2 * 9
      s.vz = Math.sin(a) * sp2 * 9
      s.vy = (26 + Math.random() * 30) * power
      s.max = s.life = 0.9 + Math.random() * 0.9
      s.s = 0.6 + Math.random() * 0.9
      s.g = 42
      left--
    }
  }

  let raf = 0
  let last = performance.now()
  let dead = false
  let trickle = 0
  let ambient = 0

  function frame(now: number) {
    if (dead) return
    // Игра поверх, окно убрано или сундук прокручен за край — стоит; цикл
    // снова заведёт гейт или setVisible.
    const idle = mode === 'closed' || mode === 'ready'
    if (!renderLive() || (!inView && idle)) {
      raf = 0
      return
    }
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = now / 1000
    const since = (now - modeAt) / 1000
    const reduced = opts.reduced

    let glowK = 0
    let raysK = 0
    let beamK = 0
    let innerK = 0
    let shakeX = 0
    let shakeZ = 0
    let hopY = 0
    let squash = 1
    let lidTarget = 0

    if (mode === 'closed') {
      chest.rotation.y = -0.5 + (reduced ? 0 : Math.sin(t * 0.6) * 0.06)
    } else if (mode === 'ready') {
      chest.rotation.y = -0.5 + (reduced ? 0 : Math.sin(t * 0.9) * 0.12)
      glowK = 0.55 + 0.25 * Math.sin(t * 3.2)
      raysK = 0.18
      if (!reduced) {
        hopY = rigModel ? 0 : Math.abs(Math.sin(t * 2.4)) * 1.4
        // Раз в пару секунд крышка подпрыгивает — сундук просится открыть.
        const k = (t % 2.6) / 2.6
        if (k > 0.82) lidTarget = -Math.sin(((k - 0.82) / 0.18) * Math.PI) * 0.22
        innerK = lidTarget < 0 ? 0.8 : 0
      }
    } else if (mode === 'shake') {
      const k = Math.min(1, since / 1.3)
      glowK = 0.6 + k * 0.8
      raysK = 0.2 + k * 0.4
      innerK = 0.6 + k * 2.4
      if (!reduced) {
        const amp = 0.04 + k * 0.16
        shakeZ = Math.sin(t * (30 + k * 26)) * amp
        shakeX = Math.sin(t * (24 + k * 20) + 1.3) * amp * 5
        lidTarget = -Math.abs(Math.sin(t * (18 + k * 16))) * (0.05 + k * 0.2)
        squash = 1 - Math.abs(Math.sin(t * 22)) * 0.03 * k
        trickle += dt * (4 + k * 18)
        while (trickle > 1) {
          emit(1, 0.35)
          trickle -= 1
        }
      }
    } else if (rigModel && !reduced && since < rigModel.lidAt) {
      glowK = 1.4
      raysK = 0.6
      innerK = 3
    } else {
      // open
      if (!opened) {
        opened = true
        if (!reduced) emit(40, 1)
        opts.onOpened?.()
      }
      const lit = since - (rigModel && !reduced ? rigModel.lidAt : 0)
      const k = reduced ? 1 : Math.min(1, lit / 0.42)
      lidTarget = -1.95 * (reduced ? 1 : easeOutBack(k))
      const flash = reduced ? 0 : Math.max(0, 1 - lit / 0.5)
      glowK = 1.3 + flash * 2.2 + 0.15 * Math.sin(t * 2)
      raysK = Math.min(1, lit / 0.5) * 0.85
      beamK = Math.min(1, lit / 0.35)
      innerK = 3.2
      if (!reduced) {
        if (!rigModel) {
          hopY = lit < 0.3 ? Math.sin((lit / 0.3) * Math.PI) * 3 : 0
          squash = lit < 0.12 ? 1 - (lit / 0.12) * 0.12 : lit < 0.3 ? 0.88 + ((lit - 0.12) / 0.18) * 0.12 : 1
        }
        chest.rotation.y = -0.5 + Math.sin(t * 0.7) * 0.08
        trickle += dt * 10
        while (trickle > 1) {
          emit(1, 0.55)
          trickle -= 1
        }
      }
    }

    // Крышка всегда чуть приоткрыта и «дышит»; в open её ведёт своя кривая.
    const ajar = mode === 'open' ? 0 : AJAR + (reduced ? 0 : Math.sin(t * 1.4) * BREATH)
    if (!rigModel) lidTarget -= ajar
    const fanTarget = mode === 'open' ? 0.3 : mode === 'shake' ? 1.25 : mode === 'ready' ? 1 : 0.62
    fanK = reduced ? fanTarget : fanK + (fanTarget - fanK) * Math.min(1, dt * 5)
    // Крышка догоняет цель пружиной (при открытии — сразу своей кривой).
    lidAngle = mode === 'open' ? lidTarget : lidAngle + (lidTarget - lidAngle) * Math.min(1, dt * 22)
    if (lidPivot) lidPivot.rotation.x = lidAngle
    if (rig && rigModel) {
      if (mode === 'open') rig.pose(rigModel.open, reduced ? Infinity : since)
      else if (reduced || mode === 'closed') rig.pose(null, 0)
      else rig.pose(rigModel.idle, mode === 'shake' ? since * SHAKE_IDLE_SPEED : t)
      if (rig.lid && mode !== 'open') rig.lid.rotation.x += ajar
    }
    hop.position.set(shakeX, hopY, 0)
    hop.rotation.z = shakeZ
    hop.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6)

    const bloom = mode === 'open' ? 0 : fanK * 0.5 * (1 + 0.15 * (reduced ? 0 : Math.sin(t * 1.8)))
    glowK += bloom
    const gs = Math.min(frameSize * 0.95, 30 + glowK * 12)
    glow.scale.set(gs, gs, 1)
    glowMat.opacity = Math.min(1, glowK * 0.55)
    raysMat.opacity = raysK
    rays.rotation.z = t * 0.25
    beamMat.opacity = beamK * (0.55 + 0.1 * Math.sin(t * 5))
    coreMat.opacity = beamK * 0.8
    beam.scale.y = core.scale.y = Math.max(0.001, beamK)
    beam.position.y = core.position.y = 10 + (BEAM_H / 2) * beamK
    inner.intensity = innerK * 900

    // Веер света и пятно в щели; лучи всегда смотрят в камеру.
    fan.rotation.y = -chest.rotation.y
    const pulse = reduced ? 0 : Math.sin(t * 1.8)
    for (const b of fanBeams) {
      const w = reduced ? 0 : Math.sin(t * b.f.sp + b.f.ph)
      b.mat.opacity = Math.min(1, fanK * b.f.o * 0.85 * (0.7 + 0.3 * w))
      b.m.scale.set(b.f.w * (1 + 0.1 * w), b.f.h * (1 + 0.07 * w + 0.03 * pulse), 1)
      b.m.rotation.z = b.f.a + w * 0.035
    }
    const gk = fanK * (0.85 + 0.15 * pulse)
    gapMat.opacity = Math.min(1, gk * 0.8)
    gapGlow.scale.set(15 + 3 * gk, 11 + 2 * gk, 1)
    poolMat.opacity = Math.min(1, gk * 0.9)
    if (!reduced && mode !== 'open') {
      ambient += dt * (mode === 'closed' ? 3.5 : mode === 'shake' ? 9 : 6)
      while (ambient > 1) {
        emitGap(1)
        ambient -= 1
      }
    }

    let alive = false
    for (let i = 0; i < SPARKS; i++) {
      const s = sp[i]!
      if (s.life > 0) {
        alive = true
        s.life -= dt
        s.vy -= s.g * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.z += s.vz * dt
        const k = Math.max(0, s.life / s.max)
        dummy.position.set(s.x, s.y, s.z)
        dummy.rotation.set(t * 3 + i, t * 2 + i, 0)
        dummy.scale.setScalar(s.s * k)
      } else {
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(0.0001)
      }
      dummy.updateMatrix()
      sparks.setMatrixAt(i, dummy.matrix)
    }
    sparks.visible = alive
    sparks.instanceMatrix.needsUpdate = true

    gl.draw(scene, camera, ctx2d, canvas.width, canvas.height)
  }
  raf = requestAnimationFrame(frame)
  let inView = true
  const wake = () => {
    if (dead || raf || !renderLive()) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const offGate = onRenderGate(wake)

  function fitRays() {
    // Лучи — круг, вписанный в кадр: квадратный край плоскости не виден.
    const dist = camera.position.distanceTo(rays.position)
    const visH = 2 * dist * Math.tan((camera.fov * Math.PI) / 360)
    const size = Math.min(visH, visH * camera.aspect) * 1.0
    rays.scale.set(size, size, 1)
    frameSize = size
  }

  return {
    setVisible(v) {
      inView = v
      wake()
    },
    setMode(next) {
      if (next === mode) return
      mode = next
      modeAt = performance.now()
      wake()
      if (next !== 'open') opened = false
    },
    setTier(next) {
      if (next === tier) return
      tier = next
      build()
      fitRays()
    },
    resize(w, h) {
      if (w < 1 || h < 1) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      fitRays()
    },
    dispose() {
      dead = true
      offGate()
      cancelAnimationFrame(raf)
      scene.traverse((o) => {
        const m = o as Mesh
        m.geometry?.dispose?.()
      })
      rig?.dispose()
      fanTex.dispose()
      gapTex.dispose()
      ;[...owned, glowMat, raysMat, beamMat, coreMat, sparkMat, gapMat, poolMat, ...fanBeams.map((b) => b.mat)].forEach((m) => {
        ;(m as MeshBasicMaterial).map?.dispose()
        m.dispose()
      })
      gl.release()
    },
  }
}
