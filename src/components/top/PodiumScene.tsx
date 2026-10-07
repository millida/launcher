import { useEffect, useRef, useState } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
} from 'three'
import { loadMine3d } from '../../lib/mine3d'
import type { SkinAnimation, SkinAnimId, SkinViewEngine } from '../../vendor/mine3d'
import { MILLIDA_LIGHT, cosmeticModel, safeSkinUrl as nickSkinUrl, releaseEngine } from '../../lib/characterStage'
import { detectSlimFromUrl } from '../../lib/skinArms'
import { headLook } from '../../lib/headLook'
import { loadCosmeticCatalog, type CosmeticItem } from '../../lib/gameProfile'
import { readAnimations } from '../../lib/cosmeticAnimation'
import { CosmeticEmote, emoteClip } from '../../lib/cosmeticEmote'
import { emoteSequence } from '../../lib/emoteSequence'
import { gpuLite, noteContextCreated, noteContextLost } from '../../lib/gpuLite'
import { onRenderGate, renderLive } from '../../lib/renderGate'
import { Icon } from '../Icon'
import { boardValueText, type Board, type BoardEntry } from '../../state/boards'

/** Места на пьедестале: x блока, высота блока, цвет блока, поворот к центру, номер эмоции. */
const SPOTS: Record<1 | 2 | 3, { x: number; h: number; tone: [string, string, string]; yaw: number; show: SkinAnimId }> = {
  1: { x: 0, h: 12, tone: ['#ffd84a', '#e8a91f', '#a8700f'], yaw: 0, show: 'victory' },
  2: { x: -19, h: 8, tone: ['#eef2f4', '#c3cbd0', '#858f96'], yaw: 0.12, show: 'dance' },
  3: { x: 19, h: 5, tone: ['#f0a070', '#c8693a', '#86401f'], yaw: -0.12, show: 'wave' },
}
const BLOCK_W = 14
/** Ступни фигуры skin3d — на 16 единиц ниже её начала; пол движка там же. */
const FEET = 16
/** Камера движка смотрит с азимута (-0.58, 0.78): сцену доворачиваем к ней лицом. */
const FACE_CAMERA = Math.atan2(-0.58, 0.78)
/** Эмоции места из библиотеки каталога (по порядку предпочтения) и встроенная замена. */
const EMOTES: Record<1 | 2 | 3, { ids: string[]; builtin: SkinAnimId }> = {
  1: { ids: ['PIGLIN_VICTORY', 'DAB', 'YES'], builtin: 'victory' },
  2: { ids: ['SHUFFLE_DANCE', 'VIBE_DANCE', 'FLOSS', 'HYPERPOP_DANCE'], builtin: 'dance' },
  3: { ids: ['WAVE_R', 'CLAP', 'BOW'], builtin: 'wave' },
}
/** Покой и эмоция по очереди, у каждого места своё смещение — не хором. */
const IDLE_MS = 3600
const SHOW_MS = 3800
const FIRST_MS: Record<1 | 2 | 3, number> = { 1: 900, 2: 2400, 3: 3900 }

/** Пиксельная грань блока 16×16 в духе Minecraft: свет сверху, тень снизу, крапинки. */
function blockTexture([hi, mid, lo]: string[], seed: number): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')!
  let s = seed
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 ? hi : x === 15 || y === 15 ? lo : rnd() < 0.18 ? (rnd() < 0.5 ? hi : lo) : mid
      g.fillStyle = edge!
      g.fillRect(x, y, 1, 1)
    }
  const t = new CanvasTexture(c)
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.colorSpace = SRGBColorSpace
  return t
}

