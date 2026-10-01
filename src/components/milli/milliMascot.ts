/**
 * Милли — персонаж из логотипа Millida (владелец 30.09.2026 16:11: «персонаж с
 * ручками и ножками в стиле логотипа, очень милый и запоминающийся»).
 *
 * Тело — ровно знак из `public/millida-logo.svg`; к нему приделаны пиксельные
 * ручки в белых перчатках (белый — цвет скобки знака) и ножки в тёмных ботинках
 * (цвет глаз). Ручки и ножки лежат ПОД телом: их корень прячется за знаком, и
 * без конечностей Милли — всё тот же логотип.
 *
 * Геометрия — ровно знак из `public/millida-logo.svg` (поле 376×376, кубик со
 * срезанными углами и белая скобка), разложенный на части, чтобы лицо жило
 * отдельно: скобка — шлем, белый квадрат в центре — нос, глаза стоят в пустых
 * клетках по бокам от него, рот — в клетке под ним. Сетка знака — 5×5 клеток
 * по ~44,57 от 76,38 до 299,22; лицо не заходит на белые клетки, поэтому без глаз
 * Милли — тот же логотип, пиксель в пиксель.
 *
 * Тот же файл лежит в лаунчере (`src/components/milli/milliMascot.ts`): маскот
 * один на сайте и в приложении.
 */
/** `dance` — прежнее имя `happy`, оставлено для старых вызовов. */
export type MilliMode = 'idle' | 'talk' | 'think' | 'happy' | 'wave' | 'dance'

export interface MilliBox {
  x: number
  y: number
  w: number
  h: number
}

export const MILLI_VIEW = 376
/**
 * Поле персонажа: знак 376×376 плюс поля под ручки, ботинки и точки «думает».
 * Квадрат, чтобы `size` по-прежнему задавал и ширину, и высоту.
 */
export const MILLI_FRAME_BOX = { x: -84, y: -76, size: 544 } as const

/** Клетка сетки скобки: столбец и строка 0…4 → прямоугольник в координатах знака. */
export const MILLI_GRID = { x0: 76.38, step: 44.568 } as const
export function milliCell(col: number, row: number): MilliBox {
  const { x0, step } = MILLI_GRID
  return { x: x0 + col * step, y: x0 + row * step, w: step, h: step }
}

