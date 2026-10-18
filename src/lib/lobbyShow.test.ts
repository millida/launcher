import { describe, expect, it } from 'bun:test'
import { EMOTE_SHOW_MAX_MS, EMOTE_SHOW_MIN_MS, emoteShowMs, showPicker, skinMaskEmote, wornEmoteLoops } from './lobbyShow'

/**
 * How the home-screen figure plays emotes.
 *
 * case                              verdict                          pinned by
 * worn emote on the home screen     plays once, then rest            the figure shook its head forever
 * worn emote in the fitting room    loops                            trying an emote on must keep it visible
 * long looping emote                show ends by the cap             an endless clip must still hand back to rest
 * short loop                        repeats up to the minimum        a 0.5 s loop flashed by unread
 * worn emote and catalogue emotes   worn first, then every one       the worn emote is the one the person chose
 * nothing to show                   no emote                         the figure only rests
 */
describe('the home-screen figure rests between emotes', () => {
  it('a worn emote loops only in the fitting room', () => {
    expect(wornEmoteLoops(false), 'on the home screen a looping worn emote never hands back to rest').toBe(false)
    expect(wornEmoteLoops(true), 'the fitting room must keep the tried-on emote playing').toBe(true)
  })

  const durations: [string, number, number, number][] = [
    ['an endless 40 s loop is cut', 0, 40, EMOTE_SHOW_MAX_MS],
    ['a 0.5 s loop repeats to 3 s', 0, 0.5, 3000],
    ['a wind-up and a 1 s loop', 1, 1, 4000],
    ['a broken zero-length loop still ends', 0, 0, 3000],
  ]
  for (const [why, intro, loop, ms] of durations) {
    it(why, () => {
      const got = emoteShowMs(intro, loop)
      expect(got, 'every show must end so the figure returns to rest').toBe(ms)
      expect(got).toBeGreaterThanOrEqual(EMOTE_SHOW_MIN_MS)
      expect(got).toBeLessThanOrEqual(EMOTE_SHOW_MAX_MS)
    })
  }

  it('plays the worn emote first, then a round of every emote with it once', () => {
    const next = showPicker(['wave', 'clap', 'dab'], 'no', () => 0.5)
    expect(next(), 'the worn emote opens the show').toBe('no')
    const round = [next(), next(), next(), next()]
    expect([...round].sort(), 'a round holds every emote exactly once').toEqual(['clap', 'dab', 'no', 'wave'])
  })

  it('does not repeat a worn emote that is also in the catalogue list', () => {
    const next = showPicker(['wave', 'no'], 'no', () => 0.5)
    expect(next()).toBe('no')
    expect([next(), next()].sort(), 'the worn emote is not doubled in a round').toEqual(['no', 'wave'])
  })

  it('shows nothing when there is nothing to show', () => {
    expect(showPicker<string>([], null)(), 'with no emotes the figure only rests').toBeNull()
  })
})

/**
 * Whose skin mask cuts the figure.
 *
 * case                                         verdict          pinned by
 * worn skates resting on the home screen       no emote mask    legs vanished under skates that were not played
 * worn skates playing on the home screen       the skates       the game hides the legs while the emote plays
 * worn emote in the fitting room               the worn emote   it loops there, so it always plays
 * a catalogue emote playing                    that emote       the mask follows whatever plays now
 * nothing worn, nothing playing                no emote mask    a bare figure keeps every part
 */
describe('an emote cuts the skin only while it plays', () => {
  const skates = { id: 'ROLLERSKATING', slot: 'EMOTE' }
  const hat = { id: 'HAT', slot: 'HEAD' }
  const wave = { id: 'WAVE', slot: 'EMOTE' }
  const cases: [string, { id: string; slot: string }[], boolean, { id: string; slot: string } | null, { id: string; slot: string } | undefined][] = [
    ['worn skates resting on the home screen', [hat, skates], false, null, undefined],
    ['worn skates playing on the home screen', [hat, skates], false, skates, skates],
    ['worn emote in the fitting room', [hat, skates], true, null, skates],
    ['a catalogue emote playing', [hat], false, wave, wave],
    ['nothing worn, nothing playing', [hat], false, null, undefined],
  ]
  for (const [why, outfit, fittingRoom, showing, verdict] of cases) {
    it(why, () => {
      expect(skinMaskEmote(outfit, fittingRoom, showing), 'a resting emote must not cut the legs or arms out of the skin').toBe(verdict)
    })
  }
})
