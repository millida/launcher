import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const lever = (text: string, pattern: RegExp) => text.match(pattern)?.[1]

test('the interface and the core open the graphics presets together', () => {
  const ui = lever(read('./graphicsRelease.ts'), /export const GRAPHICS_PRESETS_PUBLIC = (true|false)/)
  const core = lever(read('../../src-tauri/src/engine/game/presets.rs'), /const GRAPHICS_PRESETS_PUBLIC: bool = (true|false);/)
  expect(ui, 'graphicsRelease.ts lost GRAPHICS_PRESETS_PUBLIC').toBeDefined()
  expect(core, 'presets.rs lost GRAPHICS_PRESETS_PUBLIC: the FPS boost would no longer know which set to install').toBeDefined()
  expect(core, 'one side shows the presets while the other installs the old FPS set (or the pin table without the presets): flip both levers together').toBe(ui)
})
