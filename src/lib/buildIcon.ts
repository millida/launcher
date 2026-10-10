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

/**
 * Набор иконок Modrinth App (GPL-3.0, как и лаунчер; public/build-icons/mr/NOTICE.md):
 * объёмные блоки и предметы на ярком градиенте (владелец 10.10.2026: «возьми у них
 * картинки, поставь все, пусть появляются рандомно»). Сундуков нет — их просили убрать;
 * знаки Modrinth и ядер не берём.
 */
export const MR_SYMBOLS = [
  'grass-block', 'bookshelf', 'crafting-table', 'furnace', 'redstone-block', 'sticky-piston', 'slime-block', 'cake', 'campfire',
  'pickaxe', 'sword', 'zombie', 'creeper', 'skeleton', 'ender-dragon', 'sculk-sensor', 'beacon', 'enchanting-table', 'lantern', 'tnt',
  'command-block', 'poke-ball', 'orb', 'cooking-pot', 'skillet', 'terminal', 'globe', 'pancakes', 'backpack', 'couch', 'tiny-potato',
  'blue-shark', 'brown-bear', 'moobloom', 'wrench', 'cogwheel', 'engine', 'tire', 'oxygen-distributor', 'space-helmet', 'gizmo',
] as const
export const mrSymbol = (id: string) => '/build-icons/mr/' + id + '.png'

/** Градиенты подложки — те же, что у Modrinth App (сверху вниз). */
export const MR_BGS: { id: string; top: string; bottom: string }[] = [
  { id: 'rose', top: '#D62E63', bottom: '#F95C62' },
  { id: 'orange', top: '#FF8D29', bottom: '#FFB452' },
  { id: 'yellow', top: '#FFC629', bottom: '#FFEE53' },
  { id: 'lime', top: '#6FDA1D', bottom: '#CBFF50' },
  { id: 'green', top: '#0B9F21', bottom: '#4FD24B' },
  { id: 'purple', top: '#4739FF', bottom: '#6670FF' },
  { id: 'blue', top: '#227EFF', bottom: '#5EC1FF' },
  { id: 'lavender', top: '#C056FD', bottom: '#B889FF' },
  { id: 'pink', top: '#F640C0', bottom: '#FF7BF1' },
  { id: 'light_gray', top: '#AEAEAE', bottom: '#D9D9D9' },
  { id: 'gray', top: '#373C4C', bottom: '#4C4F58' },
  { id: 'dark_gray', top: '#1B1D29', bottom: '#252731' },
]
const bgCss = (id: string): string | null => {
  const g = MR_BGS.find((x) => x.id === id)
  return g ? 'linear-gradient(180deg, ' + g.top + ' 0%, ' + g.bottom + ' 100%)' : null
}

/** Пары, где значок сливается с фоном (список Modrinth App), — в случайный выбор не идут. */
const CLASH = new Set([
  'purple:globe', 'blue:globe', 'gray:cogwheel', 'dark_gray:cogwheel', 'rose:poke-ball', 'lime:slime-block', 'green:slime-block',
  'rose:redstone-block', 'rose:couch', 'orange:space-helmet', 'rose:tnt', 'yellow:moobloom', 'light_gray:skillet', 'light_gray:cooking-pot',
])

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Иконка по зерну: та же у сборки при каждом показе (имя), новая — при каждом «кубике». */
export function seededIcon(seed: string): string {
  let h = hash(seed)
  for (let i = 0; i < 8; i++) {
    const sym = MR_SYMBOLS[h % MR_SYMBOLS.length]!
    const bg = MR_BGS[(h >>> 8) % MR_BGS.length]!.id
    if (!CLASH.has(bg + ':' + sym)) return mrSymbol(sym) + '#bg=' + bg
    h = hash(seed + i)
  }
  return mrSymbol('grass-block') + '#bg=purple'
}

export const randomIcon = (): string => seededIcon(Math.random().toString(36))

/**
 * Что показывать у сборки: выбранное игроком — как есть; ничего не выбрано (или старая
 * полка по умолчанию) — своя случайная иконка, постоянная для этой сборки. Сундук-заглушки
 * больше нет нигде (владелец 10.10.2026).
 */
export function buildIconOf(p: { name: string; icon?: string | null }): string {
  const icon = p.icon || ''
  if (!icon || icon === DEFAULT_ICON || icon.startsWith('/bg/')) return seededIcon(p.name)
  return icon
}

export interface BuildIconSpec {
  /** Блок или своя картинка. */
  src: string
  bg: string
  /** block — блок на подложке, photo — своя картинка во весь квадрат. */
  kind: 'block' | 'photo'
  /** Рендер крупнее 96 px: его можно показывать крупнее 64 px. */
  big: boolean
  /** Значок из набора Modrinth App: объёмный, на ярком градиенте. */
  mr?: boolean
}

const isBlock = (src: string) => src.includes('/block-icons/') || src.includes('/build-icons/')

export function parseIcon(icon?: string | null): BuildIconSpec {
  if (!icon || icon.startsWith('/bg/')) return { src: DEFAULT_BLOCK, bg: DEFAULT_BG, kind: 'block', big: true }
  const hash = icon.indexOf('#bg=')
  const src = hash >= 0 ? icon.slice(0, hash) : icon
  const raw = hash >= 0 ? icon.slice(hash + 4) : ''
  // Фон — цвет шестью знаками или градиент Modrinth по имени («#bg=purple»).
  const bg = bgCss(raw) || (/^[0-9a-f]{6}$/i.test(raw) ? '#' + raw.toLowerCase() : DEFAULT_BG)
  if (src.includes('/build-icons/mr/')) return { src, bg: raw ? bg : bgCss('purple')!, kind: 'block', big: true, mr: true }
  if (isBlock(src)) return { src, bg, kind: 'block', big: src.includes('/build-icons/') }
  return { src, bg, kind: 'photo', big: true }
}

/** Строка для поля `icon`: блок с цветом подложки или своя картинка как есть. */
export function makeIcon(src: string, bg: string): string {
  if (!isBlock(src)) return src
  // Градиент Modrinth — по имени; цвет — шестью знаками.
  if (MR_BGS.some((g) => g.id === bg)) return src + '#bg=' + bg
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
