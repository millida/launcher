import { describe, expect, test } from 'bun:test'
import { culpritPattern, exactCrashFix, lineKind, liveLogFix } from './liveLog'

describe('живой лог: какие строки красить', () => {
  const culprit = culpritPattern(['create-1.20.1-6.0.4.jar'])
  const cases: [string, string | null, string][] = [
    ['[main/ERROR]: Mod create requires flywheel 1.0', 'culprit', 'виновный мод по имени — красным, даже в строке ошибки'],
    ['Failed to load create-1.20.1-6.0.4.jar', 'culprit', 'виновный мод по имени файла'],
    ['[Render thread/INFO]: Created: 1024x512 textures-atlas', null, '«Created» — не мод create: имя целым словом'],
    ['[main/ERROR]: Something broke', 'err', 'ошибка без виновного'],
    ['java.lang.NullPointerException: x', 'err', 'исключение'],
    ['\tat net.minecraft.client.Main.main(Main.java:1)', 'err', 'строка стека'],
    ['[main/WARN]: Reference map not found', 'warn', 'предупреждение'],
    ['[main/INFO]: Loading Minecraft', null, 'обычная строка'],
  ]
  for (const [line, want, why] of cases) test(why, () => expect(lineKind(line, culprit)).toBe(want as never))

  test('без виновных красного нет', () => {
    expect(culpritPattern([])).toBeNull()
    expect(lineKind('Mod create requires flywheel', null)).toBeNull()
  })
})

describe('«Починить» — то же исправление, что в окне вылета', () => {
  const share = { kind: 'share-log' }
  const repair = { kind: 'repair' }
  test('точное действие ядра первым', () => {
    expect(liveLogFix([repair, { kind: 'disable-mod', arg: 'x.jar' }, share])?.kind).toBe('disable-mod')
  })
  test('нет точного — план починки модов', () => {
    expect(exactCrashFix([{ kind: 'fix-plan' }, repair])).toBeNull()
    expect(liveLogFix([{ kind: 'fix-plan' }, repair])?.kind).toBe('fix-plan')
  })
  test('чинить нечем — кнопки нет', () => {
    expect(liveLogFix([repair, share])).toBeNull()
  })
})