/** Пиксельный язычок пламени 8×12 — акцент блоков на доске «Огоньки». */
function flameTexture(): CanvasTexture {
  const rows = [
    '...r....',
    '...rr...',
    '..rrr...',
    '..rorr..',
    '.rroor..',
    '.rooorr.',
    'rrooyorr',
    'rooyyorr',
    'rooyyyor',
    'roYyyyor',
    '.rooyor.',
    '..rrrr..',
  ]
  const color: Record<string, string> = { r: '#d8361c', o: '#ff8a1f', y: '#ffd23f', Y: '#fff2a8' }
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 12
  const g = c.getContext('2d')!
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      g.fillStyle = color[ch]!
      g.fillRect(x, y, 1, 1)
    }),
  )
  const t = new CanvasTexture(c)
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.colorSpace = SRGBColorSpace
  return t
}

type Movable = { position?: { x: number; z: number }; skin?: { head?: Object3D } }

/** Эмоция не уводит фигуру с блока: корень по горизонтали прибит к месту. */
function pinned(anim: SkinAnimation): SkinAnimation {
  const step = anim.update.bind(anim)
  anim.update = (player: unknown, dt: number) => {
    step(player, dt)
    const root = player as Movable
    if (root.position) {
      root.position.x = 0
      root.position.z = 0
    }
  }
  return anim
}

/**
 * Покой с живой головой для фигур без мыши: дыхание и перенос веса — из
 * встроенного покоя, взгляд то по сторонам, то в камеру.
 */
function lookingIdle(base: SkinAnimation, seed: number): SkinAnimation {
  let t = seed
  let yaw = 0
  let pitch = 0
  let want = 0
  let wantPitch = 0
  let next = 0
  const step = base.update.bind(base)
  base.update = (player: unknown, dt: number) => {
    step(player, dt)
    t += dt
    if (t >= next) {
      const camera = Math.random() < 0.45
      want = camera ? 0 : (Math.random() - 0.5) * 1.1
      wantPitch = camera ? -0.05 : (Math.random() - 0.5) * 0.25
      next = t + 1.4 + Math.random() * 2.2
    }
    const k = 1 - Math.exp(-4 * Math.min(dt, 0.1))
    yaw += (want - yaw) * k
    pitch += (wantPitch - pitch) * k
    const head = (player as Movable).skin?.head as (Object3D & { rotation: { x: number; y: number } }) | undefined
    if (head) {
      head.rotation.y += yaw
      head.rotation.x += pitch
    }
  }
  return base
}

let catalogEmotes: Promise<CosmeticItem[]> | null = null
const emoteItems = () =>
  (catalogEmotes ??= loadCosmeticCatalog()
    .then((c) => (c.items || []).filter((it) => it.model))
    .catch(() => []))

async function emoteFor(rank: 1 | 2 | 3, m3d: Awaited<ReturnType<typeof loadMine3d>>): Promise<SkinAnimation> {
  const items = await emoteItems()
  for (const id of EMOTES[rank].ids) {
    const item = items.find((it) => it.id === id)
    if (!item?.model) continue
    const file = await cosmeticModel(item.model)
    if (!file?.animations) continue
    const clips = readAnimations(file.animations)
    const sequence = emoteSequence(clips, emoteClip(clips, item.animation))
    if (sequence) return pinned(new CosmeticEmote(sequence, file.geometry) as unknown as SkinAnimation)
  }
  return pinned(m3d.createSkinAnimation(EMOTES[rank].builtin))
}

/**
 * Пьедестал тройки — та же сцена, что персонаж в лобби (владелец 06.10.2026:
 * «как в лобби»): движок mine3d со светом лобби, тенью, тонкомпенсацией и
 * вторым слоем скина, один WebGL-контекст на троих. Первый — на золотом
 * блоке, второй — на железном, третий — на медном; покой с дыханием и
 * взглядом, по очереди эмоции из библиотеки каталога. Сцена чуть
 * поворачивается за мышью. Нет WebGL или слабая графика — `onFail`.
 */
