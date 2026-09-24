/**
 * Статичная сцена лобби: резкий шейдерный кадр Minecraft-мира фоном и слои
 * рецепта Brawl Stars поверх (analysis/2026-09-23_lobby-background-research.md,
 * …-lobby-stage-research.md, …-lobby-stage-brawl.md).
 *
 * Владелец 23.09.2026: «фон всё ещё полное дерьмо» — прошлый кадр был 1280×720,
 * растянут и размыт (мыло). Теперь основа — кадр ≥2560 px без размытия:
 * качество видно, а не описано.
 *
 * Слои снизу вверх:
 *  - мир: cover по окну, точка BACKDROP.feet встаёт под ноги героя;
 *  - цветокор под кнопки: мир чуть темнее и тянется к цвету кнопок, но
 *    остаётся фотографией — герой читается ярче фона;
 *  - пол: ближний склон в тени — мир под линией ног темнеет (текстура мира
 *    видна сквозь тень), кромку ловит свет за героем;
 *  - свет за героем на уровне бёдер (ядро ≈ 26% ширины, половина яркости
 *    ≈ 46%, замер Brawl-o-ween) и пятно света на полу у ног;
 *  - мягкая тень под ногами;
 *  - виньетка (отдельный слой): центр чистый, углы и низ под кнопками тёмные.
 *
 * Всё считается один раз на размер окна и цвет кнопок. Случайных чисел нет.
 */

export const FEET_AT = 0.77
/** Центр света, доля высоты: за бёдрами и ногами героя. */
export const LIGHT_AT = 0.6

export interface Backdrop {
  src: string
  /** Точка кадра (доли ширины и высоты), которая встаёт под ноги героя. */
  feet: { x: number; y: number }
  /** Сила подтяжки к цвету кнопок, 0–1. Золотой закат держит свой цвет. */
  grade: number
  /** Пиксель-арт: масштаб без сглаживания, только целый шаг. */
  pixel?: boolean
}

/**
 * Основа сцены — «Золотой час в тайге»: шейдерный кадр Minecraft 5120×2495
 * (Wallhaven 2yop99, автор не указан), ужат до 3694×1800, webp 551 КБ.
 * Низкое солнце и тёплая дымка дают честный источник для ореола Brawl Stars,
 * два заснеженных холма встают кулисами слева и справа, центр — пустое небо
 * под персонажа, ноги — на тёмной кромке тайги (70%). Выбран из 12 кандидатов
 * (analysis/2026-09-23_lobby-background-research.md): в любом цвете кнопок
 * держит закат — фиолетовый, оранжевый, зелёный.
 */
const MAIN: Backdrop = { src: '/lobby/world.webp', feet: { x: 0.33, y: 0.74 }, grade: 0.35 }

export const BACKDROP = MAIN
export const WORLD_SRC = BACKDROP.src

export interface Pal {
  accent: string
  tint: string
  base: string
  light: string
  dark: string
  wave: string
  flash: string
  /** Ядро света, средний и глубокий зелёный — для «Mojang»-фона (#hex). */
  core: string
  mid: string
  deep: string
  glowCore: string
  glowMid: string
  glowEdge: string
  glowDeep: string
  glowVoid: string
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255)
}

/** Палитра от цвета кнопок. */
export function makePal(c: string, shade: (hex: string, amt: number) => string): Pal {
  return {
    accent: rgb(c),
    tint: rgb(shade(c, 0.3)),
    base: shade(c, -0.8),
    light: rgb(shade(c, 0.62)),
    dark: rgb(shade(c, -0.9)),
    wave: rgb(shade(c, -0.62)),
    flash: rgb(shade(c, -0.1)),
    core: shade(c, 0.12),
    mid: shade(c, -0.35),
    deep: shade(c, -0.8),
    // Brawl Ball: центр #cff989, края #26b447 — светлый оттенок и сам цвет.
    // Приглушённее и темнее, как старый фон лобби со скрина владельца
    // (24.09.2026, 11:28); свет из центра остаётся.
    glowCore: shade(c, 0.32),
    glowMid: mix(c, '#000000', 0.18),
    glowEdge: mix(c, '#000000', 0.34),
    // Воронка к краям (владелец 24.09.2026, 07:44: «с краёв слишком зелёный»).
    glowDeep: mix(c, '#000000', 0.5),
    glowVoid: mix(c, '#000000', 0.66),
  }
}

