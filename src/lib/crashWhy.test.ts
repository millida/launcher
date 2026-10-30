import { describe, expect, test } from 'bun:test'
import { crashWhy, isModCrash, modTitle } from './crashWhy'

describe('crashWhy: чья поломка', () => {
  test('конфликт мода называет мод и снимает вину с лаунчера', () => {
    expect(crashWhy({ kind: 'conflict', culprits: ['create-1.20.1-6.0.4.jar'] })).toContain('«create»')
  })
  test('мод не назван — говорим про моды вообще', () => {
    expect(crashWhy({ kind: 'missing_deps' })).toContain('проблема модов')
  })
  test('драйвер видеокарты — не лаунчер', () => {
    expect(crashWhy({ kind: 'gpu_driver' })).toContain('драйвер')
  })
  test('свою ошибку и память ядро объясняет само — строку не дублируем', () => {
    expect(crashWhy({ kind: 'own_mod' })).toBeNull()
    expect(crashWhy({ kind: 'oom' })).toBeNull()
  })
  test('неизвестная причина — строки нет, а не догадка', () => {
    expect(crashWhy({ kind: 'unknown' })).toBeNull()
    expect(crashWhy({})).toBeNull()
  })
})

describe('modTitle', () => {
  const cases: [string, string][] = [
    ['sodium-fabric-0.5.13+mc1.20.1.jar', 'sodium-fabric'],
    ['create-1.20.1-6.0.4.jar', 'create'],
    ['OptiFine_1.20.1_HD_U_I6.jar', 'OptiFine'],
    ['journeymap.jar.disabled', 'journeymap'],
  ]
  for (const [file, want] of cases) test(file, () => expect(modTitle(file)).toBe(want))
})

describe('isModCrash: «Починить сборку» передаёт разбор Милли вместо тупика', () => {
  const cases: [string | undefined, boolean, string][] = [
    ['conflict', true, 'конфликт без готового фикса: сверка файлов его не уберёт, нужен разбор лога'],
    ['mixin', true, 'миксин — тоже поломка мода'],
    ['oom', false, 'память лечится настройкой, а не разбором модов'],
    ['gpu_driver', false, 'драйвер — не моды, Милли тут не поможет'],
    [undefined, false, 'вылет без вида не уводим в Милли вслепую'],
  ]
  for (const [kind, want, why] of cases) test(String(kind), () => expect(isModCrash(kind), why).toBe(want))
})
