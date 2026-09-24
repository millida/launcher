import { expect, test } from 'bun:test'
import { buildTag, errorCode, scrubPaths } from './telemetryPrivacy'

test('пути пользователя вырезаются из кода ошибки', () => {
  expect(scrubPaths('нет файла C:\\Users\\Вася\\AppData\\x.jar')).toBe('нет файла <user>\\AppData\\x.jar')
  expect(scrubPaths('/Users/daniil/Library/a и /home/bob/.minecraft')).toBe('<user>/Library/a и <user>/.minecraft')
  expect(errorCode(new Error('/Users/x/y'))).toBe('Error: <user>/y')
})

test('сборка — слаг каталога или отпечаток, но не имя', () => {
  expect(buildTag('Моя сборка Васи', 'fabulously-optimized')).toBe('catalog:fabulously-optimized')
  const t = buildTag('Моя сборка Васи')!
  expect(t.startsWith('custom:')).toBe(true)
  expect(t).not.toContain('Вася')
  expect(buildTag(null)).toBe(null)
})
