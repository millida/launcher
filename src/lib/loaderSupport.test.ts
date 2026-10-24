import { expect, test } from 'bun:test'
import { loaderBlock } from './loaderSupport'

test('Legacy Fabric — ровно там, куда Fabric не доходит', () => {
  const cases: [string, string, boolean, string][] = [
    ['1.8.9', 'release', true, 'PvP-версия 1.8.9 — главная причина ставить Legacy Fabric'],
    ['1.12.2', 'release', true, 'старые сборки модов на 1.12.2'],
    ['1.14.4', 'release', false, 'с 1.14 есть обычный Fabric, второй вариант только путает'],
    ['1.2.5', 'release', false, 'ниже 1.3 у Legacy Fabric сборок нет'],
    ['b1.7.3', 'old_beta', false, 'бета — это Babric, не Legacy Fabric'],
  ]
  for (const [id, kind, ok, why] of cases) expect(loaderBlock('legacyfabric', id, kind) === null, why).toBe(ok)
  expect(loaderBlock('fabric', '1.8.9', 'release'), 'обычный Fabric на 1.8.9 по-прежнему недоступен').not.toBeNull()
})
