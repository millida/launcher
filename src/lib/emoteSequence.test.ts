import { describe, expect, it } from 'bun:test'
import type { AnimationClip } from './cosmeticAnimation'
import { emoteSequence } from './emoteSequence'

/**
 * Which clip an emote plays when. The same table as the mod's
 * EmoteSequenceTest: the fitting room and the game must agree.
 *
 * the catalogue chose   the file also has          plays                      pinned by
 * the wind-up           a looping "loop"           wind-up, then the loop     75 of 98 emotes ended on their wind-up
 * the loop              a "start", even looping    the start, then the loop   "67" skipped its opening
 * a one-shot            nothing else               it alone                   "Bow"
 * the wind-up           "loop" and "bkp" loops     the "loop", never "bkp"    "Bunny hop" keeps a spare loop
 * the loop              a clip named "express"     the loop alone             "pre" is a word, not a substring
 */
const clip = (name: string, length: number, endless: boolean): AnimationClip => ({
  name,
  length,
  loop: true,
  endless,
  bones: {},
})
const file = (...clips: AnimationClip[]) => Object.fromEntries(clips.map((c) => [c.name, c]))

describe('an emote plays its clips in the order Essential does', () => {
  it('a wind-up is followed by its loop', () => {
    const pre = clip('animation.steve.rollerskating_pre', 1.5, false)
    const loop = clip('animation.steve.rollerskating_loop', 18, true)
    const seq = emoteSequence(file(pre, loop), pre)!
    expect(seq.clipAt(1), 'первые полторы секунды - вступление').toBe(pre)
    expect(seq.clipAt(2), 'после вступления катание, а не конец эмоции').toBe(loop)
    expect(seq.timeAt(2), 'петля начинается с начала').toBeCloseTo(0.5, 5)
  })

  it('a chosen loop still opens with its start, even a looping one', () => {
    const loop = clip('animation.67_loop', 0.83, true)
    const start = clip('animation.67_start', 2, true)
    const seq = emoteSequence(file(loop, start), loop)!
    expect(seq.clipAt(0.5), 'у «67» цифры появляются во вступлении').toBe(start)
    expect(seq.clipAt(2.5), 'потом цифры качаются в петле').toBe(loop)
  })

  it('a one-shot plays alone', () => {
    const bow = clip('animation.steve.bow', 2.25, false)
    const seq = emoteSequence(file(bow), bow)!
    expect(seq.intro).toBeNull()
    expect(seq.clipAt(1)).toBe(bow)
  })

  it('a backup loop is never played', () => {
    const start = clip('animation.steve.start', 2, false)
    const spare = clip('animation.steve.bunny_hop_bkp', 5.8, true)
    const loop = clip('animation.steve.loop', 0.5, true)
    const seq = emoteSequence(file(start, spare, loop), start)!
    expect(seq.clipAt(3), 'запасной клип художника - не часть эмоции').toBe(loop)
  })

  it('pre is a word, not a part of one', () => {
    const loop = clip('animation.steve.dance_loop', 1, true)
    const other = clip('animation.steve.express', 3, false)
    const seq = emoteSequence(file(loop, other), loop)!
    expect(seq.intro, '«express» не вступление').toBeNull()
  })
})
