import { describe, expect, test } from 'bun:test'
import { horizonFits, horizonReason } from './horizon'

describe('a launch error offers the Java start only when Horizon raised it', () => {
  const cases: Array<{ err: unknown; want: string | null; why: string }> = [
    { err: 'horizon: Horizon не нашёл Vulkan', want: 'Horizon не нашёл Vulkan', why: 'the core prefix carries the reason to show' },
    { err: new Error('horizon: Не удалось скачать Horizon: нет связи'), want: 'Не удалось скачать Horizon: нет связи', why: 'a rejected promise keeps the reason' },
    { err: 'Error: horizon: x', want: 'x', why: 'the invoke "Error: " wrapper does not hide the prefix' },
    { err: 'Запуск отменён', want: null, why: 'a cancel is not a Horizon failure' },
    { err: 'Ошибка запуска: java упала', want: null, why: 'a Java game failure must not offer to start on Java' },
    { err: 'horizon: ', want: null, why: 'an empty reason is no reason to ask' },
  ]
  for (const c of cases) test(c.why, () => expect(horizonReason(c.err), c.why).toBe(c.want))
})

describe('the Horizon switch appears only for vanilla 26.3', () => {
  const cases: Array<[string, string, boolean, string]> = [
    ['26.3', 'vanilla', true, 'the one game Horizon runs'],
    ['26.2', 'vanilla', false, 'Horizon prepares only 26.3 resources'],
    ['26.3', 'fabric', false, 'Java mods do not run in Horizon'],
    ['26.3.1', 'vanilla', false, 'a later patch is another game until Horizon pins it'],
  ]
  for (const [version, loader, want, why] of cases) test(why, () => expect(horizonFits(version, loader), why).toBe(want))
})
