import { FLAG_COLORS, FLAG_COLUMNS, FLAG_ROWS, PX_COUNTRY_FLAGS, shadowRow, type FlagColor, type FlagCountry } from './pxFlags'

const FRAME = 1
const WIDTH = FLAG_COLUMNS + FRAME * 2
const HEIGHT = FLAG_ROWS + 1 + FRAME * 2
const CELL_PX = 2

type Run = { x: number; y: number; length: number; fill: string }

function colorOf(key: string, shade: boolean): string {
  const name = FLAG_COLORS[key as FlagColor] ?? FLAG_COLORS.k
  return shade ? `var(--pxf-${name}-d)` : `var(--pxf-${name})`
}

function runsOf(row: string, y: number, shade: boolean): Run[] {
  const runs: Run[] = []
  for (let x = 0; x < row.length; x++) {
    const fill = colorOf(row.charAt(x), shade)
    const last = runs[runs.length - 1]
    if (last && last.fill === fill && last.x + last.length === x + FRAME) last.length += 1
    else runs.push({ x: x + FRAME, y, length: 1, fill })
  }
  return runs
}

/// A pixel flag: the face, a darker shadow row under it and a black frame one cell thick.
export function PxFlag({ country, className }: { country: FlagCountry; className?: string }) {
  const rows = PX_COUNTRY_FLAGS[country]
  const shadow = shadowRow(rows[rows.length - 1] ?? '')
  const runs = [...rows.flatMap((row, y) => runsOf(row, y + FRAME, false)), ...runsOf(shadow, FLAG_ROWS + FRAME, true)]
  return (
    <svg
      className={className}
      width={WIDTH * CELL_PX}
      height={HEIGHT * CELL_PX}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      <rect width={WIDTH} height={HEIGHT} style={{ fill: 'var(--pxf-frame)' }} />
      {runs.map((run) => (
        <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.length} height={1} style={{ fill: run.fill }} />
      ))}
    </svg>
  )
}
