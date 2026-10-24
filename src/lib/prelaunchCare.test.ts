import { describe, expect, test } from 'bun:test'
import { ramAdvice } from './prelaunchCare'
import type { RamCheck } from '../ipc/commands'

const base: RamCheck = { heapMb: 6144, needMb: 6144, fitMb: 6144, totalMb: 16384, availableMb: 9000, mods: 120, manual: false, packOwned: false }

describe('ramAdvice: перед запуском большой сборки', () => {
  const cases: [string, Partial<RamCheck>, string][] = [
    ['автоподбор уже дал сколько нужно', {}, 'ok'],
    ['вручную 2 ГБ на 120 модов при доступных 6 — предложить поднять', { manual: true, heapMb: 2048 }, 'raise'],
    ['вручную занижено, но модов мало — ваниле хватает', { manual: true, heapMb: 2048, mods: 5 }, 'ok'],
    ['вручную занижено, но ПК больше не даст', { manual: true, heapMb: 4096, fitMb: 4096 }, 'ok'],
    ['память задал автор сборки', { manual: true, heapMb: 2048, packOwned: true }, 'ok'],
    ['свободно меньше половины кучи — закрыть программы', { availableMb: 2000 }, 'busy'],
  ]
  for (const [why, c, kind] of cases) test(why, () => expect(ramAdvice({ ...base, ...c }).kind).toBe(kind as never))

  test('поднимаем до меньшего из «нужно сборке» и «даст ПК»', () => {
    expect(ramAdvice({ ...base, manual: true, heapMb: 2048, needMb: 8192, fitMb: 6144 })).toEqual({ kind: 'raise', toGb: 6, haveGb: 2 })
  })
})
