// Переход на страницу Arcania — один в один как переход между сайтами на arcania.fun
// (пиксельное растворение оттуда и перенесено). Экран затягивается клетками от карточки,
// по которой нажали, страница открывается под покрытием, и волна расходится обратно.
// Порядок клеток — расстояние от точки нажатия плюс шум, поэтому волна не ровный круг;
// фронт вспыхивает зелёным Арканьи. Холст в конце убирается целиком — следов не остаётся.

const CELL = 36
const FLASH = 0.07
const COVER_MS = 440
const REVEAL_MS = 460
/** Страница так и не сказала «я готова» — открываемся сами, чтобы не висеть под покрытием. */
const MAX_COVER_MS = 4000
const CANVAS = '#0e100e'
const ACCENT = '#7bd35a'

type Point = { x: number; y: number }

type Grid = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  rects: Int32Array
  order: Uint32Array
  delays: Float32Array
}

function createGrid(origin: Point, block: boolean): Grid {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = window.innerWidth
  const height = window.innerHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * dpr)
  canvas.height = Math.ceil(height * dpr)
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: `${width}px`,
    height: `${height}px`,
    zIndex: '9998',
    pointerEvents: block ? 'auto' : 'none',
  })
  const ctx = canvas.getContext('2d', { alpha: true })!

  const cols = Math.ceil(width / CELL)
  const rows = Math.ceil(height / CELL)
  const count = cols * rows
  const rects = new Int32Array(count * 4)
  const raw = new Float32Array(count)
  const maxDist = Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y))

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const x0 = Math.round(c * CELL * dpr)
      const y0 = Math.round(r * CELL * dpr)
      rects[i * 4] = x0
      rects[i * 4 + 1] = y0
      rects[i * 4 + 2] = Math.round((c + 1) * CELL * dpr) - x0
      rects[i * 4 + 3] = Math.round((r + 1) * CELL * dpr) - y0
      const dist = Math.hypot(c * CELL + CELL / 2 - origin.x, r * CELL + CELL / 2 - origin.y) / maxDist
      raw[i] = dist * 0.72 + Math.random() * 0.28
    }

  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[i] = i
  order.sort((a, b) => raw[a]! - raw[b]!)
  const delays = new Float32Array(count)
  for (let k = 0; k < count; k++) delays[k] = raw[order[k]!]!
  return { canvas, ctx, rects, order, delays }
}

function paint(grid: Grid, k: number, color: string | null) {
  const i = grid.order[k]! * 4
  const { ctx, rects } = grid
  if (color === null) ctx.clearRect(rects[i]!, rects[i + 1]!, rects[i + 2]!, rects[i + 3]!)
  else {
    ctx.fillStyle = color
    ctx.fillRect(rects[i]!, rects[i + 1]!, rects[i + 2]!, rects[i + 3]!)
  }
}

function cover(origin: Point, onCovered: () => void): () => void {
  const grid = createGrid(origin, true)
  document.body.appendChild(grid.canvas)
  const total = grid.delays.length
  let flashed = 0
  let settled = 0
  let start = 0
  let raf = 0
  const frame = (now: number) => {
    start ||= now
    const t = (now - start) / COVER_MS
    while (flashed < total && grid.delays[flashed]! <= t) paint(grid, flashed++, ACCENT)
    while (settled < flashed && grid.delays[settled]! <= t - FLASH) paint(grid, settled++, CANVAS)
    if (settled < total) raf = requestAnimationFrame(frame)
    else onCovered()
  }
  raf = requestAnimationFrame(frame)
  return () => {
    cancelAnimationFrame(raf)
    grid.canvas.remove()
  }
}

function reveal(origin: Point): void {
  const grid = createGrid(origin, false)
  grid.ctx.fillStyle = CANVAS
  grid.ctx.fillRect(0, 0, grid.canvas.width, grid.canvas.height)
  document.body.appendChild(grid.canvas)
  const total = grid.delays.length
  let flashed = 0
  let cleared = 0
  let start = 0
  const frame = (now: number) => {
    start ||= now
    const k = Math.min(1, (now - start) / REVEAL_MS)
    const progress = (1 + FLASH) * (1 - (1 - k) ** 3)
    while (flashed < total && grid.delays[flashed]! <= progress + FLASH) paint(grid, flashed++, ACCENT)
    while (cleared < flashed && grid.delays[cleared]! <= progress) paint(grid, cleared++, null)
    if (k < 1) requestAnimationFrame(frame)
    else grid.canvas.remove()
  }
  requestAnimationFrame(frame)
}

let lastPointer: Point | null = null
let origin: Point | null = null
let stopCover: (() => void) | null = null
let failsafe = 0

if (typeof window !== 'undefined')
  window.addEventListener('pointerdown', (e) => (lastPointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true })

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const center = (): Point => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

/** Затянуть экран от точки нажатия и только потом открыть страницу (open). */
export function enterArcania(open: () => void): void {
  if (reduced() || stopCover) return open()
  origin = lastPointer ?? center()
  stopCover = cover(origin, () => {
    open()
    failsafe = window.setTimeout(arriveArcania, MAX_COVER_MS)
  })
}

/** Страница отрисована — растворить покрытие. Открыли без перехода — ничего не делает. */
export function arriveArcania(): void {
  window.clearTimeout(failsafe)
  if (!stopCover) return
  // Новое покрытие кладётся раньше, чем убирается старое: между ними нет пустого кадра.
  reveal(origin ?? center())
  stopCover()
  stopCover = null
  origin = null
}
