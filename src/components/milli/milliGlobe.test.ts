import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CHUNK_MS,
  MILLI_THINK_STEPS,
  MilliSendGlobe,
  MilliWorldLoading,
  SEND_ARROW,
  WORLD_MAP,
  WORLD_SPIRAL,
  milliChunkAt,
  milliThinkStep,
  milliWorldPercent,
} from './MilliGlobe'

describe('send arrow art', () => {
  it('is a symmetric 9×10 up-arrow: stepped 45° head, 3px shaft', () => {
    expect(SEND_ARROW.length).toBe(10)
    for (const row of SEND_ARROW) {
      expect(row.length).toBe(9)
      expect(row).toBe([...row].reverse().join(''))
    }
    expect(SEND_ARROW.slice(0, 5).map((r) => r.split('#').length - 1)).toEqual([1, 3, 5, 7, 9])
    expect(SEND_ARROW.slice(5).every((r) => r === '...###...')).toBe(true)
  })
})

describe('world loading', () => {
  it('percent eases toward 95 and never passes it', () => {
    expect(milliWorldPercent(0)).toBe(0)
    let prev = -1
    for (let t = 0; t <= 120_000; t += 500) {
      const p = milliWorldPercent(t)
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeLessThan(95)
      prev = p
    }
    expect(milliWorldPercent(15_000)).toBeGreaterThan(60)
    expect(milliWorldPercent(40_000)).toBeGreaterThan(85)
  })

  it('spiral covers every chunk once, starting at the centre', () => {
    expect(WORLD_MAP.length).toBe(13)
    expect(WORLD_MAP.every((r) => r.length === 13)).toBe(true)
    expect(new Set(WORLD_SPIRAL).size).toBe(169)
    expect(WORLD_SPIRAL[0]).toBe(6 * 13 + 6)
  })

  it('chunk times grow along the spiral; the last ones wait for the cap', () => {
    let prev = -Infinity
    for (let k = 0; k < 169; k++) {
      const t = milliChunkAt(k)
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
    expect(milliChunkAt(168)).toBe(Infinity)
    expect(Number.isFinite(milliChunkAt(150))).toBe(true)
    // A chunk is done exactly when the percent passes its share.
    const t = milliChunkAt(80)
    expect(milliWorldPercent(t + 1)).toBeGreaterThanOrEqual((81 / 169) * 100 - 0.01)
    expect(CHUNK_MS).toBeGreaterThan(0)
  })

  it('steps follow the server pipeline', () => {
    expect(milliThinkStep(0)).toBe(MILLI_THINK_STEPS[0]![1])
    expect(milliThinkStep(5_000)).toBe('Ищу моды на Modrinth…')
    expect(milliThinkStep(60_000)).toBe(MILLI_THINK_STEPS[4]![1])
  })

  it('renders the step in a live region, no positioning that could cover the scene', () => {
    const html = renderToStaticMarkup(createElement(MilliWorldLoading, { step: 'Ищу моды на Modrinth…', elapsedMs: 8_000 }))
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Ищу моды на Modrinth…')
    expect(html).toContain('aria-valuenow="43"')
    expect((html.match(/class="mwl-c /g) ?? []).length).toBe(169)
  })
})

describe('send button', () => {
  it('idle: a real submit button that keeps the analytics attributes', () => {
    const html = renderToStaticMarkup(createElement(MilliSendGlobe, { disabled: true, 'aria-label': 'Отправить', 'data-track': 'milli_send' }))
    expect(html).toContain('type="submit"')
    expect(html).toContain('aria-label="Отправить"')
    expect(html).toContain('data-track="milli_send"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('btn md mgl primary')
  })

  it('pending: an enabled red stop button', () => {
    const html = renderToStaticMarkup(createElement(MilliSendGlobe, { pending: true, disabled: true, onStop: () => {} }))
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="Остановить"')
    expect(html).toContain('data-track="milli_cancel"')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('btn md mgl stop is-stop')
  })
})
