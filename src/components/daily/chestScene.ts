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
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three'
import type { ChestTier } from '../../lib/rubies'
import { onRenderGate, renderLive } from '../../lib/renderGate'
import { CHEST_PALETTE, faceCanvas, type FaceKind } from './chestPaint'

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
export type ChestMode = 'closed' | 'ready' | 'shake' | 'open'

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
  /** Крышка распахнулась — сигнал для звука и карточек. */
  onOpened?: () => void
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

const SPARKS = 56
const easeOutBack = (t: number) => {
  const c1 = 2.2
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function createChestScene(canvas: HTMLCanvasElement, opts: ChestSceneOptions): ChestScene | null {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const reveal = opts.framing === 'reveal'
  const camera = new PerspectiveCamera(reveal ? 32 : 30, 1, 1, 400)
  camera.position.set(0, reveal ? 20 : 17, reveal ? 70 : 48)
  camera.lookAt(0, reveal ? 12 : 8.5, 0)

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
  const sp = Array.from({ length: SPARKS }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s: 1 }))
  const dummy = new Object3D()

  let tier = opts.tier
  let mode: ChestMode = opts.mode
  let modeAt = performance.now()
  let opened = false
  let lidAngle = 0
  let frameSize = 60

  function build() {
    if (body) hop.remove(body)
    if (lidPivot) hop.remove(lidPivot)
    owned.forEach((m) => {
      ;(m as MeshLambertMaterial).map?.dispose()
      m.dispose()
    })
    owned = []
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

    const p = CHEST_PALETTE[tier]
    const glowColor = new Color(p.glow)
    glowMat.color.copy(glowColor)
    raysMat.color.copy(glowColor)
    beamMat.color.copy(glowColor)
    coreMat.color.set(p.spark)
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
      left--
    }
  }

  let raf = 0
  let last = performance.now()
  let dead = false
  let trickle = 0

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
    // Покой и «можно забрать» — 30 кадров хватает (пиксельные ступени), тряска
    // и открытие — каждый кадр монитора.
    if (idle && now - last < 32) return
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
        hopY = Math.abs(Math.sin(t * 2.4)) * 1.4
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
    } else {
      // open
      if (!opened) {
        opened = true
        if (!reduced) emit(40, 1)
        opts.onOpened?.()
      }
      const k = reduced ? 1 : Math.min(1, since / 0.42)
      lidTarget = -1.95 * (reduced ? 1 : easeOutBack(k))
      const flash = reduced ? 0 : Math.max(0, 1 - since / 0.5)
      glowK = 1.3 + flash * 2.2 + 0.15 * Math.sin(t * 2)
      raysK = Math.min(1, since / 0.5) * 0.85
      beamK = Math.min(1, since / 0.35)
      innerK = 3.2
      if (!reduced) {
        hopY = since < 0.3 ? Math.sin((since / 0.3) * Math.PI) * 3 : 0
        squash = since < 0.12 ? 1 - (since / 0.12) * 0.12 : since < 0.3 ? 0.88 + ((since - 0.12) / 0.18) * 0.12 : 1
        chest.rotation.y = -0.5 + Math.sin(t * 0.7) * 0.08
        trickle += dt * 10
        while (trickle > 1) {
          emit(1, 0.55)
          trickle -= 1
        }
      }
    }

    // Крышка догоняет цель пружиной (при открытии — сразу своей кривой).
    lidAngle = mode === 'open' ? lidTarget : lidAngle + (lidTarget - lidAngle) * Math.min(1, dt * 22)
    if (lidPivot) lidPivot.rotation.x = lidAngle
    hop.position.set(shakeX, hopY, 0)
    hop.rotation.z = shakeZ
    hop.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6)

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

    let alive = false
    for (let i = 0; i < SPARKS; i++) {
      const s = sp[i]!
      if (s.life > 0) {
        alive = true
        s.life -= dt
        s.vy -= 42 * dt
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

    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(frame)
  let inView = true
  const wake = () => {
    if (dead || raf || !renderLive()) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const offGate = onRenderGate(wake)

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
    },
    resize(w, h) {
      if (w < 1 || h < 1) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // Лучи — круг, вписанный в кадр: квадратный край плоскости не виден.
      const dist = camera.position.distanceTo(rays.position)
      const visH = 2 * dist * Math.tan((camera.fov * Math.PI) / 360)
      const size = Math.min(visH, visH * camera.aspect) * 1.0
      rays.scale.set(size, size, 1)
      frameSize = size
    },
    dispose() {
      dead = true
      offGate()
      cancelAnimationFrame(raf)
      scene.traverse((o) => {
        const m = o as Mesh
        m.geometry?.dispose?.()
      })
      ;[...owned, glowMat, raysMat, beamMat, coreMat, sparkMat].forEach((m) => {
        ;(m as MeshBasicMaterial).map?.dispose()
        m.dispose()
      })
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
