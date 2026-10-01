import { describe, expect, it } from 'bun:test'
import { isMilliScreen } from './milliScreens'
import type { ScreenId } from '../state/ui'

/*
 * Милли — только в каталоге, на остальных экранах в углу поддержка.
 * «Ресурсы» — это playhub с открытым полным каталогом, «Библиотека» — тот же
 * playhub без него.
 */
describe('isMilliScreen', () => {
  it('«Ресурсы» (полный каталог и карточки в нём) — Милли', () => {
    expect(isMilliScreen('playhub', true)).toBe(true)
  })

  it('старый экран каталога — Милли', () => {
    expect(isMilliScreen('mods', false)).toBe(true)
    expect(isMilliScreen('mods', true)).toBe(true)
  })

  it('«Библиотека» — поддержка', () => {
    expect(isMilliScreen('playhub', false)).toBe(false)
  })

  const support: ScreenId[] = ['play', 'premium', 'plus', 'builds', 'servers', 'skins', 'rubies', 'friends', 'chat', 'hosting', 'game', 'settings']
  for (const s of support) {
    it(`${s} — поддержка, даже если каталог хаба остался открытым`, () => {
      expect(isMilliScreen(s, true)).toBe(false)
      expect(isMilliScreen(s, false)).toBe(false)
    })
  }

  it('страница сборки поверх каталога — поддержка', () => {
    expect(isMilliScreen('playhub', true, true)).toBe(false)
    expect(isMilliScreen('mods', false, true)).toBe(false)
  })
})
