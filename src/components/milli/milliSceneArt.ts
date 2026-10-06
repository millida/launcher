/*
 * Сцена Милли (04.10.2026, владелец: «просто и чисто»): мягкая пиксельная
 * тень, несколько медленных частиц и разлёт частиц при тыке. Всё считается
 * один раз при загрузке модуля.
 */

/** Тень под Милли: три ступенчатых эллипса — от широкого бледного к узкому тёмному. */
export const SHADOW = [
  [44, 8],
  [34, 6],
  [22, 4],
].map(([rx, ry]) => pixelEllipse(rx!, ry!, 2))

/** Медленные частицы в воздухе: место (%), задержка, длительность. */
export const MOTES: readonly { x: number; y: number; d: number; t: number }[] = [
  { x: 18, y: 12, d: 0, t: 9 },
  { x: 74, y: 6, d: 3.2, t: 11 },
  { x: 86, y: 40, d: 6.1, t: 10 },
  { x: 10, y: 46, d: 4.4, t: 12 },
  { x: 62, y: 22, d: 8.3, t: 10 },
]

/** Ступенчатый эллипс с центром в 0,0: ряды высотой `cell`, полуширина округлена до клетки. */
export function pixelEllipse(rx: number, ry: number, cell: number): string {
  let d = ''
  const rows = Math.ceil(ry / cell)
  for (let i = -rows; i < rows; i++) {
    const yc = (i + 0.5) * cell
    const t = 1 - (yc * yc) / (ry * ry)
    if (t <= 0) continue
    const hw = Math.round((rx * Math.sqrt(t)) / cell) * cell
    if (hw <= 0) continue
    d += `M${-hw} ${i * cell}h${hw * 2}v${cell}h${-hw * 2}z`
  }
  return d
}

/** Разлёт частиц как в игре: вбок, вверх и падение под тяжестью. */
export const PARTICLES: readonly { dx: number; up: number; fall: number; s: number; d: number }[] = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : 0)
  const r = 0.55 + ((i * 37) % 10) / 22
  return {
    dx: Math.round(Math.cos(a) * r * 100) / 100,
    up: Math.round((0.45 + ((i * 53) % 10) / 20) * 100) / 100,
    fall: Math.round((0.6 + ((i * 29) % 10) / 14) * 100) / 100,
    s: i % 3 === 0 ? 6 : 4,
    d: (i % 4) * 30,
  }
})
