import { describe, expect, test } from 'bun:test'
import { modFixOf, repairChangedFiles } from './repair'

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
