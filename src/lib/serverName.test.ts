import { describe, expect, test } from 'bun:test'
import { cleanServerName, stripMotdEmoji } from './serverName'

describe('cleanServerName', () => {
  test('эмодзи уходят, КАПС смягчается', () => {
    expect(cleanServerName('✅ ВЫЖИВАНИЕ 🏴 АНАРХИЯ ⚔️ ПВП')).toBe('Выживание Анархия ПВП')
  })
  test('рекламный хвост после дефиса отрезается', () => {
    expect(cleanServerName('LuckyWorld - МиниИгры PvP')).toBe('LuckyWorld')
  })
  test('адрес вместо имени даёт бренд из домена', () => {
    expect(cleanServerName('mc.hypemc.pro:25565')).toBe('Hypemc')
  })
  test('обычное имя не меняется', () => {
    expect(cleanServerName('SlimeCube')).toBe('SlimeCube')
  })
})

describe('stripMotdEmoji', () => {
  test('§-коды остаются, эмодзи уходят', () => {
    expect(stripMotdEmoji('§6FunTime ⚔ §bPvP\n§aОнлайн 🔥')).toBe('§6FunTime §bPvP\n§aОнлайн')
  })
})
