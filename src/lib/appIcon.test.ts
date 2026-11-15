import { describe, expect, test } from 'bun:test'
import { APP_ICONS, effectiveIcon, iconUnlocked } from './appIconRules'

const none = { plus: false, diamond: false, perks: [] as string[] }

describe('app icon locks', () => {
  test('default is always open, the rest are closed for a fresh account', () => {
    expect(iconUnlocked('default', none)).toBe(true)
    expect(iconUnlocked('spark', none)).toBe(false)
    expect(iconUnlocked('gold', none)).toBe(false)
    expect(iconUnlocked('diamond', none)).toBe(false)
  })

  test('the friends ladder: Spark 5, Flame 10, Amethyst 25, Legend 50 — each by its own reward', () => {
    const ladder = APP_ICONS.filter((i) => i.rule === 'friends').map((i) => [i.id, i.friends, i.need])
    expect(ladder).toEqual([
      ['spark', 5, 'Пригласи 5 друзей'],
      ['flame', 10, 'Пригласи 10 друзей'],
      ['amethyst', 25, 'Пригласи 25 друзей'],
      ['legend', 50, 'Пригласи 50 друзей'],
    ])
    for (const [id, perk] of [['flame', 'icon-flame'], ['amethyst', 'icon-amethyst'], ['legend', 'icon-legend']] as const) {
      expect(iconUnlocked(id, none)).toBe(false)
      expect(iconUnlocked(id, { ...none, perks: [perk] })).toBe(true)
      expect(iconUnlocked(id, { ...none, plus: true, diamond: true })).toBe(false)
    }
    expect(iconUnlocked('legend', { ...none, perks: ['icon-amethyst'] })).toBe(false)
  })

  test('plan icons say so plainly', () => {
    expect(APP_ICONS.find((i) => i.id === 'gold')!.need).toBe('Только с PLUS')
    expect(APP_ICONS.find((i) => i.id === 'diamond')!.need).toBe('Только с Diamond')
  })

  test('Spark opens with the five-friends reward, whatever the plan', () => {
    expect(iconUnlocked('spark', { ...none, perks: ['icon-spark'] })).toBe(true)
    expect(iconUnlocked('spark', { ...none, plus: true })).toBe(false)
  })

  test('Gold is for PLUS and Diamond, Diamond icon for Diamond (or the old 25-friends reward)', () => {
    expect(iconUnlocked('gold', { ...none, plus: true })).toBe(true)
    expect(iconUnlocked('gold', { ...none, diamond: true })).toBe(true)
    expect(iconUnlocked('diamond', { ...none, plus: true })).toBe(false)
    expect(iconUnlocked('diamond', { ...none, diamond: true })).toBe(true)
    expect(iconUnlocked('diamond', { ...none, perks: ['icon-diamond'] })).toBe(true)
  })

  test('achievement icons: Emerald 100 hours, Quartz 500 achievement points, Obsidian 500 hours', () => {
    const cases: Array<[Parameters<typeof iconUnlocked>[0], { hours?: number; points?: number }, boolean, string]> = [
      ['emerald', {}, false, 'no progress loaded keeps it locked'],
      ['emerald', { hours: 99 }, false, 'one hour short is still locked'],
      ['emerald', { hours: 100 }, true, 'the threshold itself opens it'],
      ['obsidian', { hours: 499 }, false, 'Obsidian is the long grind, 100 hours is not enough'],
      ['obsidian', { hours: 500 }, true, 'Obsidian opens at 500 hours'],
      ['quartz', { hours: 5000 }, false, 'hours never stand in for achievement points'],
      ['quartz', { points: 499 }, false, 'points short of the goal keep it locked'],
      ['quartz', { points: 500 }, true, 'Quartz opens at 500 points'],
      ['emerald', { points: 5000 }, false, 'points never stand in for hours'],
    ]
    for (const [id, progress, want, why] of cases) expect(iconUnlocked(id, { ...none, plus: true, diamond: true, ...progress }), why).toBe(want)
  })

  test('every icon has its picture in public/app-icons', () => {
    for (const i of APP_ICONS) expect(i.src, i.id).toBe('/app-icons/' + i.id + '.png')
  })

  test('a lapsed subscription falls back to the default icon without losing the choice', () => {
    expect(effectiveIcon('gold', none)).toBe('default')
    expect(effectiveIcon('gold', { ...none, plus: true })).toBe('gold')
  })
})
