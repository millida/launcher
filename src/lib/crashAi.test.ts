import { expect, test } from 'bun:test'
import type { ModFile } from '../ipc/commands'
import { crashAskBody, crashDisableOffers, scrubCrashText } from './crashAi'

const mod = (name: string, enabled = true, title?: string): ModFile => ({ name, enabled, size: 1, scanned: true, ...(title ? { title } : {}) })

const SCRUB: [string, string, string][] = [
  ['C:\\Users\\Иван Петров\\AppData\\.minecraft', '~\\AppData\\.minecraft', 'имя учётки Windows с пробелом не уходит на сервер'],
  ['/Users/ivan/Library/x', '~/Library/x', 'домашняя папка macOS'],
  ['--accessToken abc.def --version 1.20.1', '--accessToken *** --version 1.20.1', 'токен сессии из строки запуска'],
]
for (const [input, want, why] of SCRUB) {
  test(`scrubCrashText: ${why}`, () => {
    expect(scrubCrashText(input), why).toBe(want)
  })
}

test('crashAskBody: отключённые моды не уходят и не вернутся кнопкой «Отключить»', () => {
  const body = crashAskBody(
    { profile: 'p', reason: 'Вылет', tail: 'C:\\Users\\Bob\\x' },
    [mod('a.jar', true, 'A'), mod('b.jar', false)],
    { name: 'p', version: '1.20.1', fabric: true },
  )
  expect(body.mods, 'выключенный b.jar в разборе не участвовал').toEqual([{ file: 'a.jar', title: 'A' }])
  expect(body.loader).toBe('fabric')
  expect(body.tail, 'имя учётки вычищено').toBe('~\\x')
})

test('crashDisableOffers: кнопка только для мода, который всё ещё включён в сборке', () => {
  const offers = crashDisableOffers(
    { explain: 'x', steps: [], remaining: 1, disable: [{ file: 'a.jar' }, { file: 'gone.jar', title: 'Gone' }, { file: 'b.jar' }] },
    [mod('a.jar', true, 'Mod A'), mod('b.jar', false)],
  )
  expect(offers, 'gone.jar удалён, b.jar уже выключен — предлагать нечего').toEqual([{ file: 'a.jar', title: 'Mod A' }])
})
