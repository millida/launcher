import { loadMine3d } from './mine3d'
import type { SkinViewEngine } from '../vendor/mine3d'
import { SHOP_LIGHT, cosmeticModel, releaseEngine } from './characterStage'
import { ATLAS_FPS, buildCosmetic, cosmeticClock, pickClip } from './cosmeticModel'
import { readAnimations } from './cosmeticAnimation'
import { CosmeticEmote, emoteClip } from './cosmeticEmote'
import { emoteSequence, type EmoteSequence } from './emoteSequence'
import { maskUrls, pieceCover } from './cosmeticCover'
import { maskedSkin } from './maskedSkin'
import { textureSource } from './textureSource'
import { loadCosmeticCatalog, type CosmeticItem } from './gameProfile'
import { gpuLite } from './gpuLite'
import { pickJob, shotRank } from './shotQueue'
import { textured } from './shotTextures'
import { withSnapshotGl, type GlHolder } from './glPool'
import { screenSettled } from './screenSettle'

/**
 * Снимки «ты в наборе» для карточек магазина (ТЗ v3, 06.10.2026). Живая 3D-сцена
 * на каждую карточку не поместится (контекстов WebGL у вебвью мало), а плоская
 * фигурка с приклеенными превью давала цветные пятна на руках. Поэтому один
 * невидимый движок по очереди надевает на скин игрока каждый набор и снимает
 * кадр в PNG; снимки живут в памяти до конца сеанса.
 *
 * `dressed` — сколько вещей реально встало на фигуру: 0 значит, что 3D не
 * получилось (модели не пришли) — карточка показывает плоское превью вещи,
 * а не голого персонажа.
 */
export interface OutfitShot {
  url: string
  dressed: number
  /**
   * Петля (06.10.2026, владелец: «анимации должны играть на карточках»):
   * у эмоций и движущихся вещей `url` — лента из `frames` кадров слева
   * направо, проигрывается за `seconds` по кругу (LoopShot). Нет — один кадр.
   */
  frames?: number
  seconds?: number
}

/**
 * Размер кадра — ровно как показ в карточке (3:4, CSS-пиксели): движок сам
 * рендерит с запасом плотности экрана, и картинка не пережимается браузером.
 */
export const SHOT_W = 240
export const SHOT_H = 320
/** Тот же поворот три четверти, что у живой сцены. */
export const SHOP_YAW = 0.26
/** Кадр снимка: ноги на 82% высоты (там подиум задника). */
export const SHOT_FRAME = { fillY: 0.5, offsetY: 1 - 2 * 0.82 + 0.5 }

/**
 * Кадр по месту вещи (витрина дня): вещь занимает около половины плитки.
 * fillY — доля высоты кадра под всё тело (больше 1 — крупный план части),
 * offsetY — где центр тела (в полукадрах); голова на 0.75·fillY выше центра,
 * грудь на 0.375·fillY, ноги на 0.625·fillY ниже.
 */
export type ShotFocus = 'full' | 'body' | 'head' | 'upper' | 'legs' | 'back'
const FOCUS: Record<ShotFocus, { fillY: number; offsetY: number; yaw: number }> = {
  full: { ...SHOT_FRAME, yaw: SHOP_YAW },
  body: { fillY: 0.7, offsetY: 1 - 2 * 0.86 + 0.7, yaw: SHOP_YAW },
  head: { fillY: 1.15, offsetY: -0.24 - 0.75 * 1.15, yaw: SHOP_YAW },
  upper: { fillY: 1.0, offsetY: -0.05 - 0.375 * 1.0, yaw: SHOP_YAW },
  legs: { fillY: 1.0, offsetY: 0.12 + 0.625 * 1.0, yaw: SHOP_YAW },
  back: { fillY: 0.72, offsetY: -0.02 - 0.3 * 0.72, yaw: Math.PI - 0.62 },
}
const SLOT_FOCUS: Record<string, ShotFocus> = {
  HAT: 'head', HEAD: 'head', FACE: 'head', EARS: 'head',
  BACK: 'back', WINGS: 'back', CAPE: 'back',
  SHOES: 'legs', FEET: 'legs', PANTS: 'legs', SKIRT: 'legs',
  PET: 'full',
  ARMS: 'upper', HAND: 'upper', SHOULDERS: 'upper', SHOULDER: 'upper', ACCESSORY: 'upper',
}
export const focusOf = (slot: string): ShotFocus => SLOT_FOCUS[slot] ?? 'body'

