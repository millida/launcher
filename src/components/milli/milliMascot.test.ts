import { describe, expect, it } from 'bun:test'
import {
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
  MILLI_NOSE,
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
