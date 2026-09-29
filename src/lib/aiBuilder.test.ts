import { expect, test } from 'bun:test'
import { aiPresetFor, auditFixItems, auditProblems, excludedLines, planRequestKey } from './aiBuilder'

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

test('excludedLines: игрок видит, какой мод не вошёл и почему', () => {
  const ex = (title: string, reason: string, detail = '') => ({ slug: title.toLowerCase(), title, reason, detail })
  const cases: Array<[string, Parameters<typeof excludedLines>[0], string[]]> = [
    ['старый план без поля — пусто', undefined, []],
    ['нет файла под пару — текст сервера', [ex('Guns', 'no_file', 'нет версии под 1.20.1 · Fabric')], ['Guns — нет версии под 1.20.1 · Fabric']],
    ['недостающая библиотека названа сервером', [ex('Remnant', 'missing_deps', 'нет «YACL» под 1.20.1 · Fabric')], ['Remnant — нет «YACL» под 1.20.1 · Fabric']],
    ['служебный код карантина не показывается', [ex('Fog', 'quarantine', 'api_mismatch')], ['Fog — ломает запуск на этой версии']],
    ['повтор одной причины — одна строка', [ex('A', 'duplicate'), ex('A', 'duplicate')], ['A — повтор мода']],
  ]
  for (const [why, list, want] of cases) {
    expect(excludedLines(list), why).toEqual(want)
  }
})

test('auditProblems: сборка с оставшимися проблемами не считается готовой', () => {
  const issue = (kind: 'missing' | 'conflict' | 'version' | 'loader', title: string, detail: string) => ({ kind, title, detail, file_name: '', fix: null })
  const cases: Array<[string, Parameters<typeof auditProblems>[0], string[]]> = [
    ['проблем нет — готово', { issues: [] }, []],
    ['не нашлась библиотека', { issues: [issue('missing', 'Fog', 'нужен мод «YACL», в сборке его нет')] }, ['Fog: нужен мод «YACL», в сборке его нет']],
    ['файл не той версии и конфликт — обе', { issues: [issue('version', 'A', 'файл собран под MC 1.21'), issue('conflict', 'B', 'несовместим с «C»')] }, ['A: файл собран под MC 1.21', 'B: несовместим с «C»']],
    ['одна и та же проблема дважды — одна строка', { issues: [issue('loader', 'A', 'файл для forge'), issue('loader', 'A', 'файл для forge')] }, ['A: файл для forge']],
  ]
  for (const [why, audit, want] of cases) {
    expect(auditProblems(audit), why).toEqual(want)
  }
})