function mk(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

function ctx2d(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  return g
}

/** Эллипс радиального градиента: стопы [доля радиуса, альфа]. */
function ellipseGlow(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  stops: [number, number][],
) {
  g.save()
  g.translate(cx, cy)
  g.scale(1, ry / rx)
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx)
  for (const [t, a] of stops) rg.addColorStop(t, 'rgba(' + color + ',' + a + ')')
  g.fillStyle = rg
  g.fillRect(-rx, -rx, rx * 2, rx * 2)
  g.restore()
}

/** Мир по окну: cover, точка feet — под ногами, без пустых краёв. */
export function placeWorld(W: number, H: number, iw: number, ih: number, b: Backdrop) {
  let s = Math.max(W / iw, H / ih) * 1.04
  // Пиксель-арт — только целый шаг пикселя, иначе «миксели».
  if (b.pixel) s = s >= 1 ? Math.ceil(s) : 1 / Math.floor(1 / s)
  const w = iw * s
  const h = ih * s
  const x = Math.round(Math.min(0, Math.max(W - w, W / 2 - b.feet.x * w)))
  const y = Math.round(Math.min(0, Math.max(H - h, H * FEET_AT - b.feet.y * h)))
  return { x, y, w, h }
}

/** Статичный фон целиком, в пикселях устройства. world может ещё грузиться. */
/**
 * Узор фона, как у лобби Brawl Stars (там — черепа и мячи): пиксельные
 * значки Minecraft 8×8 шахматным порядком, светлее фона на ~8%.
 * Строки — пиксели значка, '#' — закрашено.
 */
