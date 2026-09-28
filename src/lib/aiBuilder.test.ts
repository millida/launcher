import { expect, test } from 'bun:test'
import { aiPresetFor, auditFixItems, planRequestKey } from './aiBuilder'

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

test('auditFixItems: только недостающее с найденным файлом, по одному на проект', () => {
  const fix = (project_id: string) => ({
    source: 'modrinth' as const,
    project_id,
    version_id: 'v-' + project_id,
    title: project_id,
    icon: '',
    version_number: '',
    file_name: '',
    size: 0,
    relation: 'required',
    required_by: '',
    problem: '',
  })
  const issue = (kind: 'missing' | 'conflict' | 'version' | 'loader', f: ReturnType<typeof fix> | null) => ({
    kind,
    title: 'Fog',
    detail: '',
    file_name: '',
    fix: f,
  })
  const cases: Array<[string, Parameters<typeof auditFixItems>[0], string[]]> = [
    ['YACL из jar Fog', { issues: [issue('missing', fix('1eAoo2KR'))] }, ['1eAoo2KR']],
    ['два мода просят одну библиотеку', { issues: [issue('missing', fix('lib')), issue('missing', fix('lib'))] }, ['lib']],
    ['в каталогах не нашлось — ставить нечего', { issues: [issue('missing', null)] }, []],
    ['конфликт сам не чинится установкой', { issues: [issue('conflict', fix('x'))] }, []],
  ]
  for (const [why, audit, want] of cases) {
    expect(auditFixItems(audit).map((i) => i.project_id), why).toEqual(want)
  }
})

test('planRequestKey: повтор того же запроса с теми же версией и загрузчиком', () => {
  expect(planRequestKey(' Хоррор ', { mcVersion: '1.20.1', loader: 'fabric' })).toBe(planRequestKey('хоррор', { mcVersion: '1.20.1', loader: 'fabric' }))
  expect(planRequestKey('хоррор', { mcVersion: '1.20.1' })).not.toBe(planRequestKey('хоррор', { mcVersion: '1.21.1' }))
})
