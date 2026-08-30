import { describe, expect, it } from 'bun:test'
import { RAM_MAX_GB, RAM_RESERVE_MIN_GB, RAM_RESERVE_RATIO, maxRamGb } from './ram'

// ОЗУ машины → потолок ползунка. Каждая строка — машина, которая встречается в
// поддержке: смысл таблицы в том, что ни на одной ползунок не даёт пообещать
// игре память, которой в машине нет, но и не отнимает больше четверти.
describe('потолок ручной памяти', () => {
  const cases: [number, number, string][] = [
    [8192, 6, 'на 8 ГБ игре достаётся 6 — четверть остаётся системе'],
    [8071, 6, 'прошивка съела часть планок, но машина всё ещё восьмигигабайтная'],
    [16384, 12, 'на 16 ГБ остаётся 12'],
    [32768, RAM_MAX_GB, 'на 32 ГБ упирается в потолок полезного размера кучи'],
    [6144, 4, 'на 6 ГБ четверти мало — держим нижнюю границу резерва в 2 ГБ'],
    [4096, 2, 'на 4 ГБ системе остаётся половина'],
    [2048, 1, 'на 2 ГБ отдать можно только минимум'],
    [0, RAM_MAX_GB, 'ядро не сказало объём памяти — ползунок остаётся прежним'],
  ]
  for (const [total, want, why] of cases) {
    it(why, () => {
      expect(maxRamGb(total)).toBe(want)
    })
  }

  it('никогда не отдаёт всю память машины', () => {
    for (const total of [2048, 4096, 6144, 8192, 16384, 65536]) {
      const gb = Math.round(total / 1024)
      const reserve = Math.max(RAM_RESERVE_MIN_GB, gb * RAM_RESERVE_RATIO)
      expect(maxRamGb(total)).toBeLessThanOrEqual(Math.max(1, gb - reserve))
    }
  })
})
