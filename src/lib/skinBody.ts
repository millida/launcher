import { loadMine3d } from './mine3d'
import { textureSource } from './textureSource'

export const BODY_W = 300
export const BODY_H = 480

export type BodyModel = 'default' | 'slim' | 'auto-detect'

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
let engine: any = null
/** Когда движок не создался. Не навсегда: в WKWebView контекст WebGL не
 *  выдаётся, пока браузер не отберёт чужой, и через пару секунд он есть. Раньше
 *  одна неудача переводила все фигурки до перезапуска в плоский 2D-вид —
 *  «мой скин стоит как партизан» (владелец 24.09.2026). */
let engineFailedAt = 0
const ENGINE_RETRY_MS = 4000
let queue: Promise<unknown> = Promise.resolve()

/** Контекст WebGL отобрали: рисовать им больше нельзя, нужен новый движок. */
function contextLost(e: any): boolean {
  try {
    const gl = e?.renderer?.getContext?.()
    return !!gl && typeof gl.isContextLost === 'function' && gl.isContextLost()
  } catch {
    return false
  }
}

async function ensureEngine(): Promise<any> {
  if (engine && contextLost(engine)) {
    try {
      engine.dispose()
    } catch {}
    engine = null
  }
  if (engine) return engine
  if (engineFailedAt && Date.now() - engineFailedAt < ENGINE_RETRY_MS) throw new Error('3D-превью недоступно')
  try {
    const m3d = await loadMine3d()
    const canvas = document.createElement('canvas')
    engine = new m3d.SkinViewEngine(canvas, {
      idleAnimation: new m3d.CoolPoseAnimation(),
      enableControls: false,
      enableEffects: false,
      autoResize: false,
      transparent: true,
      preserveDrawingBuffer: true,
    })
    engine.setSize(BODY_W, BODY_H)
    engine.setContactShadowVisible(true)
  } catch (e) {
    engine = null
    engineFailedAt = Date.now()
    throw e
  }
  engineFailedAt = 0
  return engine
}

export const AVATAR_SIZE = 512

const AVATAR_LOOK_Y = 12.2
const AVATAR_DISTANCE = 40
const AVATAR_YAW = -0.4

export function renderAvatar(url: string, model: BodyModel): Promise<string> {
  const task = queue.then(async () => {
    const e = await ensureEngine()
    const m3d = await loadMine3d()
    const img = await loadTexture(url)
    await e.setSkin(img)
    if (model !== 'auto-detect') {
      e.setModelType(model === 'slim' ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
    }
    e.clearCape()
    try {
      e.setSize(AVATAR_SIZE, AVATAR_SIZE)
      e.setContactShadowVisible(false)
      e.setAnimation(null)
      e.setBodyPartsVisible(false)
      e.setPlayerYaw(AVATAR_YAW)
      e.setLookTargetY(AVATAR_LOOK_Y)
      e.setCameraDistance(AVATAR_DISTANCE)
      e.renderFrame()
      return e.canvas.toDataURL('image/png')
    } finally {
      e.clearShotPreset()
      e.setPlayerYaw(0)
      e.setBodyPartsVisible(true)
      e.setPresentationMode('full')
      e.setAnimation(new m3d.CoolPoseAnimation())
      e.clearCape()
      e.setContactShadowVisible(true)
      e.resetCamera()
      e.setSize(BODY_W, BODY_H)
    }
  })
  queue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

const TEXTURE_TIMEOUT = 12000

// A stalled texture request must not hold the shared renderer queue hostage.
function loadTexture(url: string): Promise<HTMLImageElement> {
  return textureSource(url).then(
    (src) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        // data:/blob: — свои байты: crossOrigin им не нужен, а blob: в WKWebView
        // с ним не грузится вовсе.
        if (!/^(data|blob):/i.test(src)) img.crossOrigin = 'anonymous'
        const timer = window.setTimeout(() => {
          img.src = ''
          reject(new Error('текстура не загрузилась: ' + url))
        }, TEXTURE_TIMEOUT)
        img.onload = () => {
          window.clearTimeout(timer)
          resolve(img)
        }
        img.onerror = () => {
          window.clearTimeout(timer)
          reject(new Error('текстура недоступна: ' + url))
        }
        img.src = src
      }),
  )
}

/** Забыть отрисованные фигурки текстуры: она сменилась, а ключ кеша остался прежним. */
export function forgetSkinBody(url: string): void {
  for (const key of Array.from(cache.keys())) if (key.endsWith('|' + url)) cache.delete(key)
}

/**
 * Фигурка в позе CoolPose. yaw — поворот корпуса: карточки образов ставят
 * фигуры под разными углами, иначе ряд одинаковых силуэтов не различить.
 */
export function renderSkinBody(url: string, model: BodyModel = 'auto-detect', yaw = 0): Promise<string> {
  const key = model + '|' + (yaw ? yaw.toFixed(2) + '|' : '') + url
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(key)
  if (running) return running
  const task = loadTexture(url).then((img) => {
    const gpu = queue.then(async () => {
      const e = await ensureEngine()
      const m3d = await loadMine3d()
      await e.setSkin(img)
      if (model !== 'auto-detect') {
        e.setModelType(model === 'slim' ? m3d.SkinModelType.Slim : m3d.SkinModelType.Classic)
      }
      e.clearCape()
      e.setPlayerYaw(yaw)
      e.fitPlayerToFrame({ fillY: 0.86, offsetY: 0 })
      e.renderFrame()
      e.setPlayerYaw(0)
      // Контекст отобрали посреди кадра — картинка пустая, в кеш её не кладём.
      if (contextLost(e)) throw new Error('3D-превью потеряло контекст')
      const data = e.canvas.toDataURL('image/png')
      cache.set(key, data)
      return data
    })
    queue = gpu.then(
      () => undefined,
      () => undefined,
    )
    return gpu
  })
  inflight.set(key, task)
  void task.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  )
  return task
}
