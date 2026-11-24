import { expect, test } from 'bun:test'
import { foundKey, leftBehindNote } from './imports'
import type { FoundInstance } from '../ipc/commands'

const at = (name: string, path: string, source = 'TLauncher / Minecraft'): FoundInstance => ({
  name,
  version: '1.21.1',
  loader: 'vanilla',
  path,
  source,
})

/// A shared .minecraft returns one path for every version in versions/. Keying
/// rows by path made one checkbox tick the whole group and gave React duplicate keys.
test('versions sharing one .minecraft folder get distinct keys', () => {
  const root = 'C:\\Users\\u\\AppData\\Roaming\\.minecraft'
  const keys = new Set([at('1.21.1', root), at('1.21.4', root), at('1.21.5', root)].map(foundKey))
  expect(keys.size, 'three versions of one .minecraft must not collapse into one row key').toBe(3)
})

test('the same instance name in two launchers stays two rows', () => {
  const a = foundKey(at('Sky Factory 4', 'C:\\prism\\SkyFactory', 'PrismLauncher'))
  const b = foundKey(at('Sky Factory 4', 'D:\\curseforge\\SkyFactory', 'CurseForge'))
  expect(a).not.toBe(b)
})

test('the same row keeps a stable key across rescans', () => {
  expect(foundKey(at('1.21.1', 'C:\\mc'))).toBe(foundKey(at('1.21.1', 'C:\\mc')))
})

test('a folder left behind by several builds is named once', () => {
  const note = leftBehindNote(['tacz', 'Flan', 'tacz'])
  expect(note, 'the player must see every folder that stayed behind').toContain('Flan')
  expect(note?.split('tacz').length, 'a folder repeated across builds is listed once').toBe(2)
})

test('nothing left behind says nothing', () => {
  expect(leftBehindNote([]), 'an import that took everything must not show a warning').toBeNull()
})