/**
 * Снимки на диске: IndexedDB, ключ — скин, состав, кадр и пропорции. SHOT_VER
 * растёт, когда меняется кадр, — старые снимки тогда не берутся.
 */
// v5: петли кадров и без тени-пятна под ногами (06.10.2026).
const SHOT_VER = 'v7'
const DB = 'm-outfit-shots'
let dbAsk: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  if (dbAsk) return dbAsk
  dbAsk = new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore('shots')
      r.onsuccess = () => ok(r.result)
      r.onerror = () => ok(null)
    } catch {
      ok(null)
    }
  })
  return dbAsk
}
type StoredShot = { blob: Blob; dressed: number; frames?: number; seconds?: number }
type Shot = StoredShot & { partial: boolean }
function idbGet(key: string): Promise<string | StoredShot | null> {
  return db().then(
    (d) =>
      new Promise((ok) => {
        if (!d) return ok(null)
        try {
          const q = d.transaction('shots').objectStore('shots').get(SHOT_VER + '|' + key)
          q.onsuccess = () => {
            const v = q.result as unknown
            if (typeof v === 'string') return ok(v)
            const rec = v as StoredShot | undefined
            ok(rec && rec.blob instanceof Blob ? rec : null)
          }
          q.onerror = () => ok(null)
        } catch {
          ok(null)
        }
      }),
  )
}
function idbSet(key: string, value: StoredShot): Promise<void> {
  return db().then((d) => {
    try {
      d?.transaction('shots', 'readwrite').objectStore('shots').put(value, SHOT_VER + '|' + key)
    } catch {}
  })
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((ok) => {
    try {
      canvas.toBlob((b) => ok(b), type, quality)
    } catch {
      ok(null)
    }
  })
}

/** Ключ кэша: скин, тип рук и состав набора (порядок вещей не важен). */
export const shotKey = (skin: string, slim: boolean, codes: readonly string[]) =>
  skin + '|' + (slim ? 's' : 'c') + '|' + [...codes].sort().join(',')

const cache = new Map<string, Promise<OutfitShot | null>>()

/**
 * Очередь снимков с приоритетом видимого (06.10.2026: «наборы долго
 * коллажем»): движок один, снимки по одному, но следующей берётся плитка,
 * которая сейчас на экране, а не та, что раньше попросила (лента «Скидок дня»
 * за краем окна стояла впереди наборов). Между снимками — пауза в кадр, чтобы
 * прокрутка не подвисала.
 */
type Job = { at: number; el?: Element | null; run: () => Promise<unknown> }
const jobs: Job[] = []
let busy = false
let asked = 0

function pump() {
  if (busy || !jobs.length) return
  busy = true
  void screenSettled()
    .then(() => {
      const i = pickJob(jobs.map((j) => ({ at: j.at, rank: shotRank(j.el) })))
      return jobs.splice(i, 1)[0]!.run()
    })
    .catch(() => null)
    .then(() => {
      busy = false
      // Кадр отдыха между снимками: сборка модели держит поток.
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(pump, 0))
      else setTimeout(pump, 0)
    })
}

function enqueue<T>(el: Element | null | undefined, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((ok, fail) => {
    jobs.push({ at: asked++, el, run: () => run().then(ok, fail) })
    pump()
  })
}
let engine: SkinViewEngine | null = null
let idle = 0
/** Без новых снимков минуту — движок отдаёт контекст WebGL. Короче нельзя:
 *  новый контекст заново компилирует шейдеры, и возврат в магазин подвисал. */
