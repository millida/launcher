import { describe, expect, test } from 'bun:test'
import { modelFiles } from '../../scripts/dev-cosmetic-models.mjs'

describe('модели вещей для демо (dev-сервер Vite)', () => {
  test('geometry.<имя> → bundled_<имя>.json, затем <имя>.json', () => {
    expect(modelFiles('geometry.dragon_wings')).toEqual(['bundled_dragon_wings.json', 'dragon_wings.json'])
    expect(modelFiles('geometry.bundled_67')).toEqual(['bundled_67.json'])
  })
  test('путь наружу не собирается', () => {
    expect(modelFiles('../etc/passwd')).toEqual([])
    expect(modelFiles('geometry.a/../../b')).toEqual([])
    expect(modelFiles('')).toEqual([])
  })
})