export function PodiumScene({ board, items, onOpen, onFail }: { board: Board; items: BoardEntry[]; onOpen: (e: BoardEntry) => void; onFail: () => void }) {
  const fire = board === 'streak'
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tagRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [ready, setReady] = useState(false)
  const key = board + ':' + items.map((e) => e.nick).join('|')

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !items.length) return
    if (gpuLite()) {
      onFail()
      return
    }
    let alive = true
    let engine: SkinViewEngine | null = null
    let raf = 0
    const timers: number[] = []
    const cleanups: (() => void)[] = []
    setReady(false)

    const onLost = (e: Event) => {
      e.preventDefault()
      noteContextLost()
      onFail()
    }
    canvas.addEventListener('webglcontextlost', onLost)

    void (async () => {
      const m3d = await loadMine3d().catch(() => null)
      if (!alive) return
      if (!m3d) return onFail()
      try {
        engine = new m3d.SkinViewEngine(canvas, { autoResize: false, autoDetectModel: false, transparent: true, enableControls: false })
      } catch {
        return onFail()
      }
      noteContextCreated()
      const e = engine
      e.applyLightSettings(MILLIDA_LIGHT)
      e.setContactShadowVisible(true)
      e.setCursorFollow(false)
      e.setPresentationMode('full')
      e.setPoseHook(headLook())

      const top3 = items.slice(0, 3)
      for (const rank of [1, 2, 3] as const) {
        if (!top3[rank - 1]) continue
        const s = SPOTS[rank]
        const side = blockTexture(s.tone, rank * 17)
        const topTex = blockTexture([s.tone[0], s.tone[0], s.tone[1]], rank * 31)
        side.repeat.set(1, s.h / BLOCK_W)
        const sideMat = new MeshStandardMaterial({ map: side, roughness: 0.95, metalness: 0 })
        const topMat = new MeshStandardMaterial({ map: topTex, roughness: 0.95, metalness: 0 })
        const block = new Mesh(new BoxGeometry(BLOCK_W, s.h, BLOCK_W), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
        block.position.set(s.x, s.h / 2 - FEET, 0)
        e.addStageProp(block)
        if (fire) {
          const flame = flameTexture()
          for (const dx of [-BLOCK_W / 2 + 1.5, BLOCK_W / 2 - 1.5]) {
            const sprite = new Sprite(new SpriteMaterial({ map: flame }))
            sprite.scale.set(3, 4.5, 1)
            sprite.position.set(s.x + dx, s.h - FEET + 2.2, BLOCK_W / 2 - 1)
            e.addStageProp(sprite)
          }
        }
      }

      const slims = await Promise.all(top3.map((it) => detectSlimFromUrl(nickSkinUrl(it.nick)).catch(() => false)))
      if (!alive) return
      e.setModelType(slims[0] ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
      await e.setSkin(nickSkinUrl(top3[0]!.nick)).catch(() => e.setSkin(nickSkinUrl('Steve')))
      e.setMainSpot({ x: SPOTS[1].x, y: SPOTS[1].h, z: 0, yaw: 0 })
      const idles: Record<1 | 2 | 3, SkinAnimation> = {
        1: m3d.createSkinAnimation('idle'),
        2: lookingIdle(m3d.createSkinAnimation('idle'), 0.7),
        3: lookingIdle(m3d.createSkinAnimation('idle'), 1.9),
      }
      e.setAnimation(idles[1])
      await e.setExtras(
        top3.slice(1).map((it, i) => {
          const rank = (i + 2) as 2 | 3
          return {
            skin: nickSkinUrl(it.nick),
            slim: slims[i + 1] ?? false,
            animation: idles[rank],
            at: { x: SPOTS[rank].x, y: SPOTS[rank].h, z: 0, yaw: SPOTS[rank].yaw },
          }
        }),
      )
      if (!alive) return

      e.setStageYaw(FACE_CAMERA)
      const fit = () => {
        const w = wrap.clientWidth
        const h = wrap.clientHeight
        if (!w || !h) return
        e.setSize(w, h)
        e.fitPlayerToFrame({ fillY: 0.78, maxFillX: 0.92, offsetY: -0.12 })
      }
      fit()
      const ro = new ResizeObserver(fit)
      ro.observe(wrap)
      cleanups.push(() => ro.disconnect())

      // Эмоции по кругу: покой → своя эмоция → покой, места со сдвигом.
      const emotes: Partial<Record<1 | 2 | 3, SkinAnimation>> = {}
      const setAnim = (rank: 1 | 2 | 3, anim: SkinAnimation) => (rank === 1 ? e.setAnimation(anim) : e.setExtraAnimation(rank - 2, anim))
      const cycle = (rank: 1 | 2 | 3) => {
        const show = async () => {
          if (!alive) return
          const anim = (emotes[rank] ??= await emoteFor(rank, m3d))
          if (!alive) return
          anim.progress = 0
          setAnim(rank, anim)
          timers.push(window.setTimeout(rest, SHOW_MS))
        }
        const rest = () => {
          if (!alive) return
          setAnim(rank, idles[rank])
          timers.push(window.setTimeout(() => void show(), IDLE_MS))
        }
        timers.push(window.setTimeout(() => void show(), FIRST_MS[rank]))
      }
      for (const rank of [1, 2, 3] as const) if (top3[rank - 1]) cycle(rank)

      // Параллакс: вся сцена чуть поворачивается за мышью.
      let aim = 0
      let yaw = 0
      const onMove = (ev: MouseEvent) => {
        const r = wrap.getBoundingClientRect()
        aim = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width) * 2 - 1)) * 0.12
      }
      window.addEventListener('mousemove', onMove)
      cleanups.push(() => window.removeEventListener('mousemove', onMove))

      const p = new Vector3()
      const loop = () => {
        raf = 0
        if (!alive) return
        yaw += (aim - yaw) * 0.06
        e.setStageYaw(FACE_CAMERA + yaw)
        const w = wrap.clientWidth
        const h = wrap.clientHeight
        top3.forEach((_, i) => {
          const tag = tagRefs.current[i]
          const head = e.figureHead(i)
          if (!tag || !head) return
          head.getWorldPosition(p)
          p.y += 9
          p.project(e.stageCamera)
          tag.style.transform =
            'translate(' + Math.round(((p.x + 1) / 2) * w) + 'px,' + Math.round(((1 - p.y) / 2) * h) + 'px) translate(-50%,-100%)'
        })
        if (renderLive() && !document.hidden) raf = requestAnimationFrame(loop)
      }
      const run = () => {
        if (!alive) return
        if (renderLive() && !document.hidden) {
          e.start()
          if (!raf) raf = requestAnimationFrame(loop)
        } else e.stop()
      }
      run()
      cleanups.push(onRenderGate(run))
      document.addEventListener('visibilitychange', run)
      cleanups.push(() => document.removeEventListener('visibilitychange', run))
      setReady(true)
    })()

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      timers.forEach((t) => window.clearTimeout(t))
      cleanups.forEach((f) => f())
      canvas.removeEventListener('webglcontextlost', onLost)
      if (engine) releaseEngine(engine)
    }
  }, [key])

  return (
    <div className={'tb-scene' + (ready ? ' ready' : '')} ref={wrapRef}>
      {/* Новый холст на каждую доску: у старого после release контекст потерян, и сцена падала в плоские фигуры (07.10.2026). */}
      <canvas key={key} ref={canvasRef} className="tb-scene-canvas" />
      {items.slice(0, 3).map((e, i) => (
        <button
          key={e.rank}
          ref={(el) => {
            tagRefs.current[i] = el
          }}
          className={'tb-tag p' + e.rank + (e.isFriend ? ' friend' : '')}
          data-track="top_podium"
          onClick={() => onOpen(e)}
        >
          <span className="tb-tag-place">{e.rank}</span>
          <b>{e.nick}</b>
          <span className="tb-tag-val">
            {board === 'streak' ? <Icon id="i-flame" /> : <Icon id="i-clock" />}
            {boardValueText(board, e.value)}
          </span>
        </button>
      ))}
    </div>
  )
}
