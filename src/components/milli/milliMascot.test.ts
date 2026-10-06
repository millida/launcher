import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  MILLI_CUE_MS,
  MILLI_EYE_ART_TOP,
  MILLI_MOUTHS,
  milliBlinkPlan,
  milliEyeArt,
  milliGaze,
  milliGazeOffsets,
  milliLeanAngle,
  milliLeanStep,
  milliMirror,
  milliMouthBox,
  milliPixels,
  milliPoke,
  milliState,
  type MilliCue,
  type MilliMouth,
  MILLI_ARMS,
  MILLI_CHEEKS,
  MILLI_FRAME_BOX,
  MILLI_LEGS,
  MILLI_SHOULDER_Y_PCT,
  MILLI_VIEW,
  milliExtent,
  MILLI_EYES,
  MILLI_GLYPH_CELLS,
  MILLI_MOUTH_OPEN,
  MILLI_MOUTH_SHUT,
  MILLI_IRIS,
  MILLI_NOSE,
  MILLI_PUPIL,
  MILLI_TONGUE,
  milliCell,
  type MilliBox,
} from './milliMascot'

const inside = (a: MilliBox, b: MilliBox) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
const overlaps = (a: MilliBox, b: MilliBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const whiteCells: MilliBox[] = MILLI_GLYPH_CELLS.flatMap((row, r) =>
  row.flatMap((v, c) => (v ? [milliCell(c, r)] : [])),
)

describe('маскот Милли — логотип с лицом', () => {
  it('центральный квадрат знака — клетка (2,2) сетки', () => {
    const c = milliCell(2, 2)
    expect(Math.abs(c.x - MILLI_NOSE.x)).toBeLessThan(0.5)
    expect(Math.abs(c.y - MILLI_NOSE.y)).toBeLessThan(0.5)
  })

  it('рот и щёки не заходят на белые клетки; глаза — большие наклейки поверх скобки (владелец 30.09.2026, 21:22)', () => {
    const face = [...MILLI_CHEEKS, MILLI_MOUTH_SHUT, MILLI_MOUTH_OPEN, MILLI_TONGUE]
    for (const e of MILLI_EYES) expect(overlaps(e, MILLI_NOSE)).toBe(false)
    for (const part of face) {
      for (const cell of whiteCells) expect(overlaps(part, cell), JSON.stringify(part)).toBe(false)
    }
  })

  it('глаза симметричны относительно носа, рот под носом', () => {
    const nose = MILLI_NOSE.x + MILLI_NOSE.w / 2
    const [l, r] = MILLI_EYES as [MilliBox, MilliBox]
    expect(Math.abs(nose - (l.x + l.w / 2) - (r.x + r.w / 2 - nose))).toBeLessThan(0.5)
    expect(l.y).toBe(r.y)
    expect(Math.abs(MILLI_MOUTH_OPEN.x + MILLI_MOUTH_OPEN.w / 2 - nose)).toBeLessThan(0.5)
    expect(MILLI_MOUTH_OPEN.y).toBeGreaterThan(MILLI_NOSE.y + MILLI_NOSE.h)
  })

  it('язык внутри открытого рта', () => {
    expect(inside(MILLI_TONGUE, MILLI_MOUTH_OPEN)).toBe(true)
  })
})

describe('Милли — персонаж: ручки и ножки', () => {
  it('всё нарисованное влезает в поле персонажа', () => {
    const e = milliExtent()
    const f = { x: MILLI_FRAME_BOX.x, y: MILLI_FRAME_BOX.y, w: MILLI_FRAME_BOX.size, h: MILLI_FRAME_BOX.size }
    expect(inside(e, f)).toBe(true)
  })

  it('корни ручек и ножек спрятаны под телом — шва нет', () => {
    const body = { x: 0, y: 0, w: MILLI_VIEW, h: MILLI_VIEW }
    expect(overlaps(MILLI_ARMS.l.arm, body)).toBe(true)
    expect(overlaps(MILLI_ARMS.r.arm, body)).toBe(true)
    for (const l of MILLI_LEGS) expect(l.leg.y).toBeLessThan(MILLI_VIEW - 20)
  })

  it('ручки и ножки зеркальны относительно центра знака', () => {
    const c = MILLI_VIEW / 2
    const { l, r } = MILLI_ARMS
    expect(Math.abs(c - (l.hand.x + l.hand.w / 2) - (r.hand.x + r.hand.w / 2 - c))).toBeLessThan(0.5)
    const [a, b] = MILLI_LEGS as [(typeof MILLI_LEGS)[number], (typeof MILLI_LEGS)[number]]
    expect(Math.abs(c - (a.boot.x + a.boot.w / 2) - (b.boot.x + b.boot.w / 2 - c))).toBeLessThan(0.5)
  })

  it('плечо — середина группы ручки (CSS transform-origin 50%)', () => {
    expect(MILLI_SHOULDER_Y_PCT).toBe(50)
  })
})

describe('Милли — кадры лица', () => {
  it('все рты лежат в пустой клетке под носом и не задевают белые клетки', () => {
    for (const k of Object.keys(MILLI_MOUTHS) as MilliMouth[]) {
      const b = milliMouthBox(k)
      expect(inside(b, milliCell(2, 3)), k).toBe(true)
      for (const cell of whiteCells) expect(overlaps(b, cell), k).toBe(false)
    }
  })

  it('закрытые глаза рисуются на теле (ниже кромки), а не на фоне над ним', () => {
    for (const k of Object.keys(MILLI_EYE_ART_TOP) as (keyof typeof MILLI_EYE_ART_TOP)[]) {
      for (const [i, e] of MILLI_EYES.entries()) {
        const d = milliEyeArt(k, e, i ? 1 : -1)
        expect(d.length).toBeGreaterThan(0)
        const ys = [...d.matchAll(/M[-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1]))
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('«><» правого глаза — зеркало левого относительно центра', () => {
    const [l, r] = MILLI_EYES as [MilliBox, MilliBox]
    const runs = (d: string) => [...d.matchAll(/M([-\d.]+) [-\d.]+h([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[1]) + Number(m[2])] as const)
    const c = MILLI_VIEW / 2
    const lx = Math.min(...runs(milliEyeArt('squeeze', l, -1)).map((r) => r[0]))
    const rx = Math.max(...runs(milliEyeArt('squeeze', r, 1)).map((r) => r[1]))
    expect(Math.abs(c - lx - (rx - c))).toBeLessThan(0.5)
  })
})

describe('Милли — пиксельные картинки', () => {
  it('соседние клетки строки сливаются, цвета — отдельные path', () => {
    const p = milliPixels(['XX.Y', '.XXX'], 10, 5, 0)
    expect(p.X).toBe('M5 0h20v10h-20zM15 10h30v10h-30z')
    expect(p.Y).toBe('M35 0h10v10h-10z')
  })

  it('зеркало выравнивает строки по ширине', () => {
    expect(milliMirror(['AB', 'C'])).toEqual(['BA', '.C'])
  })
})

describe('Милли — поведение', () => {
  it('тыки идут по кругу из трёх реакций', () => {
    expect([0, 1, 2, 3, 4, -1].map(milliPoke)).toEqual(['poke1', 'poke2', 'poke3', 'poke1', 'poke2', 'poke3'])
  })

  it('реакция важнее режима; засыпает только в покое; dance = happy', () => {
    expect(milliState('talk', 'spin', false)).toBe('spin')
    expect(milliState('idle', null, true)).toBe('sleep')
    expect(milliState('think', null, true)).toBe('think')
    expect(milliState('dance', null, false)).toBe('happy')
  })

  it('взгляд: рядом — прямо, далеко — до упора, шаг не больше 2 пикселей', () => {
    expect(milliGaze(5, 5, 100)).toEqual({ x: 0, y: 0 })
    expect(milliGaze(100, 0, 100)).toEqual({ x: 1, y: 0 })
    expect(milliGaze(1000, 0, 100)).toEqual({ x: 2, y: 0 })
    expect(milliGaze(-1000, -1000, 100)).toEqual({ x: -1, y: -1 })
    expect(milliGaze(0, 900, 60)).toEqual({ x: 0, y: 2 })
    expect(milliGaze(NaN, 1, 60)).toEqual({ x: 0, y: 0 })
    for (const dx of [-5000, -300, 0, 300, 5000]) {
      for (const dy of [-5000, -40, 0, 40, 5000]) {
        const g = milliGaze(dx, dy, 80)
        expect(Math.abs(g.x)).toBeLessThanOrEqual(2)
        expect(Math.abs(g.y)).toBeLessThanOrEqual(2)
      }
    }
  })

  it('зрачок двигается на пиксель за шаг и не выходит из радужки; лицо — только при шаге 2', () => {
    const o = milliGazeOffsets({ x: 2, y: -1 })
    expect(o.pupil).toEqual({ x: 16, y: -8 })
    expect(o.face).toEqual({ x: 8, y: 0 })
    expect(MILLI_PUPIL.dx - MILLI_IRIS.inset).toBeGreaterThanOrEqual(16)
  })

  it('наклон к элементу: 0 / 3 / 6 градусов и шагами по 3', () => {
    expect(milliLeanAngle(10, 100)).toBe(0)
    expect(milliLeanAngle(120, 100)).toBe(3)
    expect(milliLeanAngle(-900, 100)).toBe(-6)
    expect(milliLeanStep(0, 6)).toBe(3)
    expect(milliLeanStep(3, 6)).toBe(6)
    expect(milliLeanStep(6, -6)).toBe(3)
    expect(milliLeanStep(3, 3)).toBe(3)
  })

  it('моргание: 2,4–6,8 с, двойное — иногда', () => {
    expect(milliBlinkPlan(0, 0.5)).toEqual({ wait: 2400, double: false })
    expect(milliBlinkPlan(1, 0.1)).toEqual({ wait: 6800, double: true })
  })
})

describe('Милли — CSS-кадры', () => {
  const css = readFileSync(new URL('../../styles/pixel/milli-mascot.css', import.meta.url), 'utf8')

  it('длина каждой реакции в JS совпадает с длиной её ключей в CSS', () => {
    const main: Record<MilliCue, string> = {
      hop: '.mm-s-hop:not(.milli-hop) .mm-jump',
      spin: '.mm-s-spin .mm-jump',
      poke1: '.mm-s-poke1 .mm-jump',
      poke2: '.mm-s-poke2 .mm-jump',
      poke3: '.mm-s-poke3 .mm-jump',
      wake: '.mm-s-wake .mm-jump',
      wow: '.mm-s-wow .mm-jump',
    }
    for (const [cue, sel] of Object.entries(main) as [MilliCue, string][]) {
      const at = css.indexOf(sel)
      expect(at, sel).toBeGreaterThan(-1)
      const rule = css.slice(at, css.indexOf('}', at))
      const sec = Number(/(?:animation:\s*[\w-]+|animation-duration:)\s*([\d.]+)s/.exec(rule)?.[1])
      expect(Math.round(sec * 1000), cue).toBe(MILLI_CUE_MS[cue])
    }
  })

  it('все используемые ключи определены, движение — только steps()', () => {
    const defined = new Set([...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]))
    const used = [...css.matchAll(/animation(?:-name)?:\s*([a-z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'none')
    for (const n of used) expect(defined.has(n), n).toBe(true)
    for (const m of css.matchAll(/animation:\s*[\w-]+\s+[\d.]+m?s\s+([\w-]+)/g)) expect(m[1]).toBe('steps')
  })
})
