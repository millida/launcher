import { describe, expect, it } from 'bun:test'
import { answerOr, lookStages, type Wait } from './lobbyLook'

function clock() {
  const timers: { ms: number; fire: () => void }[] = []
  const wait: Wait = (ms) => new Promise((ok) => timers.push({ ms, fire: ok }))
  const pass = async (ms: number) => {
    for (const t of timers.filter((x) => x.ms <= ms)) t.fire()
    await new Promise((ok) => setTimeout(ok, 0))
  }
  return { wait, pass }
}

function later<T>() {
  let give!: (v: T) => void
  const promise = new Promise<T>((ok) => (give = ok))
  return { promise, give }
}

const settledValue = async <T>(p: Promise<T>) => {
  let out: { v: T } | null = null
  void p.then((v) => (out = { v }))
  await new Promise((ok) => setTimeout(ok, 0))
  return out as { v: T } | null
}

/**
 * How long the home figure waits for the wardrobe.
 *
 * case                                  verdict                                  pinned by
 * wardrobe answers in time              the wardrobe skin, no stand-in asked     a fast answer must not flash the nick skin
 * wardrobe hangs past the limit         the nick skin at the limit               a stalled answer left the scene empty
 * wardrobe hangs, then answers          `full` brings the wardrobe skin          the stand-in must be replaced
 * nothing before the limit              no look yet                              the stand-in waits its turn
 * outfit in time, wardrobe hangs        nick skin wearing the outfit             the worn items must not wait on the skin
 */
describe('the home figure does not wait on a hung wardrobe', () => {
  it('a wardrobe answer in time wins and the stand-in is never asked', async () => {
    const c = clock()
    let asked = 0
    const got = answerOr(Promise.resolve('wardrobe'), 3500, () => (asked++, 'nick'), c.wait)
    await c.pass(3500)
    expect(await got, 'a wardrobe that answered in time must be worn').toBe('wardrobe')
    expect(asked, 'the nick skin must not be fetched once the wardrobe answered').toBe(0)
  })

  it('a hung wardrobe gives way to the nick skin at the limit, not before', async () => {
    const c = clock()
    const skin = later<{ skin: string }>()
    const outfit = later<{ items: string[] }>()
    const stages = lookStages(
      { skin: skin.promise, nickSkin: async () => ({ skin: 'nick' }), outfit: outfit.promise, noOutfit: { items: [] } },
      { skinMs: 3500, outfitMs: 2500 },
      c.wait,
    )
    await c.pass(2500)
    expect(await settledValue(stages.first), 'before the wardrobe limit the figure still waits for the real skin').toBeNull()
    await c.pass(3500)
    expect(await settledValue(stages.first), 'past the limit a hung wardrobe must not keep the scene empty').toEqual({
      v: { skin: 'nick', items: [] },
    })
    skin.give({ skin: 'wardrobe' })
    outfit.give({ items: ['hat'] })
    expect(await stages.full, 'the wardrobe skin must replace the stand-in when it arrives').toEqual({ skin: 'wardrobe', items: ['hat'] })
  })

  it('an outfit that came in time is worn over the stand-in skin', async () => {
    const c = clock()
    const skin = later<{ skin: string }>()
    const stages = lookStages(
      { skin: skin.promise, nickSkin: async () => ({ skin: 'nick' }), outfit: Promise.resolve({ items: ['hat'] }), noOutfit: { items: [] } },
      { skinMs: 3500, outfitMs: 2500 },
      c.wait,
    )
    await c.pass(3500)
    expect(await stages.first, 'the worn items must not wait on a hung wardrobe').toEqual({ skin: 'nick', items: ['hat'] })
  })

  it('a quick wardrobe and outfit go straight to the full look', async () => {
    const c = clock()
    const stages = lookStages(
      { skin: Promise.resolve({ skin: 'wardrobe' }), nickSkin: async () => ({ skin: 'nick' }), outfit: Promise.resolve({ items: ['hat'] }), noOutfit: { items: [] } },
      { skinMs: 3500, outfitMs: 2500 },
      c.wait,
    )
    expect(await stages.first, 'a fast answer must not flash the nick skin').toEqual({ skin: 'wardrobe', items: ['hat'] })
  })
})
