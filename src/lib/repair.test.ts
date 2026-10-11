import { describe, expect, test } from 'bun:test'
import { forgetCrash, lastCrash, missingDeps, modFixOf, packRepairText, rememberCrash, repairChangedFiles } from './repair'

type A = { kind: string; arg?: string }

describe('«Починить сборку» в окне вылета', () => {
  const cases: Array<[string, A[], string | null, string]> = [
    ['план', [{ kind: 'install-dep', arg: 'fabric-api|*' }, { kind: 'fix-plan', arg: '[]' }, { kind: 'repair' }], 'fix-plan', 'план из лога выполняет все шаги, а не первый'],
    ['Indium', [{ kind: 'add-mod', arg: 'indium' }, { kind: 'repair' }, { kind: 'share-log' }], 'add-mod', 'рендерер Fabric ставится, а не перепроверяются хеши'],
    ['зависимости', [{ kind: 'disable-mod', arg: 'a.jar' }, { kind: 'install-deps' }, { kind: 'repair' }], 'install-deps', 'доустановка важнее отключения мода'],
    ['мод под другую версию', [{ kind: 'disable-mod', arg: 'a.jar' }, { kind: 'repair' }], 'disable-mod', 'единственное, что меняет набор модов'],
    ['память', [{ kind: 'set-ram', arg: '6144' }, { kind: 'repair' }], null, 'память — своя кнопка, общая починка её не трогает'],
    ['неизвестно', [{ kind: 'repair' }, { kind: 'share-log' }], null, 'причина не распознана — только сверка файлов'],
    ['старое ядро', [], null, 'действий нет вовсе'],
  ]
  for (const [name, actions, want, why] of cases) {
    test(name, () => {
      expect(modFixOf(actions)?.kind ?? null, why).toBe(want)
    })
  }

  test('успех только после реального изменения', () => {
    expect(repairChangedFiles({ restored: 0 }), 'сверка без перекачки не лечит вылет — окно не закрывать').toBe(false)
    expect(repairChangedFiles({ restored: 3 }), 'перекачанные файлы — изменение').toBe(true)
  })
})

describe('Кнопка «Починить» на странице сборки помнит последний вылет', () => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  const crash = { profile: 'Тёмный лес', reason: 'нет fabric-api', tail: '', actions: [{ kind: 'fix-plan', label: 'Починить', arg: '[]' }] }

  test('план вылета переживает закрытие окна и перезапуск', () => {
    store.clear()
    rememberCrash(crash, 1_000)
    expect(lastCrash('Тёмный лес', 2_000)?.actions[0]?.kind, 'кнопка сборки берёт план ядра').toBe('fix-plan')
    expect(lastCrash('Тёмный лес', 1_000 + 4 * 86_400_000), 'через трое суток план устарел').toBeNull()
  })

  test('спокойная игра после вылета стирает старый план, свежий вылет — нет', () => {
    store.clear()
    rememberCrash(crash, 1_000)
    forgetCrash('Тёмный лес', 500, 2_000)
    expect(lastCrash('Тёмный лес', 2_000), 'вылет случился после начала этой игры — он настоящий').not.toBeNull()
    forgetCrash('Тёмный лес', 1_500, 2_000)
    expect(lastCrash('Тёмный лес', 2_000), 'игра началась после вылета и шла спокойно').toBeNull()
  })

  test('недостающие зависимости без повторов, конфликты не трогаем', () => {
    const fix = (p: string) => ({ source: 'modrinth', project_id: p, version_id: 'v' + p })
    const items = missingDeps([
      { kind: 'missing', fix: fix('fabric-api') },
      { kind: 'missing', fix: fix('fabric-api') },
      { kind: 'conflict', fix: fix('sodium') },
      { kind: 'missing', fix: null },
    ])
    expect(items).toEqual([{ source: 'modrinth', project_id: 'fabric-api', version_id: 'vfabric-api' }])
  })

  test('итог говорит, что сделано, а не «всё на месте»', () => {
    expect(packRepairText({ done: ['поставлены зависимости: fabric-api'], failed: [], unresolved: null, filesText: 'Всё на месте' })).toBe(
      'Готово: поставлены зависимости: fabric-api. Запусти игру',
    )
    expect(packRepairText({ done: [], failed: [], unresolved: { at: 1, reason: 'x', actions: [] }, filesText: 'Всё на месте' })).toContain('Милли')
  })
})