const IDLE_MS = 60_000
/** Сколько ждать картинки вещей перед кадром: пришедшие грузятся за 0,1–0,3 с,
 *  а битая не придёт и за 4 — дольше ждать значит держать очередь наборов. */
const TEXTURE_WAIT_MS = 1500

/**
 * Пропорции кадра (ширина/высота) — те же, что у плитки: иначе браузер
 * растягивал снимок 3:4 в квадрат, и персонаж с крыльями выходил сплюснутым.
 * Округляем до 0,05, чтобы соседние плитки делили кэш.
 */
export const shotAspect = (w: number, h: number) => (w > 0 && h > 0 ? Math.max(0.4, Math.min(2.5, Math.round((w / h) * 20) / 20)) : SHOT_W / SHOT_H)

export function outfitShot(
  skin: string,
  slim: boolean,
  codes: readonly string[],
  focus: ShotFocus = 'full',
  aspect = SHOT_W / SHOT_H,
  /** Плитка снимка: видимые снимаются первыми. */
  el?: Element | null,
): Promise<OutfitShot | null> {
  const key = shotKey(skin, slim, codes) + '|' + focus + '|' + aspect
  const ready = cache.get(key)
  if (ready) return ready
  // Сначала снимок с диска (IndexedDB): наборы появляются сразу, без 3D.
  const render = (): Promise<OutfitShot | null> => {
    // Сеть — сразу, пока снимок ждёт очереди: модели и картинки вещей, скин.
    // Тогда сам снимок — только работа видеокарты (~0,3 с вместо 1,5).
    void prefetch(skin, codes)
    return enqueue(el, () => withSnapshotGl(holder, () => shoot(skin, slim, codes, focus, aspect))).then((r) => {
      if (!r) return null
      const { partial, ...stored } = r
      // Missing pictures may arrive next time: keep the shot neither on disk nor in memory.
      if (partial) cache.delete(key)
      else if (stored.dressed > 0) void idbSet(key, stored)
      return fromStored(stored)
    })
  }
  const run: Promise<OutfitShot | null> = idbGet(key)
    .then((saved): Promise<OutfitShot | null> | OutfitShot => (typeof saved === 'string' ? fromDisk(saved) : saved ? fromStored(saved) : render()))
    .catch((e) => {
      console.warn('[shop] снимок набора', e)
      return null
    })
  // Сорванный снимок не держим: следующий заход попробует снова.
  const kept = run.then((r) => {
    if (!r) cache.delete(key)
    return r
  })
  cache.set(key, kept)
  return kept
}

function fromStored(s: StoredShot): OutfitShot {
  const shot: OutfitShot = { url: URL.createObjectURL(s.blob), dressed: s.dressed }
  if (s.frames && s.frames > 1) {
    shot.frames = s.frames
    shot.seconds = s.seconds
  }
  return shot
}

/** Запись с диска: строка картинки (один кадр) или JSON петли. */
function fromDisk(saved: string): OutfitShot {
  if (saved.startsWith('{')) {
    try {
      const r = JSON.parse(saved) as OutfitShot
      if (r && typeof r.url === 'string') return { ...r, dressed: Math.max(1, r.dressed || 1) }
    } catch {}
  }
  return { url: saved, dressed: 1 }
}

/**
 * Прогрев: 3D-модуль и каталог вещей грузятся, как только открыт магазин, а
 * не когда первая плитка набора доехала до экрана (первый снимок ждал их ~3 с).
 * Контекст WebGL не берёт.
 */
let warmed = false
export function warmOutfitShots(): void {
  if (gpuLite()) return
  void loadMine3d().catch(() => undefined)
  void catalogItems()
  if (warmed) return
  warmed = true
  // Первый кадр движка компилирует шейдеры (~1–2 с): делаем его заранее,
  // последним в очереди — видимые снимки его обгоняют.
  void enqueue(null, () =>
    withSnapshotGl(holder, async () => {
      const e = await getEngine()
      try {
        await e?.compileAsync()
        e?.renderFrame()
      } finally {
        sleepLater()
      }
    }),
  ).catch(() => {
    warmed = false
  })
}

