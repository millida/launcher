/**
 * Формат пиксельных предметов Милли (в духе предметов Minecraft 16×16).
 *
 * Рисунок — 16 строк по 16 символов и своя палитра: символ → цвет `#rrggbb`.
 * `.` — прозрачная клетка (в палитру не входит). Так рисунок видно глазами
 * прямо в коде и легко поправить одну клетку.
 *
 * Правила стиля (как у Mojang): твёрдые клетки без сглаживания, контур в одну
 * клетку темнее материала, свет сверху-слева, 3–5 тонов на материал со сдвигом
 * оттенка (тени холоднее, блики теплее), блоки — изометрия в три грани.
 */

export type PxPalette = Readonly<Record<string, string>>

export interface PxSprite {
  /** Символ → цвет. `.` не задаётся: это прозрачность. */
  pal: PxPalette
  /** 16 строк по 16 символов. */
  rows: readonly string[]
  /**
   * Блеск зачарования (фиолетовые полосы бегут по диагонали): символы палитры,
   * клетки которых блестят; `*` — весь предмет.
   */
  glint?: string
}

export const PX_GRID = 16
export const PX_EMPTY = '.'

/** Отрезок одного цвета в ряд: так SVG получает один <rect> вместо нескольких. */
export interface PxRun {
  x: number
  y: number
  w: number
  fill: string
}

/** Строки → отрезки одного цвета по горизонтали. */
export function pxRuns(s: PxSprite): PxRun[] {
  const out: PxRun[] = []
  s.rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]!
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      const fill = ch === PX_EMPTY ? undefined : s.pal[ch]
      if (fill) out.push({ x, y, w: end - x, fill })
      x = end
    }
  })
  return out
}

/** Сколько полос блеска (каждая гаснет и вспыхивает со своим сдвигом). */
export const PX_GLINT_BANDS = 4

/** Клетки блеска, сгруппированные по диагональным полосам 0…BANDS-1. */
export function pxGlintRuns(s: PxSprite): { x: number; y: number; w: number; band: number }[] {
  if (!s.glint) return []
  const all = s.glint === '*'
  const out: { x: number; y: number; w: number; band: number }[] = []
  s.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      if (ch === PX_EMPTY || !(all || s.glint!.includes(ch))) continue
      const band = Math.floor((x + y) / 3) % PX_GLINT_BANDS
      const last = out[out.length - 1]
      if (last && last.y === y && last.band === band && last.x + last.w === x) last.w++
      else out.push({ x, y, w: 1, band })
    }
  })
  return out
}
