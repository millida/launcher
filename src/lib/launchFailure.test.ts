import { expect, test } from 'bun:test'
import { launchFailure } from './launchFailure'

test('провал запуска: класс, этап, без имени сборки даже короткого', () => {
  const f = launchFailure('Версия про не найдена', 'files', [['про', '<build>']])
  expect(f).toMatchObject({ code: 'Версия <build> не найдена', kind: 'version_not_found', stage: 'files' })
  const g = launchFailure(new Error('Версия Моя сборка не найдена'), '', [['Моя сборка', '<build>']])
  expect(g.code).toBe('Версия <build> не найдена')
  expect(g.stage).toBe('prepare')
})

test('ранний выход JVM: detail без authlib-шума и без домашней папки', () => {
  const f = launchFailure(
    'Игра не запустилась (код Some(1)).\n[authlib-injector] [INFO] Logging file: C:\\Users\\Asus\\AppData\\x.log\nError opening zip file or JAR manifest missing : C:/Users/Иван/AppData/Roaming/a.jar',
    'launch',
    [],
  )
  expect(f.kind).toBe('jvm_early_exit')
  expect(f.detail).toBe('Игра не запустилась (код Some(1)). | Error opening zip file or JAR manifest missing : <user>/AppData/Roaming/a.jar')
  expect(f.code).not.toContain('Asus')
})
