import { loadSkinview } from './skinview'
import { textureSource } from './textureSource'

export const BODY_W = 300
export const BODY_H = 480

export type BodyModel = 'default' | 'slim' | 'auto-detect'

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
let viewer: any = null
let viewerFailed = false
let queue: Promise<unknown> = Promise.resolve()

async function ensureViewer(): Promise<any> {
  if (viewer) return viewer
  if (viewerFailed) throw new Error('3D-превью недоступно')
  try {
    const SV = await loadSkinview()
    const canvas = document.createElement('canvas')
    viewer = new SV.SkinViewer({
      canvas,
      width: BODY_W,
      height: BODY_H,
      renderPaused: true,
      preserveDrawingBuffer: true,
    })
    viewer.zoom = 0.82
    viewer.fov = 36
    try {
      viewer.background = null
    } catch {}
    viewer.playerObject.rotation.y = Math.PI / 9
  } catch (e) {
    viewer = null
    viewerFailed = true
    throw e
  }
  return viewer
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
      const v = await ensureViewer()
      await v.loadSkin(img, { model })
      v.render()
      const data = v.canvas.toDataURL('image/png')
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
