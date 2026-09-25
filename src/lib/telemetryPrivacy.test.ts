import { expect, test } from 'bun:test'
import { buildTag, errorCode, scrubPaths, scrubText } from './telemetryPrivacy'

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

test('домашняя папка в любом написании и токены вырезаются', () => {
  const cases: Array<[string, string]> = [
    ['Error opening zip file : C:/Users/Александр/AppData/Roaming/x.jar', 'Error opening zip file : <user>/AppData/Roaming/x.jar'],
    ['"C:\\\\Users\\\\Вася\\\\AppData"', '"<user>\\\\AppData"'],
    ['\\\\?\\C:\\Users\\ADMINI~1\\AppData\\Local', '\\\\?\\<user>\\AppData\\Local'],
    ['D:\\Documents and Settings\\Петя\\x', '<user>\\x'],
    ['/var/home/bob/.minecraft', '<user>/.minecraft'],
    ['C:\\Users\\John Smith\\AppData', '<user>\\AppData'],
    ['~bob/.local/share', '<user>/.local/share'],
    ['нет файла ~/x', 'нет файла ~/x'],
  ]
  for (const [raw, want] of cases) expect(scrubPaths(raw)).toBe(want)
  const t = scrubText('Authorization: Bearer abc.def.ghi and accessToken=zzz123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
  expect(t).not.toContain('abc.def')
  expect(t).not.toContain('zzz123')
  expect(t).not.toContain('SflKxw')
})