let catalogAsked: Promise<CosmeticItem[]> | null = null

function prefetch(skin: string, codes: readonly string[]) {
  void textureSource(skin).catch(() => undefined)
  void catalogItems().then((catalog) => {
    for (const code of codes) {
      const hit = resolve(catalog, code)
      const item = hit?.item
      if (!item?.model) continue
      void cosmeticModel(item.model)
      const tex = hit?.variant?.texture ?? item.texture
      if (typeof tex === 'string') {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = tex
      }
    }
  })
}
function catalogItems(): Promise<CosmeticItem[]> {
  if (!catalogAsked)
    catalogAsked = loadCosmeticCatalog()
      .then((c) => c.items || [])
      .catch(() => {
        catalogAsked = null
        return []
      })
  return catalogAsked
}

async function getEngine(): Promise<SkinViewEngine | null> {
  window.clearTimeout(idle)
  if (engine && !engine.disposed) {
    // Контекст отобрали (предел браузера) — движок мёртв, нужен новый.
    const gl = (engine as unknown as { renderer?: { getContext?: () => WebGLRenderingContext } }).renderer?.getContext?.()
    if (!gl?.isContextLost?.()) return engine
    releaseEngine(engine)
    engine = null
  }
  if (gpuLite()) return null
  const m3d = await loadMine3d()
  const canvas = document.createElement('canvas')
  canvas.width = SHOT_W
  canvas.height = SHOT_H
  const e = new m3d.SkinViewEngine(canvas, {
    autoResize: false,
    autoDetectModel: false,
    transparent: true,
    enableControls: false,
    enableEffects: false,
    preserveDrawingBuffer: true,
  })
  e.applyLightSettings(SHOP_LIGHT)
  // Без пятна-тени под ногами: на карточке оно читалось серой полосой (владелец 06.10.2026).
  e.setContactShadowVisible(false)
  e.setPresentationMode('full')
  e.setSize(SHOT_W, SHOT_H)
  engine = e
  return e
}

/** Общий контекст снимков (glPool): отдать движок, когда снимает другой. */
const holder: GlHolder = {
  release() {
    window.clearTimeout(idle)
    if (engine) releaseEngine(engine)
    engine = null
  },
}

function sleepLater() {
  window.clearTimeout(idle)
  idle = window.setTimeout(() => {
    if (engine) releaseEngine(engine)
    engine = null
  }, IDLE_MS)
}

/**
 * Поза снимка: кадр покоя лобби в миг, когда голова чуть повёрнута к зрителю,
 * а вес на одной ноге, — живее «солдатика» по стойке смирно и ничего не
 * закрывает. Берём встроенную стойку, а не свою: питомцы и вещи с
 * анимацией привязаны к её костям.
 */
const SHOWCASE_T = 7.4

/** Картинки вещей грузятся сами (TextureLoader): кадр снимаем, когда пришли все. */
async function texturesReady(e: SkinViewEngine): Promise<void> {
  const until = performance.now() + TEXTURE_WAIT_MS
  const scene = (e as unknown as { scene?: import('three').Object3D }).scene
  while (scene && performance.now() < until) {
    if (textured(scene)) return
    await new Promise((r) => setTimeout(r, 60))
  }
}

/** Вещь каталога по коду карточки: «КОД~расцветка» — базовая вещь и её расцветка. */
function resolve(catalog: CosmeticItem[], code: string): { item: CosmeticItem; variant?: NonNullable<CosmeticItem['variants']>[number] } | null {
  const [base, tint] = code.split('~')
  const item = catalog.find((c) => c.id === code) ?? catalog.find((c) => c.id === base)
  if (!item) return null
  const list = item.variants ?? []
  const variant = (tint ? list.find((v) => v.code === code || v.name === tint) : undefined) ?? list[0]
  return { item, variant }
}

