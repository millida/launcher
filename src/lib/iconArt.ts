import { coverGradient, shade } from './blockColor'
import { BLOCK_ICONS } from './icons'

/// Composed icons are stored as the same 128px PNG data URL a picked cover is,
/// so every place that already renders `profile.icon` keeps working unchanged.
const PX = 128
const SYMBOL_INSET = 0.15
const RECIPE_STORE = 'm-icon-art'
const RECIPE_LIMIT = 300

export const ICON_BACKGROUNDS: string[] = [
  '#e2445c',
  '#f2681f',
  '#f5a623',
  '#f7d02c',
  '#9ccc3c',
  '#3fb950',
  '#12a594',
  '#2ba6cb',
  '#3b6ef6',
  '#6c5ce7',
  '#9b59f6',
  '#d94fd0',
  '#f06292',
  '#8d6e4a',
  '#5a6470',
  '#2b3138',
]

export const ICON_SYMBOLS: string[] = BLOCK_ICONS

export interface IconRecipe {
  bg: string
  symbol: string
}

export function swatchBackground(bg: string): string {
  return coverGradient(bg)
}

export function randomIconRecipe(avoid?: IconRecipe | null): IconRecipe {
  const pick = <T,>(list: T[], not?: T): T => {
    const pool = list.length > 1 && not !== undefined ? list.filter((v) => v !== not) : list
    return pool[Math.floor(Math.random() * pool.length)]
  }
  return {
    bg: pick(ICON_BACKGROUNDS, avoid?.bg),
    symbol: pick(ICON_SYMBOLS, avoid?.symbol),
  }
}

export function defaultIconRecipe(): IconRecipe {
  return { bg: ICON_BACKGROUNDS[9], symbol: ICON_SYMBOLS[0] }
}

export function isComposedIcon(url?: string | null): boolean {
  return !!url && url.startsWith('data:')
}

const imgCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(src: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(src)
  if (hit) return hit
  const task = new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('символ не загрузился: ' + src))
    img.src = src
  })
  // a failed load must not be remembered as the answer for every later attempt
  task.catch(() => imgCache.delete(src))
  imgCache.set(src, task)
  return task
}

function paintBackground(g: CanvasRenderingContext2D, bg: string) {
  const grad = g.createRadialGradient(PX * 0.5, PX * 0.3, 0, PX * 0.5, PX * 0.3, PX * 1.05)
  grad.addColorStop(0, shade(bg, 0.18))
  grad.addColorStop(0.48, bg)
  grad.addColorStop(1, shade(bg, -0.28))
  g.fillStyle = grad
  g.fillRect(0, 0, PX, PX)
}

export async function composeIcon(recipe: IconRecipe): Promise<string> {
  const img = await loadImage(recipe.symbol)
  const c = document.createElement('canvas')
  c.width = PX
  c.height = PX
  const g = c.getContext('2d')
  if (!g) throw new Error('графика недоступна — обнови драйвер или перезапусти лаунчер')
  paintBackground(g, recipe.bg)
  const box = PX * (1 - SYMBOL_INSET * 2)
  const w = img.naturalWidth || box
  const h = img.naturalHeight || box
  const k = Math.min(box / w, box / h)
  const dw = w * k
  const dh = h * k
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, (PX - dw) / 2, (PX - dh) / 2, dw, dh)
  return c.toDataURL('image/png')
}

type RecipeMap = Record<string, IconRecipe>

function readStore(): RecipeMap {
  try {
    const raw = JSON.parse(localStorage.getItem(RECIPE_STORE) || 'null')
    if (!raw || typeof raw !== 'object') return {}
    const out: RecipeMap = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const r = v as Partial<IconRecipe> | null
      if (r && typeof r.bg === 'string' && typeof r.symbol === 'string') out[k] = { bg: r.bg, symbol: r.symbol }
    }
    return out
  } catch {
    return {}
  }
}

/// The recipe only pre-selects the editor next time it opens: the icon itself is
/// already on the profile, so losing this map costs nothing but a preselection.
export function recallIconRecipe(profile: string): IconRecipe | null {
  return readStore()[profile] || null
}

export function rememberIconRecipe(profile: string, recipe: IconRecipe) {
  try {
    const all = readStore()
    delete all[profile]
    const keys = Object.keys(all)
    if (keys.length >= RECIPE_LIMIT) for (const k of keys.slice(0, keys.length - RECIPE_LIMIT + 1)) delete all[k]
    all[profile] = recipe
    localStorage.setItem(RECIPE_STORE, JSON.stringify(all))
  } catch {}
}

export function forgetIconRecipe(profile: string) {
  try {
    const all = readStore()
    if (!(profile in all)) return
    delete all[profile]
    localStorage.setItem(RECIPE_STORE, JSON.stringify(all))
  } catch {}
}
