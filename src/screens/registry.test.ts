import { describe, expect, it } from 'bun:test'
import type { ScreenId } from '../state/ui'
import { PRELOAD_ORDER, WEAK_PRELOAD, preloadPlan } from './registry'

// Предзагрузка идёт по одному экрану в порядке вероятности захода (телеметрия 26.10.2026).
describe('preloadPlan', () => {
  const none = new Set<ScreenId>()

  it('начинает с самых частых экранов и без текущего', () => {
    expect(preloadPlan('play', false, none).slice(0, 4)).toEqual(['playhub', 'rubies', 'skins', 'friends'])
  })

  it('на слабом ПК — только два следующих', () => {
    expect(preloadPlan('play', true, none)).toEqual(['playhub', 'rubies'])
    expect(preloadPlan('play', true, none).length).toBe(WEAK_PRELOAD)
  })

  it('уже начатые экраны пропускаются, а слабому ПК достаются следующие по вероятности', () => {
    expect(preloadPlan('play', true, new Set<ScreenId>(['playhub']))).toEqual(['rubies', 'skins'])
  })

  it('с экрана скинов вперёд идут лобби и библиотека', () => {
    expect(preloadPlan('skins', false, none).slice(0, 3)).toEqual(['play', 'playhub', 'rubies'])
  })

  it('в порядке все 15 экранов ровно по разу', () => {
    expect(new Set(PRELOAD_ORDER).size).toBe(15)
  })
})
