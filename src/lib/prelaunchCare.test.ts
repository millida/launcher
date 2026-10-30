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

// ПК с 4 ГБ: куча молча урезалась до ~1,9 ГБ при любом числе модов. Теперь об этом говорим до запуска.
describe('ramAdvice: сборка тяжелее ПК с 4 ГБ', () => {
  const pc4: RamCheck = { heapMb: 1900, needMb: 4096, fitMb: 1900, totalMb: 3900, availableMb: 2200, mods: 60, manual: false, packOwned: false }

  test('60 модов на 4 ГБ: цифры и ступень «Низкие»', () => {
    expect(ramAdvice(pc4)).toEqual({ kind: 'weak', mods: 60, needGb: 4, haveGb: '1.9', totalGb: 4, preset: 'low' })
  })
  test('больше 80 модов — сразу «Картошка»', () => {
    const a = ramAdvice({ ...pc4, mods: 120, needMb: 6144 })
    expect(a.kind === 'weak' && a.preset).toBe('potato')
  })
  test('ровно 4 ГБ без доли («4,0») пишется без нуля', () => {
    const a = ramAdvice({ ...pc4, heapMb: 2048 })
    expect(a.kind === 'weak' && a.haveGb).toBe('2')
  })
  const quiet: [string, Partial<RamCheck>][] = [
    ['8 ГБ с теми же 60 модами — не наш случай', { totalMb: 7800, fitMb: 3900, heapMb: 3900, needMb: 4096 }],
    ['на 4 ГБ мало модов — ванили хватает', { mods: 10, needMb: 3072 }],
    ['разрыв меньше гигабайта — игра справится', { needMb: 2500 }],
    ['размер памяти ПК неизвестен — не гадаем', { totalMb: 0 }],
  ]
  for (const [why, c] of quiet) test(why, () => expect(ramAdvice({ ...pc4, ...c }).kind).not.toBe('weak'))
  test('память, заданную автором сборки, предупреждение не отменяет: урезается она так же', () => {
    expect(ramAdvice({ ...pc4, packOwned: true }).kind).toBe('weak')
  })
})