export const MOTIFS: string[][] = [
  // крипер
  ['########', '########', '##..##..', '##..##..', '###..###', '##....##', '##....##', '##.##.##'].map((r) => r.replace(/#/g, 'x').replace(/\./g, '#').replace(/x/g, '.')),
  // кирка
  ['.######.', '#......#', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...'],
  // меч
  ['......##', '.....###', '....###.', '#..###..', '.####...', '..##....', '.#.#....', '#.......'],
  // алмаз
  ['..####..', '.#....#.', '#......#', '.#....#.', '..#..#..', '...##...', '........', '........'],
  // сердце
  ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'],
  // блок травы
  ['########', '#.#.#.##', '########', '#......#', '#..#...#', '#.....##', '#...#..#', '########'],
]

export function paintScene(
  W: number,
  H: number,
  dpr: number,
  pal: Pal,
  _world: HTMLImageElement | null,
  _stage: boolean,
) {
  // Как лобби Brawl Stars (референс владельца 22:29): гладкий свет от яркого
  // центра за героем к насыщенному цвету по краям, без клеток и прожекторов,
  // плюс едва заметный узор фирменных значков — у нас пиксельные значки
  // Minecraft. Центр — светлый оттенок самого фона, не белый.
  const c = mk(W, H)
  const g = ctx2d(c)
  const cx = W / 2
  const cy = H * 0.5
  const R = Math.hypot(W, H) * 0.55
  // Воронка уже, чем лучи: к краю окна цвет успевает уйти в тёмный.
  const rg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.42)
  // Воронка: самый светлый центр за героем, дальше всё темнее к краям —
  // пространство отделяется, кнопки по краям читаются (владелец 24.09, 07:44).
  rg.addColorStop(0, pal.glowCore)
  rg.addColorStop(0.16, pal.glowCore)
  rg.addColorStop(0.4, pal.glowMid)
  rg.addColorStop(0.62, pal.glowEdge)
  rg.addColorStop(0.82, pal.glowDeep)
  rg.addColorStop(1, pal.glowVoid)
  g.fillStyle = rg
  g.fillRect(0, 0, W, H)

  // Лучи за героем, как в лобби Brawl Stars: широкие мягкие клинья света
  // из центра, гаснут к краям. Едва заметны — дают глубину, не рисунок.
  g.save()
  g.translate(cx, cy)
  const RAYS = 14
  for (let i = 0; i < RAYS; i++) {
    const a0 = (i / RAYS) * Math.PI * 2 + 0.11
    const a1 = a0 + (Math.PI / RAYS) * 0.9
    const rr = g.createRadialGradient(0, 0, R * 0.06, 0, 0, R * 0.78)
    rr.addColorStop(0, 'rgba(255,255,255,0.07)')
    rr.addColorStop(0.5, 'rgba(255,255,255,0.03)')
    rr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = rr
    g.beginPath()
    g.moveTo(0, 0)
    g.arc(0, 0, R, a0, a1)
    g.closePath()
    g.fill()
  }
  g.restore()

  // Редкие пиксельные квадраты разного размера вместо узора значков —
  // как на старом фоне (скрин владельца 24.09.2026). Раскладка постоянная.
  let seed = 1337
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const count = Math.round((W * H) / (dpr * dpr * 26000))
  for (let i = 0; i < count; i++) {
    const x = rnd() * W
    const y = rnd() * H
    const size = Math.round((10 + Math.floor(rnd() * 3) * 7) * dpr)
    const near = Math.max(0.4, 1 - Math.hypot(x - cx, y - cy) / (R * 1.1))
    g.fillStyle = 'rgba(255,255,255,' + ((0.05 + rnd() * 0.07) * near).toFixed(3) + ')'
    g.fillRect(Math.round(x), Math.round(y), size, size)
  }

  // Мягкая тень под ногами героя — стоит на «полу», а не висит.
  if (_stage) {
    // Световое пятно «сцены» под героем — светлее пола, как подиум в Brawl.
    ellipseGlow(g, cx, H * FEET_AT + 2 * dpr, W * 0.2, H * 0.05, '255,255,255', [
      [0, 0.16],
      [0.6, 0.07],
      [1, 0],
    ])
    ellipseGlow(g, cx, H * FEET_AT + 4 * dpr, W * 0.085, H * 0.02, '0,40,12', [
      [0, 0.38],
      [0.55, 0.2],
      [1, 0],
    ])
  }

  // Низ под кнопками темнее — как у всех лобби-референсов.
  const bg = g.createLinearGradient(0, H * 0.7, 0, H)
  bg.addColorStop(0, 'rgba(0,0,0,0)')
  bg.addColorStop(1, 'rgba(0,0,0,0.28)')
  g.fillStyle = bg
  g.fillRect(0, H * 0.7, W, H * 0.3)
  return c
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function toHexStr(r: number, g: number, b: number) {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b)
}
export function mix(a: string, b: string, k: number) {
  const x = hexRgb(a)
  const y = hexRgb(b)
  return toHexStr(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k)
}

/**
 * Сила прожекторов в точке (0–1): три луча от верхнего края к ногам героя
 * (50%, 70%). Ширина луча растёт от 5% ширины у источника до 22% у ног,
 * ярче у персонажа, к источнику гаснет.
 */
export function beamAt(px: number, py: number, W: number, H: number): number {
  const tx = W / 2
  const ty = H * FEET_AT
  if (py > ty + H * 0.04) return 0
  const srcs = [W * 0.14, W * 0.5, W * 0.86]
  let best = 0
  for (const sx of srcs) {
    const k = Math.max(0, Math.min(1, py / ty))
    const cx = sx + (tx - sx) * k
    const half = W * (0.025 + 0.085 * k)
    const dx = Math.abs(px - cx)
    if (dx > half) continue
    const edge = 1 - dx / half
    const v = (0.35 + 0.65 * k) * Math.min(1, edge * 2.5)
    best = Math.max(best, sx === W / 2 ? v * 0.8 : v)
  }
  return best
}

/** Общая сетка сцены и волны: клетка 36 px, привязана к центру персонажа. */
export function stageGrid(W: number, H: number, dpr: number) {
  const cell = Math.round(36 * dpr)
  const ox = ((((W / 2) % cell) + cell) % cell) - cell / 2
  const oy = ((((H * 0.48) % cell) + cell) % cell) - cell / 2
  return { cell, ox, oy }
}

/** Размер «пикселя» сцены в css px: закат целиком пиксель-артом (22:04). */
export const PIXEL = 8

/**
 * Пиксель-арт из готовой картинки: уменьшаем до клеток cell×cell (среднее
 * по клетке), сводим цвета к палитре по 9 ступеней на канал и растягиваем
 * обратно без сглаживания — жёсткие квадраты одного размера.
 */
export function pixelate(src: HTMLCanvasElement, cell: number): HTMLCanvasElement {
  const W = src.width
  const H = src.height
  const sw = Math.max(1, Math.ceil(W / cell))
  const sh = Math.max(1, Math.ceil(H / cell))
  const small = mk(sw, sh)
  const sg = ctx2d(small)
  sg.imageSmoothingEnabled = true
  sg.imageSmoothingQuality = 'high'
  // Сначала сильно размываем (владелец 22:05: «размой сильнее, чтобы идеально
  // как пиксель-арт»): без мелкого шума текстур остаются чистые пятна цвета.
  sg.filter = 'blur(' + Math.max(1, cell * 0.12).toFixed(1) + 'px)'
  sg.drawImage(src, 0, 0, sw, sh)
  sg.filter = 'none'
  const img = sg.getImageData(0, 0, sw, sh)
  const d = img.data
  const q = (v: number) => Math.round(v / 28.33) * 28.33
  for (let i = 0; i < d.length; i += 4) {
    d[i] = q(d[i])
    d[i + 1] = q(d[i + 1])
    d[i + 2] = q(d[i + 2])
  }
  sg.putImageData(img, 0, 0)
  const out = mk(W, H)
  const og = ctx2d(out)
  og.imageSmoothingEnabled = false
  og.drawImage(small, 0, 0, sw * cell, sh * cell)
  return out
}

/** Виньетка: центр чистый, края и углы темнее, низ под кнопками темнее всего. */
export function paintVignette(W: number, H: number, pal: Pal, _dpr = 1) {
  // Затемнение уже внутри пиксельной сцены — гладкая виньетка поверх
  // размыла бы пиксели. Пустой слой.
  void paintVignetteSmooth
  void pal
  return mk(W, H)
}

function paintVignetteSmooth(W: number, H: number, pal: Pal) {
  const c = mk(W, H)
  const g = ctx2d(c)
  const d = 'rgba(' + pal.dark + ','
  // За радиусом градиент держит последний стоп — углы тоже тёмные.
  ellipseGlow(g, W / 2, H * 0.58, W * 0.74, H * 0.84, pal.dark, [
    [0, 0],
    [0.42, 0],
    [0.66, 0.24],
    [0.86, 0.5],
    [1, 0.68],
  ])
  const bot = g.createLinearGradient(0, H * 0.76, 0, H)
  bot.addColorStop(0, d + '0)')
  bot.addColorStop(1, d + '0.55)')
  g.fillStyle = bot
  g.fillRect(0, H * 0.76, W, H * 0.24)
  const top = g.createLinearGradient(0, 0, 0, H * 0.16)
  top.addColorStop(0, d + '0.35)')
  top.addColorStop(1, d + '0)')
  g.fillStyle = top
  g.fillRect(0, 0, W, H * 0.16)
  return c
}
