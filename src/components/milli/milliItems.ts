/*
 * Предметы Милли (04.10.2026, владелец: «нарисуй значки сам, как настоящие
 * предметы Minecraft 16×16 в ячейке инвентаря»). Рисунки — строки клеток с
 * палитрой; часть собрана по формуле (часы, барьер). Отрисовка — McItem.tsx.
 * Блеск зачарованной книги — отдельный слой полос (`glint`), его гоняет CSS.
 */

export type McItemName = 'zombie' | 'torch' | 'wheat' | 'ebook' | 'book' | 'star' | 'clock' | 'feather' | 'bell' | 'barrier'

export interface McPixel {
  x: number
  y: number
  w: number
  c: string
}

export interface McArt {
  size: number
  px: McPixel[]
  /** Полосы блеска: отрезки ряда и номер полосы 0…2. */
  glint?: { x: number; y: number; w: number; band: number }[]
  /** Клетки, что мерцают (огонёк факела, искра звезды). */
  glow?: McPixel[]
}

type Palette = Record<string, string>

/** Строки клеток → отрезки одного цвета в ряд (меньше <rect>). `scale` — для голов 8×8. */
function fromRows(rows: readonly string[], pal: Palette, scale = 1, glowKey = ''): McArt {
  if (rows.some((r) => r.length !== rows.length)) throw new Error('McItem: рисунок не квадратный')
  const px: McPixel[] = []
  const glow: McPixel[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]!
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      const c = pal[ch]
      if (c) {
        for (let k = 0; k < scale; k++) {
          const p = { x: x * scale, y: y * scale + k, w: (end - x) * scale, c }
          if (glowKey.includes(ch)) glow.push(p)
          else px.push(p)
        }
      }
      x = end
    }
  })
  return { size: rows.length * scale, px, glow: glow.length ? glow : undefined }
}

/** Рисунок по формуле: `pick(x, y)` возвращает цвет клетки или ''. */
function fromFn(size: number, pick: (x: number, y: number) => string): McArt {
  const rows: string[] = []
  const pal: Palette = {}
  const keys = new Map<string, string>()
  for (let y = 0; y < size; y++) {
    let r = ''
    for (let x = 0; x < size; x++) {
      const c = pick(x, y)
      if (!c) {
        r += '.'
        continue
      }
      let k = keys.get(c)
      if (!k) {
        k = String.fromCharCode(65 + keys.size)
        keys.set(c, k)
        pal[k] = c
      }
      r += k
    }
    rows.push(r)
  }
  return fromRows(rows, pal)
}

/** Голова зомби: лицо 8×8, как текстура моба, клетка — 2×2. */
const ZOMBIE = fromRows(
  ['aaabaaba', 'babbbabb', 'cdccccdc', 'dccdcccd', 'ctkccktc', 'cccnnccc', 'dcmmmmcd', 'cbccccbc'],
  { a: '#2f4a22', b: '#3f6a2c', c: '#5c9a43', d: '#6fb052', k: '#0c140a', t: '#1f5a55', n: '#3c6a2c', m: '#28401d' },
  2,
)

/** Факел из красного камня: палочка и светящаяся головка. */
const TORCH = fromRows(
  [
    '................',
    '......g..g......',
    '....g.rLLr.g....',
    '.....rLYYLr.....',
    '....grLYYLrg....',
    '.....rRLLRr.....',
    '......rRRr......',
    '.......Ww.......',
    '.......Ww.......',
    '.......Ww.......',
    '.......Ww.......',
    '.......Ww.......',
    '.......Ww.......',
    '.......Ww.......',
    '.......ww.......',
    '................',
  ],
  { w: '#4f3a1e', W: '#8a6a3a', r: '#6e0c0c', R: '#b81d16', L: '#ff4a3a', Y: '#ffd2c2', g: '#ff3a26' },
  1,
  'g',
)

/** Пшеница: три колоса, перевязанные посередине. */
const WHEAT = fromRows(
  [
    '.......Y........',
    '...Y..YyY...Y...',
    '..YyY.yoy..YyY..',
    '..yoy.YyY..yoy..',
    '..YyY.yoy.YyY...',
    '...yo.YyY.yoy...',
    '...Yy..yo.Yy....',
    '....s..s..s.....',
    '....s..s.s......',
    '.....s.s.s......',
    '......bbbb......',
    '......sSss......',
    '.....s.S.s......',
    '.....s.S..s.....',
    '....s..S..s.....',
    '................',
  ],
  { Y: '#f3dc7a', y: '#d9b443', o: '#9c7a22', s: '#a3b445', S: '#6f8a2a', b: '#7a4f1c' },
)

const BOOK_ROWS = [
  '................',
  '...kkkkkkkkkkk..',
  '..kcChCCCCCCckp.',
  '..kcCCCCCCCCckp.',
  '..kcCCCCCCCCckp.',
  '..kcCChhhhCCckp.',
  '..kcCChkkhCCckp.',
  '..kcCChhhhCCckp.',
  '..kcCCCCCCCCckp.',
  '..kcCCCCCCCCckp.',
  '..kcCCCCCCCCckp.',
  '..kcCCCCCCCCckp.',
  '..kccccccccccKP.',
  '...pppppppppppP.',
  '....PPPPPPPPPPP.',
  '................',
]
const BOOK_PAL: Palette = { k: '#2e140c', K: '#2e140c', c: '#5e2616', C: '#87381e', h: '#b8603a', p: '#ece4cc', P: '#b9ab86' }

