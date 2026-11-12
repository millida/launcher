import { describe, expect, test } from 'bun:test'
import { FESTIVE_IN_PROD, festiveActive, festiveDate, festiveScene, festiveSeason, isTestBuild } from './festive'
import { particleStyle } from './ambience'
import { drawScene, makeScene, stepScene } from './seasonParticles'

const at = (m: number, d: number) => new Date(2026, m - 1, d, 12)

describe('new year theme: who sees it', () => {
  test('stays off for everyone until the owner flips the flag', () => expect(FESTIVE_IN_PROD).toBe(false))

  const builds: Array<[string, boolean]> = [
    ['99.0.0', true],
    ['99.1.3', true],
    ['100.0.0', true],
    ['2.0.0', false],
    ['2.3.1', false],
    ['9.0.0', false],
    ['', false],
    ['garbage', false],
  ]
  for (const [v, want] of builds) test(`build ${v || '(none)'} is ${want ? '' : 'not '}the test build`, () => expect(isTestBuild(v)).toBe(want))

  test('the test build shows snow outside the season, so it can be checked in November', () =>
    expect(festiveScene({ test: true, prod: false, date: at(11, 11) })).toBe('winter'))
  test('the test build shows fireworks on New Year night', () => expect(festiveScene({ test: true, prod: false, date: at(12, 31) })).toBe('newyear'))
  test('a release build shows nothing while the flag is off, even in season', () =>
    expect(festiveScene({ test: false, prod: false, date: at(12, 20) })).toBe(null))
  test('with the flag on, a release build follows the calendar', () => {
    expect(festiveScene({ test: false, prod: true, date: at(12, 20) })).toBe('winter')
    expect(festiveScene({ test: false, prod: true, date: at(1, 1) })).toBe('newyear')
    expect(festiveScene({ test: false, prod: true, date: at(11, 11) })).toBe(null)
    expect(festiveScene({ test: false, prod: true, date: at(10, 31) })).toBe(null)
  })
  test('Halloween is not a festive season', () => expect(festiveSeason(at(10, 31))).toBe(null))
  test('the player switch hides the theme', () => {
    expect(festiveActive({ scene: 'winter', on: false })).toBe(null)
    expect(festiveActive({ scene: 'winter', on: true })).toBe('winter')
  })
})

describe('new year theme: date override for checking', () => {
  const now = at(11, 11)
  test('MM-DD lands in this year', () => {
    const d = festiveDate('12-31', now)
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 12, 31])
  })
  test('anything else keeps today', () => {
    expect(festiveDate(null, now)).toBe(now)
    expect(festiveDate('tomorrow', now)).toBe(now)
  })
})

describe('season particles', () => {
  test('New Year keeps the snow falling under the fireworks', () => {
    const s = particleStyle('newyear')
    expect(s.count).toBeGreaterThan(0)
    expect(s.sparks.length).toBeGreaterThan(0)
    expect(particleStyle('winter').sparks).toEqual([])
  })

  const fakeCanvas = () => {
    const calls = { rects: 0 }
    const g = {
      clearRect: () => {},
      fillRect: () => calls.rects++,
      fillStyle: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D
    return { g, calls }
  }

  test('drifts grow from landed snow and never pass their cap', () => {
    const style = particleStyle('winter')
    const sc = makeScene(style, 200, 120, { pixel: 2, drift: 9 })
    const before = sc.ground!.reduce((a, b) => a + b, 0)
    for (let i = 0; i < 4000; i++) stepScene(sc, style, 0.05, i * 50)
    const after = sc.ground!.reduce((a, b) => a + b, 0)
    expect(after).toBeGreaterThan(before)
    for (let x = 0; x < sc.w; x++) expect(sc.ground![x]!).toBeLessThanOrEqual(9 + 0.5)
  })

  test('the lobby scene has no drifts and draws its flakes', () => {
    const style = particleStyle('winter')
    const sc = makeScene(style, 200, 120, { pixel: 2 })
    expect(sc.ground).toBe(null)
    const { g, calls } = fakeCanvas()
    drawScene(g, sc, style, 'winter')
    expect(calls.rects).toBe(style.count)
  })

  test('fireworks burst only in a season with sparks', () => {
    const winter = particleStyle('winter')
    const ny = particleStyle('newyear')
    const a = makeScene(winter, 200, 120, { pixel: 2 })
    const b = makeScene(ny, 200, 120, { pixel: 2 })
    stepScene(a, winter, 0.016, 1000)
    stepScene(b, ny, 0.016, 1000)
    expect(a.sparks.length).toBe(0)
    expect(b.sparks.length).toBeGreaterThan(0)
  })
})