/** Белые клетки скобки: строка за строкой, 1 — белая. */
export const MILLI_GLYPH_CELLS: readonly (readonly number[])[] = [
  [1, 1, 1, 0, 1],
  [1, 0, 0, 1, 0],
  [1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
]

export const MILLI_TILE = 'M24 0H352V24H376V352H352V376H24V352H0V24H24Z'
/** Внутренний ободок толщиной 10 — тот же, что обводка знака с clip-path, но без id в DOM. */
export const MILLI_RIM = `${MILLI_TILE}M34 10V34H10V342H34V366H342V342H366V34H342V10Z`
export const MILLI_BEVEL = {
  top: { x: 24, y: 0, w: 328, h: 18 },
  left: { x: 0, y: 24, w: 18, h: 328 },
  right: { x: 358, y: 24, w: 18, h: 328 },
  bottom: 'M0 346H376V352H352V376H24V352H0Z',
} as const

/** Скобка без центрального квадрата: рама и ступенька. Квадрат-нос рисуется отдельно. */
export const MILLI_FRAME =
  'M210.071 120.946H120.949V254.654H254.641L254.642 165.517H299.209V254.654H299.222V299.222H76.3809V120.946H76.3672V76.3774H210.071V120.946Z'
export const MILLI_STEPS = 'M299.209 120.947H254.656V165.515H210.088V120.947H254.641V76.3784H299.209V120.947Z'
export const MILLI_NOSE: MilliBox = { x: 165.503, y: 165.516, w: 44.568, h: 44.568 }
/** Скобка в знаке поднята на 8 и отбрасывает тень со сдвигом 10. */
export const MILLI_GLYPH_LIFT = -8
export const MILLI_SHADOW_SHIFT = 10

function centered(cell: MilliBox, w: number, h: number, dy = 0): MilliBox {
  return { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2 + dy, w, h }
}

const LEFT = milliCell(1, 2)
const RIGHT = milliCell(3, 2)
const BELOW = milliCell(2, 3)

/**
 * Глаза в пиксельном аниме-стиле (владелец 30.09.2026 20:51: «большие красивые
 * аниме-глаза»): 42×56 на пиксельной сетке по 7 — выше клетки, вылезают вниз
 * в пустую клетку под собой (вверх нельзя: над правым глазом белая клетка); по бокам — белые клетки, туда глаз не
 * заходит. Тёмный зрачок в радужке из двух оттенков (светлый верх, тёмный низ),
 * большой блик слева сверху, маленький справа снизу, реснички у внешнего
 * верхнего угла.
 */
export const MILLI_EYE_SIZE = { w: 100, h: 124 } as const
export const MILLI_EYE_DY = 0
/**
 * Глаза на макушке (владелец 01.10.2026: «внятнее, в полтора-два раза больше,
 * кверху и по центру — половина выглядывает над телом, половина внутри»):
 * 100×124, по центру знака с зазором 14, середина глаза — на верхней кромке.
 * Логотип под ними не закрыт: скобка начинается ниже.
 */
const EYE_GAP = 14
const EYE_CX = MILLI_VIEW / 2
export const MILLI_EYES: readonly MilliBox[] = [
  { x: EYE_CX - EYE_GAP / 2 - MILLI_EYE_SIZE.w, y: -MILLI_EYE_SIZE.h / 2, w: MILLI_EYE_SIZE.w, h: MILLI_EYE_SIZE.h },
  { x: EYE_CX + EYE_GAP / 2, y: -MILLI_EYE_SIZE.h / 2, w: MILLI_EYE_SIZE.w, h: MILLI_EYE_SIZE.h },
]
/** Большой блик — у верхнего левого края радужки. */
export const MILLI_GLINT = { dx: 17, dy: 24, size: 31 } as const
/** Второй, маленький блик — внизу справа. */
export const MILLI_GLINT2 = { dx: 66, dy: 83, size: 16 } as const
/** Радужка: от 33 до 117 по высоте глаза, с отступом 16 по бокам; верхняя половина светлее. */
export const MILLI_IRIS = { inset: 16, top: 33, bottom: 117 } as const
/** Зрачок — тёмный блок в середине радужки. */
export const MILLI_PUPIL = { dx: 34, dy: 51, w: 32, h: 48 } as const
/**
 * Реснички: два пикселя у верхнего внешнего угла, торчат за край глаза на
 * белую клетку (ink на белом читается). side: -1 — левый глаз (наружу влево), 1 — правый.
 */
export function milliLashes(eye: MilliBox, side: -1 | 1): MilliBox[] {
  const w = 10
  const x = side < 0 ? eye.x - w : eye.x + eye.w
  return [
    { x, y: eye.y + 10, w, h: 10 },
    { x: side < 0 ? x - 8 : x + 8, y: eye.y - 2, w: 10, h: 10 },
    { x: side < 0 ? x - 14 : x + 14, y: eye.y - 12, w: 9, h: 9 },
  ]
}
export const MILLI_CHEEKS: readonly MilliBox[] = [
  { x: LEFT.x + (LEFT.w - 26) / 2, y: BELOW.y + 4, w: 26, h: 9 },
  { x: RIGHT.x + (RIGHT.w - 26) / 2, y: BELOW.y + 4, w: 26, h: 9 },
]
/**
 * Росток на макушке (запоминающаяся деталь): стебель растёт из-под тела, два
 * листика ступеньками — правый выше. Рисуется ДО тела, корень спрятан.
 */
export const MILLI_SPROUT = {
  stem: { x: 340, y: -10, w: 8, h: 26 } as MilliBox,
  leafR: { x: 348, y: -26, w: 24, h: 16 } as MilliBox,
  leafL: { x: 318, y: -16, w: 22, h: 14 } as MilliBox,
} as const
export const MILLI_MOUTH_SHUT: MilliBox = centered(BELOW, 24, 8, -8)
export const MILLI_MOUTH_OPEN: MilliBox = centered(BELOW, 30, 24, -2)
export const MILLI_TONGUE: MilliBox = {
  x: MILLI_MOUTH_OPEN.x + 7,
  y: MILLI_MOUTH_OPEN.y + MILLI_MOUTH_OPEN.h - 10,
  w: 16,
  h: 10,
}

/** Счастливые глаза «^» из пикселей по 8: вершина и два плеча, шире глаза не выходят за клетку. */
export function milliJoy(eye: MilliBox): MilliBox[] {
  const cx = eye.x + eye.w / 2
  const p = 8
  const top = eye.y + (eye.h - 3 * p) / 2
  return [
    { x: cx - p / 2, y: top, w: p, h: p },
    { x: cx - p / 2 - p, y: top + p, w: p, h: p },
    { x: cx + p / 2, y: top + p, w: p, h: p },
    { x: cx - p / 2 - 2 * p, y: top + 2 * p, w: p, h: p },
    { x: cx + p / 2 + p, y: top + 2 * p, w: p, h: p },
  ]
}

/** Точки «думает» над правым верхним углом. */
export const MILLI_DOTS: readonly MilliBox[] = [
  { x: 300, y: -40, w: 20, h: 20 },
  { x: 332, y: -56, w: 20, h: 20 },
  { x: 364, y: -40, w: 20, h: 20 },
]

/**
 * Конечности. Корни (плечо, бедро) уходят под тело на 8–46 единиц: при любом
 * повороте ручки и при подскоке тела шва не видно.
 *
 * Плечо — y = 232, на уровне глаз: ручки растут из «щёк» знака, как у
 * игрушки-кубика. Поворот ручки — вокруг плеча (CSS: `transform-box: fill-box`,
 * `transform-origin` на внутреннем крае группы, см. `MILLI_SHOULDER_Y_PCT`).
 */
export interface MilliArm {
  arm: MilliBox
  hand: MilliBox
  /** Большой палец варежки — сверху, со стороны тела: без него белый квадрат не читается рукой. */
  thumb: MilliBox
}

export const MILLI_SHOULDER_Y = 238
const ARM = { w: 44, h: 40 } as const
const HAND = 54

function arm(side: 'l' | 'r'): MilliArm {
  // Короткая толстая ручка: 30 единиц торчит из тела, остальное — под ним.
  const armBox: MilliBox =
    side === 'l'
      ? { x: -30, y: MILLI_SHOULDER_Y - ARM.h / 2, w: ARM.w, h: ARM.h }
      : { x: MILLI_VIEW - 14, y: MILLI_SHOULDER_Y - ARM.h / 2, w: ARM.w, h: ARM.h }
  const hand: MilliBox =
    side === 'l'
      ? { x: armBox.x - HAND + 12, y: MILLI_SHOULDER_Y - HAND / 2, w: HAND, h: HAND }
      : { x: armBox.x + armBox.w - 12, y: MILLI_SHOULDER_Y - HAND / 2, w: HAND, h: HAND }
  const thumb: MilliBox =
    side === 'l' ? { x: hand.x + hand.w - 22, y: hand.y - 14, w: 18, h: 18 } : { x: hand.x + 4, y: hand.y - 14, w: 18, h: 18 }
  return { arm: armBox, hand, thumb }
}

export const MILLI_ARMS: { l: MilliArm; r: MilliArm } = { l: arm('l'), r: arm('r') }

/** Где в рамке группы ручки стоит плечо, по вертикали, в процентах (для transform-origin). */
export const MILLI_SHOULDER_Y_PCT = Math.round(
  ((MILLI_SHOULDER_Y - MILLI_ARMS.l.hand.y) / MILLI_ARMS.l.hand.h) * 100,
)

export interface MilliLeg {
  leg: MilliBox
  /** Белый кед, как перчатка; тёмная подошва — цвета глаз. */
  boot: MilliBox
  sole: MilliBox
}

function leg(x: number): MilliLeg {
  const legBox: MilliBox = { x, y: 330, w: 56, h: 84 }
  const boot: MilliBox = { x: x - 14, y: 400, w: 84, h: 42 }
  return { leg: legBox, boot, sole: { x: boot.x + 4, y: boot.y + boot.h - 12, w: boot.w - 8, h: 12 } }
}

/** Ножки стоят под белыми клетками низа скобки — симметрично относительно носа. */
export const MILLI_LEGS: readonly MilliLeg[] = [leg(98), leg(MILLI_VIEW - 98 - 56)]

/** Контур спрайта: та же фигура, раздутая на `by` во все стороны. */
export function milliGrow(b: MilliBox, by: number): MilliBox {
  return { x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 }
}

/** Прямоугольник со срезанными на `n` углами — пиксельная «перчатка» и «ботинок». */
export function milliCut(b: MilliBox, n = 8): string {
  const { x, y, w, h } = b
  return `M${x + n} ${y}H${x + w - n}V${y + n}H${x + w}V${y + h - n}H${x + w - n}V${y + h}H${x + n}V${y + h - n}H${x}V${y + n}H${x + n}Z`
}

/** Всё, что рисуется, — внутри поля персонажа (проверяется тестом). */
export function milliExtent(): MilliBox {
  const parts: MilliBox[] = [
    { x: 0, y: 0, w: MILLI_VIEW, h: MILLI_VIEW },
    ...Object.values(MILLI_ARMS).flatMap((a) => [a.arm, a.hand]),
    ...MILLI_LEGS.flatMap((l) => [l.leg, l.boot]),
    ...MILLI_DOTS,
    MILLI_SPROUT.stem,
    MILLI_SPROUT.leafR,
    MILLI_SPROUT.leafL,
  ]
  const x = Math.min(...parts.map((p) => p.x))
  const y = Math.min(...parts.map((p) => p.y))
  const x2 = Math.max(...parts.map((p) => p.x + p.w))
  const y2 = Math.max(...parts.map((p) => p.y + p.h))
  return { x, y, w: x2 - x, h: y2 - y }
}
