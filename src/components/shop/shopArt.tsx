/**
 * Крупный пиксель-арт магазина (ТЗ v3): корона PLUS и кристалл Diamond.
 * Рисунок — строки клеток, как в pxArt.ts, но крупнее и со своей палитрой:
 * на герое это картинка, а не значок. Без сглаживания (crispEdges).
 */
const PAL: Record<string, string> = {
  k: '#1b1f1c', // контур
  Y: '#b8860b', // тень золота
  y: '#f5b301', // золото
  l: '#ffe27a', // блик золота
  r: '#e8364f', // рубин
  R: '#9e1b33',
  b: '#36b3ff', // сапфир
  B: '#1764b8',
  w: '#ffffff',
  c: '#bfefff', // блик кристалла
  d: '#0d3f80', // тень кристалла
  z: '#ffd23f', // молния
  Z: '#c98a00',
}

function Pix({ rows, size, className }: { rows: string[]; size: number; className?: string }) {
  const w = Math.max(...rows.map((r) => r.length))
  const h = rows.length
  const rects: { x: number; y: number; n: number; f: string }[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]!
      const fill = PAL[ch]
      if (!fill) {
        x += 1
        continue
      }
      let n = 1
      while (row[x + n] === ch) n += 1
      rects.push({ x, y, n, f: fill })
      x += n
    }
  })
  return (
    <svg className={className} width={(size * w) / h} height={size} viewBox={'0 0 ' + w + ' ' + h} shapeRendering="crispEdges" aria-hidden="true">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.n} height={1} fill={r.f} />
      ))}
    </svg>
  )
}

/** Корона PLUS (06.10.2026): золото в три тона, рубины и сапфир, блики, тёмный контур. */
const CROWN_V2 = [
  '.....kk..........kk..........kk.....',
  '....klyk........klyk........klyk....',
  '....kyyk........kyyk........kyyk....',
  '.....kk..........kk..........kk.....',
  '....kyyk........kyyk........kyyk....',
  '...kylyyk......kylyyk......kylyyk...',
  '..kyyyyyyk....kyyyyyyk....kyyyyyyk..',
  '..kylyyyyyk..kyylyyyyyk..kyyyyyyyk..',
  '..kyyyyyyyykkyyyyyyyyyykkyyyyyyyyk..',
  '..kyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyk..',
  '..kyllyyyyyyyyyyyyyyyyyyyyyyyyyyyk..',
  '..kyykkkyyyyykkkkyyyyykkkkyyyyykkk..',
  '..kyykrrkyyykbbbbkyyykrrkkyyyykrrk..',
  '..kyykrwRkyykbcbBkyyykrwRkyyyykrwk..',
  '..kyykRRkyyykBBBBkyyykRRkkyyyykRRk..',
  '..kyyykkyyyyykkkkyyyyykkyyyyyyykkk..',
  '..kYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYk..',
  '..klllllllllllllllllllllllllllllk..',
  '..kyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyk..',
  '..kYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYk..',
  '...kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk...',
]

const CROWN = [
  '..k........kk........k..',
  '.kyk......kllk......kyk.',
  '.kyyk.....klyk.....kyyk.',
  '.kyyyk...kyyyyk...kyyyk.',
  '.klyyyk..kyyyyk..kyyyyk.',
  '.kyyyyyk.kyyyyk.kyyyyyk.',
  '.kyyyyyykkyyyykkyyyyyyk.',
  '.kyyyyyyyyyyyyyyyyyyyyk.',
  '.kyllyyyyyyyyyyyyyyyyyk.',
  '.kyyykrrkyyykbbkyyykrrk.',
  '.kyyykrRkyyykbBkyyykrRk.',
  '.kyyyykkyyyyykkyyyyykkk.',
  '.kYYYYYYYYYYYYYYYYYYYYk.',
  '.kyyyyyyyyyyyyyyyyyyyyk.',
  '.kYYYYYYYYYYYYYYYYYYYYk.',
  '..kkkkkkkkkkkkkkkkkkkk..',
]

const GEM = [
  '....kkkkkkkk....',
  '...kccbbbbbbk...',
  '..kcwcbbbbbBBk..',
  '.kccbbbbbbbbBBk.',
  'kbbbbbbbbbbbbBBk',
  'kkkkkkkkkkkkkkkk',
  '.kbbbbbbbbbbBBk.',
  '..kbbbbbbbbBBk..',
  '...kbbbbbbBBk...',
  '....kbbbbBBk....',
  '.....kbbBBk.....',
  '......kbBk......',
  '.......kk.......',
]

const BOLT = [
  '....kkkk',
  '...kzzzk',
  '..kzzzk.',
  '.kzzzkkk',
  'kzzzzzzk',
  'kkkzzzk.',
  '..kzzk..',
  '.kzzk...',
  '.kzk....',
  'kzk.....',
  'kk......',
]

export const CrownArt = ({ size = 96, className }: { size?: number; className?: string }) => <Pix rows={CROWN} size={size} className={className} />
export const GemArt = ({ size = 40, className }: { size?: number; className?: string }) => <Pix rows={GEM} size={size} className={className} />
export const BoltArt = ({ size = 24, className }: { size?: number; className?: string }) => <Pix rows={BOLT} size={size} className={className} />

export const CrownArtV2 = ({ size = 48, className }: { size?: number; className?: string }) => <Pix rows={CROWN_V2} size={size} className={className} />
