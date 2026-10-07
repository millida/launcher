import { useId } from 'react'
import '../../styles/pixel/plus-mark.css'

/**
 * Знак подписки — крупное пиксельное слово «PLUS» / «DIAMOND» (владелец
 * 06.10.2026: «вместо короны — большое блочное PLUS»). Собран из квадратов
 * одной сеткой: тёмная обводка с «подошвой», тело, светлая грань сверху и
 * тень снизу у каждой буквы, по желанию — блик пробегает по буквам.
 * Один компонент на все места бренда: плитка PLUS в магазине, чип в шапке,
 * строка пропуска, окно тарифа, премиум-тема, значок у ника.
 */

const GLYPHS: Record<string, string[]> = {
  P: ['####.', '##.##', '##.##', '####.', '##...', '##...'],
  L: ['##...', '##...', '##...', '##...', '#####', '#####'],
  U: ['##.##', '##.##', '##.##', '##.##', '#####', '.###.'],
  S: ['.####', '##...', '.###.', '...##', '...##', '####.'],
  D: ['####.', '##.##', '##.##', '##.##', '##.##', '####.'],
  I: ['##', '##', '##', '##', '##', '##'],
  A: ['.###.', '##.##', '##.##', '#####', '##.##', '##.##'],
  M: ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##'],
  O: ['.###.', '##.##', '##.##', '##.##', '##.##', '.###.'],
  N: ['##..##', '###.##', '######', '##.###', '##..##', '##..##'],
}

const H = 6
/** Обводка сверху/слева/справа — 1 клетка, снизу — 2 (подошва). */
const PAD = 1
const SOLE = 1

interface Built {
  w: number
  h: number
  outline: string
  sole: string
  body: string
  hi: string
  lo: string
}

const cache = new Map<string, Built>()

const rect = (x: number, y: number) => `M${x} ${y}h1v1h-1z`

function build(text: string): Built {
  const hit = cache.get(text)
  if (hit) return hit
  const cells = new Set<string>()
  let x = PAD
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (!g) {
      x += 3
      continue
    }
    g.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') cells.add(x + i + ',' + (y + PAD))
    })
    x += g[0].length + 1
  }
  const w = x - 1 + PAD
  const h = H + PAD * 2 + SOLE
  const has = (cx: number, cy: number) => cells.has(cx + ',' + cy)
  const ring = new Set<string>()
  for (const k of cells) {
    const [cx, cy] = k.split(',').map(Number)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) ring.add(cx + dx + ',' + (cy + dy))
  }
  let outline = ''
  let sole = ''
  let body = ''
  let hi = ''
  let lo = ''
  for (const k of ring) {
    const [cx, cy] = k.split(',').map(Number)
    outline += rect(cx, cy)
    if (!ring.has(cx + ',' + (cy + 1))) sole += rect(cx, cy + 1)
  }
  for (const k of cells) {
    const [cx, cy] = k.split(',').map(Number)
    if (!has(cx, cy - 1)) hi += rect(cx, cy)
    else if (!has(cx, cy + 1)) lo += rect(cx, cy)
    else body += rect(cx, cy)
  }
  const out = { w, h, outline, sole, body, hi, lo }
  cache.set(text, out)
  return out
}

export type MarkTier = 'PLUS' | 'DIAMOND'

export function PlusMark({
  tier = 'PLUS',
  text,
  height = 24,
  shine = false,
  className,
  title,
}: {
  tier?: MarkTier | null
  /** Слово на знаке; по умолчанию PLUS / DIAMOND по тарифу. */
  text?: string
  /** Высота знака в пикселях; ширина — по слову. */
  height?: number
  shine?: boolean
  className?: string
  title?: string
}) {
  const diamond = tier === 'DIAMOND'
  const word = (text || (diamond ? 'DIAMOND' : 'PLUS')).toUpperCase()
  const b = build(word)
  const id = useId().replace(/:/g, '')
  const width = (height * b.w) / b.h
  return (
    <svg
      className={'pmark' + (diamond ? ' is-diamond' : ' is-plus') + (shine ? ' is-shine' : '') + (className ? ' ' + className : '')}
      viewBox={`0 0 ${b.w} ${b.h}`}
      width={width}
      height={height}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title || word}
    >
      <path className="pm-sole" d={b.sole} />
      <path className="pm-line" d={b.outline} />
      <path className="pm-body" d={b.body} />
      <path className="pm-hi" d={b.hi} />
      <path className="pm-lo" d={b.lo} />
      {shine ? (
        <>
          <clipPath id={'pmc' + id}>
            <path d={b.body + b.hi + b.lo} />
          </clipPath>
          <g clipPath={`url(#pmc${id})`}>
            <rect className="pm-shine" x={-6} y={0} width={3} height={b.h}/>
          </g>
        </>
      ) : null}
    </svg>
  )
}
