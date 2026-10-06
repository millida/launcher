import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  MILLI_ACTS,
  MILLI_EMOTE,
  MILLI_EMOTIONS,
  emotionFor,
  milliComboReaction,
  milliDragOffset,
  milliEmote,
  milliEmoteSubscribe,
  milliEmotionName,
  milliEyeRows,
  milliToneOf,
  milliTypingLevel,
} from './milliEmotions'

const css = readFileSync(new URL('../../styles/pixel/milli-emotions.css', import.meta.url), 'utf8')
const base = readFileSync(new URL('../../styles/pixel/milli-mascot.css', import.meta.url), 'utf8')

describe('Милли — эмоции', () => {
  it('эмоций не меньше 16, у каждой есть кадры в CSS', () => {
    expect(MILLI_EMOTIONS.length).toBeGreaterThanOrEqual(16)
    for (const e of [...MILLI_EMOTIONS, ...MILLI_ACTS]) expect(css.includes('.mm-s-' + e) || base.includes('.mm-s-' + e), e).toBe(true)
  })

  it('ключи определены, движение — только steps()', () => {
    const defined = new Set([...(css + base).matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]))
    for (const m of css.matchAll(/animation(?:-name)?:\s*([a-z][\w-]*)/g)) if (m[1] !== 'none') expect(defined.has(m[1]), m[1]).toBe(true)
    for (const m of css.matchAll(/animation:\s*[\w-]+\s+[\d.]+m?s\s+([\w-]+)/g)) expect(m[1]).toBe('steps')
    expect(/@keyframes[^}]*var\(/.test(css)).toBe(false)
  })

  it('главный ключ каждой одноразовой эмоции длится ровно её цикл', () => {
    for (const [name, def] of Object.entries(MILLI_EMOTE)) {
      if (def.loop || name === 'sleep') continue
      const rx = new RegExp('\\.mm-s-' + name + ' \\.[\\w-]+ \\{ animation: [\\w-]+ ([\\d.]+)s steps\\(1, end\\) both')
      const m = rx.exec(css)
      expect(m, name).not.toBeNull()
      expect(Math.round(Number(m?.[1]) * 1000), name).toBe(def.cycle)
    }
  })

  it('emotionFor: вылет → сочувствие, починила → гордость, сборка → танец, конфликт → ой-ой', () => {
    expect(emotionFor({ intent: 'crash', outcome: 'crash' })).toBe('sad')
    expect(emotionFor({ intent: 'crash', outcome: 'fixed' })).toBe('proud')
    expect(emotionFor({ intent: 'build', outcome: 'ok' })).toBe('disco')
    expect(emotionFor({ intent: 'update', outcome: 'conflict' })).toBe('worry')
    expect(emotionFor({ intent: 'backup', outcome: 'pending' })).toBe('save')
    expect(emotionFor({ intent: 'rollback', outcome: 'pending' })).toBe('rewind')
    expect(emotionFor({ intent: 'graphics', outcome: 'pending' })).toBe('paint')
    expect(emotionFor({ intent: 'doctor', outcome: 'pending' })).toBe('search')
    expect(emotionFor({ tone: 'thanks' })).toBe('love')
    expect(emotionFor({})).toBeNull()
  })

  it('тон игрока', () => {
    expect(milliToneOf('спасибо!')).toBe('thanks')
    expect(milliToneOf('опять не запускается, бесит')).toBe('angry')
    expect(milliToneOf('игра вылетает')).toBe('sad')
    expect(milliToneOf('ахаха лол')).toBe('joke')
    expect(milliToneOf('как поставить шейдеры?')).toBe('question')
    expect(milliToneOf('вау круто')).toBe('excited')
    expect(milliToneOf('сделай сборку')).toBe('neutral')
  })

  it('чужие имена переводятся', () => {
    expect(milliEmotionName('scan')).toBe('search')
    expect(milliEmotionName('work')).toBe('fix')
    expect(milliEmotionName('nope')).toBeNull()
  })

  it('шина: hold держит до stop()', () => {
    const got: [string, number][] = []
    let stopped = 0
    const off = milliEmoteSubscribe(
      (n, ms) => got.push([n, ms]),
      () => stopped++,
    )
    milliEmote('proud')
    const stop = milliEmote('tuning', { hold: true })
    stop()
    off()
    expect(got).toEqual([
      ['proud', MILLI_EMOTE.proud.ms],
      ['paint', Infinity],
    ])
    expect(stopped).toBe(1)
  })

  it('взаимодействия: комбо, резинка, печать', () => {
    expect([1, 3, 4, 5, 6].map(milliComboReaction)).toEqual(['poke', 'poke', 'grumpy', 'grumpy', 'dizzy'])
    expect(Math.abs(milliDragOffset(1000))).toBeLessThanOrEqual(28)
    expect(milliDragOffset(-1000)).toBeLessThan(0)
    expect(milliTypingLevel([], 1000)).toBe(0)
    expect(milliTypingLevel([0, 100, 200, 300, 400, 500, 600, 700], 800)).toBe(2)
    expect(milliTypingLevel([0, 600], 1000)).toBe(1)
  })

  it('глазные картинки: правый глаз — зеркало, полноразмерные в пределах глаза', () => {
    const l = milliEyeRows('angry', -1)
    const r = milliEyeRows('angry', 1)
    expect(r.rows[4]).toBe(l.rows[4]!.split('').reverse().join(''))
    for (const k of ['star', 'heart', 'blank', 'spiral'] as const) {
      const e = milliEyeRows(k, -1)
      expect(e.rows.every((row) => row.length === 10), k).toBe(true)
    }
  })
})
