import { describe, expect, it } from 'bun:test'
import { isMilliScreen } from './milliScreens'
import type { ScreenId } from '../state/ui'

/* Милли — на всех основных экранах, кроме настроек и игры. */
describe('isMilliScreen', () => {
  const shown: ScreenId[] = ['play', 'premium', 'plus', 'builds', 'servers', 'mods', 'skins', 'rubies', 'friends', 'chat', 'hosting', 'playhub']
  for (const s of shown) {
    it(`${s} — Милли`, () => {
      expect(isMilliScreen(s, true)).toBe(true)
      expect(isMilliScreen(s, false)).toBe(true)
    })
  }

  for (const s of ['game', 'settings'] as ScreenId[]) {
    it(`${s} — без Милли`, () => {
      expect(isMilliScreen(s, true)).toBe(false)
    })
  }

  it('страница сборки поверх экрана — без Милли', () => {
    expect(isMilliScreen('playhub', true, true)).toBe(false)
    expect(isMilliScreen('mods', false, true)).toBe(false)
  })
})