/** Петля: сколько кадров на сколько секунд. 8 кадров в секунду, 12–20 кадров. */
const LOOP_MIN = 12
const LOOP_MAX = 24
/** Дольше трёх секунд не снимаем: длинный клип (ореол частиц — 10 с) шёл бы двумя кадрами в секунду. */
const LOOP_WINDOW = 3
const loopFrames = (seconds: number) => Math.max(LOOP_MIN, Math.min(LOOP_MAX, Math.round(seconds * 8)))
/** Высота кадра ленты в пикселях: плотнее не нужно, лента и так широкая. */
const LOOP_FRAME_H = 480

type Pinned = { position?: { x: number; z: number } }

async function shoot(skin: string, slim: boolean, codes: readonly string[], focus: ShotFocus, aspect: number): Promise<Shot | null> {
  const [e, catalog] = await Promise.all([getEngine(), catalogItems()])
  if (!e) return null
  try {
    const m3d = await loadMine3d()
    e.setModelType(slim ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
    const found = codes.map((code) => resolve(catalog, code)).filter((r): r is NonNullable<typeof r> => !!r && !!r.item.model)
    const wear = found.filter((r) => r.item.slot !== 'EMOTE')
    const emoteRef = found.find((r) => r.item.slot === 'EMOTE') ?? null
    const items = wear.map((r) => r.item)
    const src = await textureSource(skin)
    const masked = await maskedSkin(src, maskUrls(items, slim), slim).catch(() => src)
    await e.setSkin(masked)
    e.clearCape()
    e.clearCosmetics()
    const all = emoteRef ? [...wear, emoteRef] : wear
    const files = await Promise.all(all.map((r) => cosmeticModel(r.item.model as string)))

    // Эмоция двигает самого игрока: её клип вместо позы покоя, её реквизит (кот,
    // телефон) идёт по тем же часам.
    const emoteFile = emoteRef ? files[all.length - 1] : null
    const clips = emoteFile?.animations ? readAnimations(emoteFile.animations) : {}
    const sequence: EmoteSequence | null = emoteRef && emoteFile ? emoteSequence(clips, emoteClip(clips, emoteRef.item.animation)) : null
    const playing = sequence ? new CosmeticEmote(sequence, emoteFile?.geometry) : null
    if (playing) playing.paused = true

    const worn: import('three').Object3D[][] = []
    let clipSeconds = 0
    all.forEach((r, i) => {
      const file = files[i]
      const texture = r.variant?.texture ?? r.item.texture
      if (!file || !texture) return
      const isEmote = r === emoteRef
      if (!isEmote && file.animations) {
        const clip = pickClip(readAnimations(file.animations), r.item.animation)
        if (clip && clip.length > clipSeconds) clipSeconds = clip.length
      }
      try {
        const pieces = buildCosmetic(
          slim && file.geometrySlim ? file.geometrySlim : file.geometry,
          texture,
          r.item.slot,
          file.animations,
          r.item.animation,
          isEmote && playing && sequence ? { sequence, clock: () => playing.progress } : undefined,
          pieceCover(isEmote ? [...items, r.item] : items, r.item),
          r.variant?.emissive ?? r.item.emissive,
        )
        for (const piece of pieces) e.attachCosmetic(piece.anchor, piece.object)
        if (pieces.length) worn.push(pieces.map((p) => p.object))
      } catch {
        // Кривая модель не роняет снимок: вещь просто не встанет.
      }
    })
    await texturesReady(e)
    // An item whose picture never arrived renders invisible: counting it as worn
    // would cache a bare figure on disk for good.
    let dressed = worn.filter((objects) => objects.every(textured)).length
    if (playing) dressed = Math.max(dressed, 1)
    const partial = dressed < worn.length
    // Высота кадра постоянная, ширина — по пропорции плитки.
    e.setSize(Math.round(SHOT_H * aspect), SHOT_H)
    // Эмоция — всё тело крупнее, чем «полный рост» наборов: сидя и в приседе фигура иначе терялась внизу.
    const frame = playing ? FOCUS.body : FOCUS[focus]
    if (playing) {
      const anim = playing as unknown as { update(p: unknown, dt: number): void }
      const step = anim.update.bind(playing)
      // Эмоция не уводит фигуру из кадра: ходьба/прыжок вбок держатся на месте.
      anim.update = (player, dt) => {
        step(player, dt)
        const root = player as Pinned
        if (root.position) {
          root.position.x = 0
          root.position.z = 0
        }
      }
      e.setAnimation(playing as unknown as Parameters<typeof e.setAnimation>[0])
    } else {
      const pose = m3d.createSkinAnimation('idle')
      e.setAnimation(pose)
      pose.progress = SHOWCASE_T
    }
    e.setPlayerYaw(frame.yaw)
    await e.compileAsync()

    // Сколько длится петля: у эмоции — её повторяемая часть, у вещи — клип или
    // лента кадров текстуры.
    const intro = sequence?.intro ? sequence.intro.length : 0
    const atlas = atlasCount(e)
    const full = sequence ? sequence.main.length : clipSeconds > 0 ? clipSeconds : atlas > 1 ? atlas / ATLAS_FPS : 0
    const seconds = Math.min(full, LOOP_WINDOW)
    const moving = seconds > 0.2
    const at = (t: number) => {
      if (playing) playing.progress = intro + t
      cosmeticClock.now = () => t
    }
    try {
      if (!moving) {
        at(0)
        e.fitPlayerToFrame({ fillY: frame.fillY, offsetY: frame.offsetY })
        e.renderFrame()
        // No await inside try: cosmeticClock is global and must be reset before yielding.
        return canvasBlob(e.canvas, 'image/png').then((blob) => (blob ? { blob, dressed, partial } : null))
      }
      const n = loopFrames(seconds)
      // Кадр подгоняется по первому кадру и не меняется: иначе фигура
      // «дышала» бы масштабом от кадра к кадру.
      at(0)
      e.fitPlayerToFrame({ fillY: frame.fillY, offsetY: frame.offsetY })
      const fw0 = e.canvas.width
      const fh0 = e.canvas.height
      const fh = Math.min(fh0, LOOP_FRAME_H)
      const fw = Math.round((fw0 * fh) / fh0)
      const strip = document.createElement('canvas')
      strip.width = fw * n
      strip.height = fh
      const ctx = strip.getContext('2d')
      if (!ctx) return null
      for (let k = 0; k < n; k += 1) {
        // Середина шага: ровно на стыке вступления и петли реквизит иногда стоит в позе вступления.
        at((seconds * (k + 0.5)) / n)
        e.renderFrame()
        ctx.drawImage(e.canvas, 0, 0, fw0, fh0, k * fw, 0, fw, fh)
      }
      // WebP, где умеет (Chromium/WebView2), — лента в разы легче; иначе PNG.
      return canvasBlob(strip, 'image/webp', 0.9).then((blob) => (blob ? { blob, dressed, frames: n, seconds, partial } : null))
    } finally {
      cosmeticClock.now = null
      e.clearCosmetics()
    }
  } finally {
    sleepLater()
  }
}

/** Лента кадров текстуры у надетых вещей (repeat.y = 1/кадров): самая длинная. */
function atlasCount(e: SkinViewEngine): number {
  const scene = (e as unknown as { scene?: import('three').Object3D }).scene
  let most = 1
  scene?.traverse((node) => {
    const mats = (node as { material?: { map?: { repeat?: { y: number } } | null } | { map?: { repeat?: { y: number } } | null }[] }).material
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      const y = m.map?.repeat?.y
      if (y && y > 0 && y < 1) most = Math.max(most, Math.round(1 / y))
    }
  })
  return most
}
