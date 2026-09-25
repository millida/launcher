import { expect, test } from 'bun:test'
import { gameCrashData } from './crashEvent'

test('game_crash несёт класс, причину, моды, mc и загрузчик, но не имя сборки', () => {
  const d = gameCrashData(
    {
      profile: 'Сборка Васи',
      reason: 'Модам не хватает зависимостей: Millida',
      tail: '',
      culprits: ['sodium-0.5.jar', 'iris.jar'],
      kind: 'missing_deps',
      cause: 'net.fabricmc.loader.impl.FormattedException: Mod resolution failed in Сборка Васи',
    },
    { version: '1.21.11', loader: null, fabric: true },
    { catalogPackSlug: 'fo', modpackSlug: null },
    [['Сборка Васи', '<build>']],
  )
  expect(d).toEqual({
    code: 'Модам не хватает зависимостей: Millida',
    kind: 'missing_deps',
    cause: 'net.fabricmc.loader.impl.FormattedException: Mod resolution failed in <build>',
    suspects: 'sodium-0.5.jar, iris.jar',
    mc: '1.21.11',
    loader: 'fabric',
    pack: 'fo',
  })
})

test('длинные поля режутся, старое ядро без kind/cause не ломает событие', () => {
  const d = gameCrashData(
    { profile: 'p', reason: 'x'.repeat(500), tail: '', culprits: Array.from({ length: 40 }, (_, i) => 'mod-' + i + '-'.repeat(30)) },
    null,
    null,
  )
  expect(d.code.length).toBe(120)
  expect(d.suspects.length).toBe(300)
  expect(d.kind).toBeUndefined()
  expect(d.mc).toBeUndefined()
})
