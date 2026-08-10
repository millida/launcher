import { loadMine3d } from './mine3d'
import { textureSource } from './textureSource'

export const BODY_W = 300
export const BODY_H = 480

export type BodyModel = 'default' | 'slim' | 'auto-detect'

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
let engine: any = null
let engineFailed = false
let queue: Promise<unknown> = Promise.resolve()

async function ensureEngine(): Promise<any> {
  if (engine) return engine
  if (engineFailed) throw new Error('3D-превью недоступно')
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
    engineFailed = true
    throw e
  }
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
        img.crossOrigin = 'anonymous'
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

export function renderSkinBody(url: string, model: BodyModel = 'auto-detect'): Promise<string> {
  const key = model + '|' + url
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
      e.fitPlayerToFrame({ fillY: 0.86, offsetY: 0 })
      e.renderFrame()
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
