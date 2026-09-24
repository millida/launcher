/**
 * Иконка сборки как в Modrinth: квадрат глубокого цвета и блок на нём (правка
 * владельца 23.09.2026, 19:40 — «вместо фотообоев — иконки»).
 *
 * Хранится в том же поле `icon` профиля, что и раньше (строка, ядро её не
 * разбирает): путь к блоку + цвет подложки во фрагменте —
 * `/build-icons/grass.png#bg=1f3b22`. Фрагмент браузер при загрузке картинки
 * отбрасывает, поэтому старые экраны, которые рисуют `icon` как <img>, видят
 * обычный блок. Своя картинка — data:-URL без фрагмента: она и есть иконка.
 * Старые обложки-обои (`/bg/…`) и пустое поле читаются как иконка по умолчанию.
 */

/** Книжная полка из набора блоков Millida (правка владельца 23.09.2026, 20:00). */
export const DEFAULT_BLOCK = '/block-icons/Block52Millida.png'
/** Свой рендер травы 240 px — в наборе для выбора. */
export const GRASS_BLOCK = '/build-icons/grass.png'

/** Глубокие плотные цвета подложки. Первый — тёмное дерево под книжную полку. */
export const ICON_BGS: string[] = [
  '#2a2017',
  '#1f3b22',
  '#173a36',
  '#16304a',
  '#1f2550',
  '#2e1f4a',
  '#471a3a',
  '#4a1a22',
  '#3d3416',
  '#25282d',
]
export const DEFAULT_BG = ICON_BGS[0]!

export interface BuildIconSpec {
  /** Блок или своя картинка. */
  src: string
  bg: string
  /** block — блок на подложке, photo — своя картинка во весь квадрат. */
  kind: 'block' | 'photo'
  /** Рендер крупнее 96 px: его можно показывать крупнее 64 px. */
  big: boolean
}

const isBlock = (src: string) => src.includes('/block-icons/') || src.includes('/build-icons/')

export function parseIcon(icon?: string | null): BuildIconSpec {
  if (!icon || icon.startsWith('/bg/')) return { src: DEFAULT_BLOCK, bg: DEFAULT_BG, kind: 'block', big: true }
  const hash = icon.indexOf('#bg=')
  const src = hash >= 0 ? icon.slice(0, hash) : icon
  const raw = hash >= 0 ? icon.slice(hash + 4) : ''
  const bg = /^[0-9a-f]{6}$/i.test(raw) ? '#' + raw.toLowerCase() : DEFAULT_BG
  if (isBlock(src)) return { src, bg, kind: 'block', big: src.includes('/build-icons/') }
  return { src, bg, kind: 'photo', big: true }
}

/** Строка для поля `icon`: блок с цветом подложки или своя картинка как есть. */
export function makeIcon(src: string, bg: string): string {
  if (!isBlock(src)) return src
  return src + '#bg=' + bg.replace('#', '').toLowerCase()
}

export const DEFAULT_ICON = makeIcon(DEFAULT_BLOCK, DEFAULT_BG)

/** Своя картинка в браузере (демо без ядра): квадрат 128 px, как делает ядро. */
export function fileToCover(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const n = 128
      const c = document.createElement('canvas')
      c.width = n
      c.height = n
      const g = c.getContext('2d')
      if (!g) return rej(new Error('canvas'))
      const s = Math.min(img.width, img.height)
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, n, n)
      URL.revokeObjectURL(url)
      res(c.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      rej(new Error('Картинка не открылась'))
    }
    img.src = url
  })
}