/** Книга — история чатов. */
const BOOK = fromRows(BOOK_ROWS, BOOK_PAL)

/** Зачарованная книга: та же книга, по ней бегут полосы блеска. */
const EBOOK: McArt = {
  ...fromRows(BOOK_ROWS, { ...BOOK_PAL, C: '#7b3a5c', c: '#552243', h: '#b06ac2' }),
  glint: BOOK_ROWS.flatMap((row, y) => {
    const out: { x: number; y: number; w: number; band: number }[] = []
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue
      const band = Math.floor((x + y) / 4) % 3
      const last = out[out.length - 1]
      if (last && last.band === band && last.x + last.w === x) last.w++
      else out.push({ x, y, w: 1, band })
    }
    return out
  }),
}

/** Звезда Незера — «Улучшенная сборка». */
const STAR = fromRows(
  [
    '................',
    '.......w........',
    '.......w........',
    '......wWw.......',
    '..w...wWw...w...',
    '...wwwWYWwww....',
    '....wWYYYWw.....',
    'wwwwWYYYYYWwwww.',
    '....wWYYYWw.....',
    '...wwwWYWwww....',
    '..w...wWw...w...',
    '......wWw.......',
    '.......w........',
    '.......w........',
    '................',
    '................',
  ],
  { w: '#b9b0e6', W: '#ffffff', Y: '#fff3bd' },
)

/** Часы: золотой обод, сверху день с солнцем, снизу ночь. */
const CLOCK = fromFn(16, (x, y) => {
  const dx = x + 0.5 - 8
  const dy = y + 0.5 - 8
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d > 7.2) return ''
  if (d > 6.3) return '#4a3408'
  if (d > 5.1) return dx + dy < -2 ? '#fff07a' : dx + dy > 3 ? '#b88a18' : '#e8c43a'
  if (x === 6 && y === 5) return '#ffe04a'
  if (x === 10 && y === 10) return '#f0f0ff'
  if (Math.abs(dy) < 0.6) return '#2a2f4a'
  return dy < 0 ? '#3f74d8' : '#1a1f3a'
})

/** Перо — «Новый чат». */
const FEATHER = fromRows(
  [
    '................',
    '............wW..',
    '...........wWWw.',
    '..........wWWWw.',
    '.........wWWWw..',
    '........wWWWw...',
    '.......wWWWw....',
    '......wWWWw.....',
    '.....wWWWw......',
    '.....wWWw.......',
    '....g.ww........',
    '...g............',
    '..g.............',
    '.g..............',
    '................',
    '................',
  ],
  { w: '#c8c8c8', W: '#f4f4f4', g: '#6a6a6a' },
)

/** Колокол — поддержка. */
const BELL = fromRows(
  [
    '................',
    '.......oo.......',
    '......oooo......',
    '.....oYYyyo.....',
    '....oYyyyyyo....',
    '....oYyyyyyo....',
    '....oYyyyyyo....',
    '...oYyyyyyyyo...',
    '...oYyyyyyyyo...',
    '..oYyyyyyyyyyo..',
    '..oddddddddddo..',
    '..oooooooooooo..',
    '......oYYo......',
    '.......oo.......',
    '................',
    '................',
  ],
  { o: '#5e4008', Y: '#fff07a', y: '#e0b030', d: '#a87c18' },
)

/** Барьер — «Закрыть»: красное кольцо с чертой. */
const BARRIER = fromFn(16, (x, y) => {
  const dx = x + 0.5 - 8
  const dy = y + 0.5 - 8
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d <= 6.9 && d >= 4.9) return dx + dy < -1 ? '#ff5a4a' : '#d4231a'
  if (d < 4.9 && Math.abs(dx - dy) < 1.5) return '#d4231a'
  return ''
})

export const MC_ITEMS: Record<McItemName, McArt> = {
  zombie: ZOMBIE,
  torch: TORCH,
  wheat: WHEAT,
  ebook: EBOOK,
  book: BOOK,
  star: STAR,
  clock: CLOCK,
  feather: FEATHER,
  bell: BELL,
  barrier: BARRIER,
}

/** Глифы зачарования (стандартный галактический алфавит) 5×5 — летят в шар, пока Милли думает. */
export const ENCHANT_GLYPHS: readonly (readonly string[])[] = [
  ['#...#', '#...#', '#####', '..#..', '..#..'],
  ['####.', '...#.', '.###.', '.#...', '.####'],
  ['#.#.#', '#.#.#', '#.#.#', '....#', '#####'],
  ['..#..', '.#.#.', '#...#', '.....', '#####'],
  ['#####', '#....', '#.###', '#...#', '.###.'],
  ['#..#.', '#..#.', '####.', '...#.', '...##'],
  ['.###.', '#...#', '.....', '#...#', '.###.'],
  ['##.##', '..#..', '..#..', '..#..', '##.##'],
]
