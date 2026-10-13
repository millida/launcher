import { pickWallpaper } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import type { CustomWp } from '../state/wallpaper'

const PREVIEW_SIDE = 1920

async function shrunk(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const g = canvas.getContext('2d')
  if (!g) throw new Error('canvas недоступен')
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}

// The browser preview has no core to copy the file: the picture is kept as a
// data URL, small enough for web storage. The app never takes this path.
function pickInBrowser(): Promise<CustomWp | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.oncancel = () => resolve(null)
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      shrunk(file).then((path) => resolve({ kind: 'image', path, name: file.name.replace(/\.[^.]+$/, '') }), reject)
    }
    input.click()
  })
}

export const canPickBackdrop = () => hasTauri() || import.meta.env.DEV

export function pickBackdrop(): Promise<CustomWp | null> {
  return hasTauri() ? pickWallpaper() : pickInBrowser()
}
