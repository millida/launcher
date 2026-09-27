import { expect, test } from 'bun:test'
import { aiPresetFor } from './aiBuilder'

const CASES: [loader: string, version: string, expected: object, why: string][] = [
  ['fabric', '1.20.1', { loader: 'fabric', mcVersion: '1.20.1' }, 'обычный релиз переходит как есть'],
  ['neoforge', '26.1.2', { loader: 'neoforge', mcVersion: '26.1.2' }, 'годовая нумерация с 2026 — тоже релиз'],
  ['vanilla', '1.21.4', { mcVersion: '1.21.4' }, 'ИИ-сборщик не знает Vanilla: загрузчик выбирает сам'],
  ['fabric', '24w14a', { loader: 'fabric' }, 'снапшот сервер отвергнет 400 — версию не передаём'],
  ['quilt', '1.21-pre1', { loader: 'quilt' }, 'pre-release — тоже не релиз'],
  ['forge', '', { loader: 'forge' }, 'список версий не загрузился — без версии'],
]

test('aiPresetFor: в запрос уходит только то, что примет сервер', () => {
  for (const [loader, version, expected, why] of CASES) {
    expect(aiPresetFor(loader, version), why).toEqual(expected)
  }
})
