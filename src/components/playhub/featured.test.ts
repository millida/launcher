import { describe, expect, test } from 'bun:test'
import { featuredSpot, featuredTurn, rotatedTurn, type Featured, type FeaturedSpot } from './featured'

describe('featured turn: the anarchy and PrisonRPG take turns', () => {
  const cases: { day: number; salt: number; ready: boolean; want: Featured; why: string }[] = [
    { day: 20000, salt: 0, ready: true, want: 'anarchy', why: 'an even day with salt 0 is the anarchy turn' },
    { day: 20001, salt: 0, ready: true, want: 'prisonrpg', why: 'the next day hands the spots to PrisonRPG' },
    { day: 20002, salt: 0, ready: true, want: 'anarchy', why: 'and the day after gives them back: strict alternation' },
    { day: 20000, salt: 1, ready: true, want: 'prisonrpg', why: 'the other half of players sees PrisonRPG on the same day' },
    { day: 20001, salt: 1, ready: true, want: 'anarchy', why: 'so each day both get about half of the audience' },
    { day: 20001, salt: 0, ready: false, want: 'anarchy', why: 'no PrisonRPG card in the catalogue: the anarchy keeps the spot' },
    { day: -3, salt: 0, ready: true, want: 'prisonrpg', why: 'a clock before 1970 must not break the parity' },
    { day: 20001.7, salt: 0, ready: true, want: 'prisonrpg', why: 'a fractional day counts as its whole day' },
    { day: Number.NaN, salt: 0, ready: true, want: 'anarchy', why: 'a broken clock falls back to the long-standing anarchy' },
    { day: 20001, salt: Number.POSITIVE_INFINITY, ready: true, want: 'anarchy', why: 'a broken salt falls back to the anarchy' },
  ]
  for (const c of cases)
    test(`day ${c.day}, salt ${c.salt}, ready ${c.ready} -> ${c.want}`, () => {
      expect(featuredTurn(c.day, c.salt, c.ready), c.why).toBe(c.want)
    })

  test('over two weeks each one gets exactly half of the days', () => {
    const days = Array.from({ length: 14 }, (_, i) => featuredTurn(20000 + i, 0, true))
    expect(days.filter((d) => d === 'prisonrpg').length, 'equal exposure is the point of the rotation').toBe(7)
  })
})

describe('featured spot: what the banner draws', () => {
  const prisonTurn = (ready: boolean): Featured => (ready ? 'prisonrpg' : 'anarchy')
  const anarchyTurn = (): Featured => 'anarchy'
  const cases: { pack: string | null | undefined; turn: (r: boolean) => Featured; want: FeaturedSpot<string>['kind']; why: string }[] = [
    { pack: 'p', turn: anarchyTurn, want: 'anarchy', why: 'on the anarchy turn the old banner stays exactly as it was' },
    { pack: undefined, turn: anarchyTurn, want: 'anarchy', why: 'the anarchy turn never waits for the catalogue' },
    { pack: 'p', turn: prisonTurn, want: 'prisonrpg', why: 'on its turn PrisonRPG takes the spot with its pack' },
    { pack: undefined, turn: prisonTurn, want: 'wait', why: 'still loading: wait instead of flashing the anarchy first' },
    { pack: null, turn: prisonTurn, want: 'anarchy', why: 'the catalogue answered without PrisonRPG: the anarchy fills in' },
  ]
  for (const c of cases)
    test(`pack ${String(c.pack)} -> ${c.want}`, () => {
      expect(featuredSpot(c.pack, c.turn).kind, c.why).toBe(c.want)
    })
})

describe('lobby rotation: the banner swaps faces every few minutes', () => {
  const cases: { first: Featured; step: number; ready: boolean; want: Featured; why: string }[] = [
    { first: 'anarchy', step: 0, ready: true, want: 'anarchy', why: 'the lobby opens with the day turn' },
    { first: 'anarchy', step: 1, ready: true, want: 'prisonrpg', why: 'the first swap hands the banner to PrisonRPG' },
    { first: 'anarchy', step: 2, ready: true, want: 'anarchy', why: 'and the next one gives it back' },
    { first: 'prisonrpg', step: 0, ready: true, want: 'prisonrpg', why: 'a PrisonRPG day opens with PrisonRPG' },
    { first: 'prisonrpg', step: 1, ready: true, want: 'anarchy', why: 'then the anarchy gets its minutes too' },
    { first: 'prisonrpg', step: 3, ready: false, want: 'anarchy', why: 'no PrisonRPG card: nothing to rotate, the anarchy stays' },
    { first: 'anarchy', step: Number.NaN, ready: true, want: 'anarchy', why: 'a broken counter keeps the day turn' },
  ]
  for (const c of cases)
    test(`${c.first}, step ${c.step}, ready ${c.ready} -> ${c.want}`, () => {
      expect(rotatedTurn(c.first, c.step, c.ready), c.why).toBe(c.want)
    })
})
