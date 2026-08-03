import { fetchTexture } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

// Our CDN answers without Access-Control-Allow-Origin, so a webview request with
// crossOrigin="anonymous" fails: no 3D preview, no thumbnail, and "Применить"
// died on reading the pixels. The core has no CORS, so remote textures are
// fetched there once and reused as data: URLs.
const resolved = new Map<string, Promise<string>>()

const isRemote = (url: string) => /^https?:/i.test(url)

export function textureSource(url: string): Promise<string> {
  if (!url || !isRemote(url) || !hasTauri()) return Promise.resolve(url)
  const hit = resolved.get(url)
  if (hit) return hit
  const task = fetchTexture(url).catch(() => url)
  resolved.set(url, task)
  return task
}

export function forgetTextureSource(url: string) {
  resolved.delete(url)
}
