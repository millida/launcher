import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { MILLI_EVENTS, MILLI_EVENT_KINDS, MILLI_RARE_CHANCE, milliEventDelay, milliPickEvent } from './milliEventData'

describe('события сцены Милли', () => {
  it('никогда не повторяет прошлое событие', () => {
    for (const prev of MILLI_EVENT_KINDS) {
      for (let i = 0; i <= 20; i++) {
        expect(milliPickEvent(prev, i / 20, 0.5)).not.toBe(prev)
        expect(milliPickEvent(prev, i / 20, 0)).not.toBe(prev)
      }
    }
  })

  it('редкое — только при малом r2, обычные — все достижимы', () => {
    expect(MILLI_EVENTS[milliPickEvent(null, 0.5, MILLI_RARE_CHANCE / 2)].rare).toBe(true)
    const seen = new Set(Array.from({ length: 100 }, (_, i) => milliPickEvent(null, i / 100, 0.9)))
    expect(seen.size).toBe(MILLI_EVENT_KINDS.filter((k) => !MILLI_EVENTS[k].rare).length)
    for (const k of seen) expect(MILLI_EVENTS[k].rare).toBeFalsy()
  })

  it('первое — через 2,5–4 с, дальше — 40–90 с', () => {
    expect(milliEventDelay(true, 0)).toBe(2500)
    expect(milliEventDelay(true, 1)).toBe(4000)
    expect(milliEventDelay(false, 0)).toBe(40_000)
    expect(milliEventDelay(false, 1)).toBe(90_000)
  })

  it('спрайты: кадры одного размера, все цвета в палитре, «ух ты» внутри события', () => {
    for (const k of MILLI_EVENT_KINDS) {
      const d = MILLI_EVENTS[k]
      const [f0] = d.frames
      expect(f0, k).toBeDefined()
      for (const f of d.frames) {
        expect(f.length, k).toBe(f0!.length)
        for (const row of f) {
          expect(row.length, k).toBe(f0![0]!.length)
          for (const ch of row) if (ch !== '.') expect(d.palette[ch], k + ':' + ch).toBeDefined()
        }
      }
      expect(d.wow).toBeGreaterThan(0)
      expect(d.wow).toBeLessThan(0.6)
    }
  })

  it('длина события = длина его траектории в CSS', () => {
    const css = readFileSync(new URL('../../styles/pixel/milli-events.css', import.meta.url), 'utf8')
    for (const k of MILLI_EVENT_KINDS) {
      const m = new RegExp(`\\.mev-${k} \\.mev-[xy] \\{ animation: [\\w-]+ ([\\d.]+)s`).exec(css)
      expect(m, k).not.toBeNull()
      expect(Math.round(Number(m![1]) * 1000), k).toBe(MILLI_EVENTS[k].ms)
    }
  })
})
