import { cutSkin, type Pixels } from './cosmeticCover'
import { loadImg } from './skinArms'

const MADE_LIMIT = 16
const made = new Map<string, Promise<string>>()

function pixelsOf(image: HTMLImageElement): Pixels | null {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(image, 0, 0)
  const { data } = g.getImageData(0, 0, width, height)
  return { data, width, height }
}

async function cut(skinSrc: string, masks: readonly string[], slim: boolean): Promise<string> {
  const skinImage = await loadImg(skinSrc)
  const skin = pixelsOf(skinImage)
  if (!skin) return skinSrc
  const loaded = await Promise.all(
    masks.map((url) =>
      loadImg(url)
        .then(pixelsOf)
        .catch((e: unknown) => {
          console.warn('[cosmetics] skin mask did not load, the skin under it stays whole', url, e)
          return null
        }),
    ),
  )
  const pictures = loaded.filter((mask): mask is Pixels => mask !== null)
  if (!cutSkin(skin, pictures, slim)) return skinSrc
  const canvas = document.createElement('canvas')
  canvas.width = skin.width
  canvas.height = skin.height
  const g = canvas.getContext('2d')
  if (!g) return skinSrc
  const out = g.createImageData(skin.width, skin.height)
  out.data.set(skin.data)
  g.putImageData(out, 0, 0)
  return canvas.toDataURL('image/png')
}

/** The skin as the game shows it under the outfit: covered pixels and parts cut away. */
export function maskedSkin(skinSrc: string, masks: readonly string[], slim: boolean): Promise<string> {
  if (!masks.length) return Promise.resolve(skinSrc)
  const key = (slim ? 'slim|' : 'wide|') + skinSrc + '\n' + masks.join('\n')
  const hit = made.get(key)
  if (hit) return hit
  const task = cut(skinSrc, masks, slim).catch((e: unknown) => {
    made.delete(key)
    throw e
  })
  if (made.size >= MADE_LIMIT) made.delete(made.keys().next().value as string)
  made.set(key, task)
  return task
}
