export const FLAG_COLUMNS = 16
export const FLAG_ROWS = 11

/// Cell colors of the flags. Each key names a CSS custom property pair in 02-kit.css:
/// `--pxf-<name>` for the face and `--pxf-<name>-d` for the darker shadow row under it.
export const FLAG_COLORS = {
  w: 'white',
  r: 'red',
  R: 'crimson',
  b: 'blue',
  B: 'azure',
  f: 'cobalt',
  n: 'navy',
  y: 'yellow',
  Y: 'gold',
  g: 'green',
  G: 'forest',
  k: 'black',
  o: 'saffron',
} as const

export type FlagColor = keyof typeof FLAG_COLORS

export type FlagCountry =
  | 'ru' | 'us' | 'br' | 'es' | 'de' | 'tr' | 'pl' | 'cn' | 'in' | 'sa'
  | 'fr' | 'bd' | 'id' | 'pk' | 'jp' | 'vn' | 'kr' | 'ua' | 'rs' | 'sk'

function bands(...parts: readonly (readonly [string, number])[]): string[] {
  return parts.flatMap(([row, count]) => Array.from({ length: count }, () => row))
}

const W = 'wwwwwwwwwwwwwwww'
const R = 'rrrrrrrrrrrrrrrr'

/// Face of every flag: 16 x 11 cells, a thick black frame and a darker shadow row are added by the
/// renderer. Shapes stay large and stepped, without emblems smaller than two cells.
export const PX_COUNTRY_FLAGS: Readonly<Record<FlagCountry, readonly string[]>> = {
  ru: bands([W, 4], ['bbbbbbbbbbbbbbbb', 4], [R, 3]),
  us: [
    'nnnnnnnrrrrrrrrr',
    'nwnwnwnwwwwwwwww',
    'nnwnwnnrrrrrrrrr',
    'nwnwnwnwwwwwwwww',
    'nnwnwnnrrrrrrrrr',
    'nnnnnnnwwwwwwwww',
    R,
    W,
    R,
    W,
    R,
  ],
  br: [
    'gggggggggggggggg',
    'gggggggyyggggggg',
    'ggggggyyyygggggg',
    'ggggyyynnyyygggg',
    'gggyyynnnnyyyggg',
    'gyyyynnnnnnyyyyg',
    'gyyyynnnnnnyyyyg',
    'gggyyynnnnyyyggg',
    'ggggyyynnyyygggg',
    'ggggggyyyygggggg',
    'gggggggyyggggggg',
  ],
  es: bands(['RRRRRRRRRRRRRRRR', 3], ['YYYYYYYYYYYYYYYY', 6], ['RRRRRRRRRRRRRRRR', 2]),
  de: bands(['kkkkkkkkkkkkkkkk', 4], [R, 4], ['YYYYYYYYYYYYYYYY', 3]),
  tr: [
    R,
    'rrrrwwwrrrrrrrrr',
    'rrrwwrrrrrrrrrrr',
    'rrwwrrrrrrrrrrrr',
    'rrwrrrrrrrwrrrrr',
    'rwwrrrrrrwwwrrrr',
    'rwwrrrrrrrwrwrrr',
    'rrwrrrrrrrrrrrrr',
    'rrwwrrrrrrrrrrrr',
    'rrrwwrrrrrrrrrrr',
    'rrrrwwwrrrrrrrrr',
  ],
  pl: bands([W, 6], [R, 5]),
  cn: [
    R,
    'rrrryrrryrrrrrrr',
    'rryyyyyrrrrrrrrr',
    'rrryyyrrryrrrrrr',
    'rrryryrrrrrrrrrr',
    'rrrrrrrryrrrrrrr',
    R,
    R,
    R,
    R,
    R,
  ],
  in: [
    ...bands(['oooooooooooooooo', 4]),
    'wwwwwwwnnwwwwwww',
    'wwwwwwnwwnwwwwww',
    'wwwwwwnwwnwwwwww',
    'wwwwwwwnnwwwwwww',
    ...bands(['gggggggggggggggg', 3]),
  ],
  sa: [
    'gggggggggggggggg',
    'gggggggggggggggg',
    'ggwgwwgwwgwgwggg',
    'ggwwwwwwwwwwwwgg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'ggwwwwwwwwwwwggg',
    'ggggggggggggwggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
  ],
  fr: bands(['fffffwwwwwwrrrrr', 11]),
  bd: [
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggggrrrrggggggg',
    'ggggrrrrrrgggggg',
    'ggggrrrrrrgggggg',
    'ggggrrrrrrgggggg',
    'ggggrrrrrrgggggg',
    'gggggrrrrggggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
  ],
  id: bands([R, 6], [W, 5]),
  pk: [
    'wwwwGGGGGGGGGGGG',
    'wwwwGGGGwwwGGGGG',
    'wwwwGGGwwGGGGGGG',
    'wwwwGGwwGGGGGGGG',
    'wwwwGGwGGGGGwGGG',
    'wwwwGwwGGGGwwwGG',
    'wwwwGGwGGGGGwGwG',
    'wwwwGGwwGGGGGGGG',
    'wwwwGGGwwGGGGGGG',
    'wwwwGGGGwwwGGGGG',
    'wwwwGGGGGGGGGGGG',
  ],
  jp: [
    W,
    W,
    W,
    'wwwwwwrrrrwwwwww',
    'wwwwwrrrrrrwwwww',
    'wwwwwrrrrrrwwwww',
    'wwwwwrrrrrrwwwww',
    'wwwwwrrrrrrwwwww',
    'wwwwwwrrrrwwwwww',
    W,
    W,
  ],
  vn: [
    R,
    R,
    'rrrrrrryyrrrrrrr',
    'rrrrrrryyrrrrrrr',
    'rrrryyyyyyyyrrrr',
    'rrrrryyyyyyrrrrr',
    'rrrrrryyyyrrrrrr',
    'rrrrryyrryyrrrrr',
    'rrrrryrrrryrrrrr',
    R,
    R,
  ],
  kr: [
    W,
    'wwwkwwwwwwwwkwww',
    'wwkwwwwwwwwwwkww',
    'wkwwwwrrrrwwwwkw',
    'wwwwwrrrrrrwwwww',
    'wwwwwrrrrbbwwwww',
    'wwwwwbbbbbbwwwww',
    'wkwwwwbbbbwwwwkw',
    'wwkwwwwwwwwwwkww',
    'wwwkwwwwwwwwkwww',
    W,
  ],
  ua: bands(['BBBBBBBBBBBBBBBB', 6], ['yyyyyyyyyyyyyyyy', 5]),
  rs: bands(['RRRRRRRRRRRRRRRR', 4], ['nnnnnnnnnnnnnnnn', 4], [W, 3]),
  sk: [
    W,
    W,
    'wwwrrwrrwwwwwwww',
    'wwwrwwwrwwwwwwww',
    'bbbrrwrrbbbbbbbb',
    'bbbrwwwrbbbbbbbb',
    'bbbrrwrrbbbbbbbb',
    'bbbrnnnrbbbbbbbb',
    'RRRwrnrwRRRRRRRR',
    'RRRRwrwRRRRRRRRR',
    'RRRRRRRRRRRRRRRR',
  ],
}

/// The shadow continues the field, not the emblem: a row that is mostly one color (a crescent or a
/// rhombus touching the edge) casts a plain shadow, while vertical stripes keep their own shades.
export function shadowRow(bottom: string): string {
  const counts = new Map<string, number>()
  for (const cell of bottom) counts.set(cell, (counts.get(cell) ?? 0) + 1)
  const [field, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['k', 0]
  return count / bottom.length > 0.75 ? field.repeat(bottom.length) : bottom
}
