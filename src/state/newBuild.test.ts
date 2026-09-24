import { describe, expect, test } from 'bun:test'
import { autoBuildName } from './newBuild'

describe('autoBuildName', () => {
  test('версия в имени', () => {
    expect(autoBuildName('1.21.4', [])).toBe('Minecraft 1.21.4')
  })
  test('занятое имя получает номер, как у unique_profile_name', () => {
    expect(autoBuildName('1.21.4', ['Minecraft 1.21.4'])).toBe('Minecraft 1.21.4 (2)')
    expect(autoBuildName('1.21.4', ['Minecraft 1.21.4', 'Minecraft 1.21.4 (2)'])).toBe('Minecraft 1.21.4 (3)')
  })
  test('без версии', () => {
    expect(autoBuildName('', [])).toBe('Minecraft')
  })
})
