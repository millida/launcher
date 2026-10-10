import { describe, expect, test } from 'bun:test'
import { isLibraryMod } from './modRole'

const m = (title: string, description = '') => ({ title, name: title + '.jar', description })

describe('детали сборки', () => {
  test('библиотеки', () => {
    expect(isLibraryMod(m('Cloth Config API', 'Configuration Library for Minecraft Mods'))).toBe(true)
    expect(isLibraryMod(m('Fabric API', 'Lightweight and modular API providing common hooks'))).toBe(true)
    expect(isLibraryMod(m('Architectury API'))).toBe(true)
    expect(isLibraryMod(m('GeckoLib'))).toBe(true)
    expect(isLibraryMod(m('Placebo', 'A library mod'))).toBe(true)
    expect(isLibraryMod(m('Something', 'A library mod for Shadows mods'))).toBe(true)
  })
  test('обычные моды', () => {
    expect(isLibraryMod(m('Sodium', 'A high-performance rendering engine'))).toBe(false)
    expect(isLibraryMod(m('FerriteCore', 'Memory usage optimizations'))).toBe(false)
    expect(isLibraryMod(m('Dynamic FPS', 'Reduce resource usage while Minecraft is in the background'))).toBe(false)
    expect(isLibraryMod(m('ImmediatelyFast', 'Speed up immediate mode rendering in Minecraft'))).toBe(false)
    expect(isLibraryMod(m('Entity Culling', 'Using async path-tracing to hide Block-/Entities that are not visible'))).toBe(false)
    expect(isLibraryMod(m('Just Enough Items (JEI)', 'View Items and Recipes'))).toBe(false)
  })
})
