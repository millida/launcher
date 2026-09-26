import { describe, expect, test } from 'bun:test'
import { PL_STAGES, REPAIR_STAGES, playButtonState, prelaunchPct, prelaunchStageName } from './launchView'
import type { PlayButtonInput, PlayButtonState } from './launchView'

const idle = { open: false, stage: 0, pct: 0, mode: 'launch' as const }
const busy = { open: true, stage: 2, pct: 81.6, mode: 'launch' as const }

describe('playButtonState — что показывает большая кнопка лобби', () => {
  const cases: Array<[string, PlayButtonInput, PlayButtonState]> = [
    ['ничего не выбрано — «Играть» ведёт в каталог', { modeKind: null, selected: null, running: [], prelaunch: idle }, { kind: 'play' }],
    ['выбранная сборка не запущена — «Играть»', { modeKind: 'build', selected: 'A', running: [], prelaunch: idle }, { kind: 'play' }],
    [
      'выбранная сборка запущена — кнопка останавливает её, вторая копия испортила бы миры',
      { modeKind: 'build', selected: 'A', running: ['A'], prelaunch: idle },
      { kind: 'stop', profile: 'A' },
    ],
    [
      'запущена другая сборка — выбранную можно запустить рядом, окно спросит',
      { modeKind: 'build', selected: 'A', running: ['B'], prelaunch: idle },
      { kind: 'play' },
    ],
    [
      'сервер или версия: игра, запущенная из лобби, останавливается той же кнопкой — иначе остановить её с лобби нечем',
      { modeKind: 'server', selected: null, running: ['B', 'C'], prelaunch: idle },
      { kind: 'stop', profile: 'C' },
    ],
    [
      'идёт подготовка — прогресс со стадией, число округлено',
      { modeKind: 'build', selected: 'A', running: [], prelaunch: busy },
      { kind: 'installing', stage: 'Ассеты и библиотеки', pct: 82 },
    ],
    [
      'процесс уже появился, а прогресс ещё открыт — кнопка не превращается в «Остановить» под курсором',
      { modeKind: 'build', selected: 'A', running: ['A'], prelaunch: { ...busy, pct: 100, stage: 4 } },
      { kind: 'installing', stage: 'Запуск игры', pct: 100 },
    ],
  ]
  for (const [why, input, want] of cases) {
    test(why, () => {
      expect(playButtonState(input), why).toEqual(want)
    })
  }
})

describe('prelaunchStageName и prelaunchPct — подпись и число в тосте и на кнопке', () => {
  test('починка называет свои стадии, а не стадии запуска', () => {
    expect(prelaunchStageName({ stage: 3, mode: 'repair' })).toBe(REPAIR_STAGES[3]!)
    expect(prelaunchStageName({ stage: 3, mode: 'launch' })).toBe(PL_STAGES[3]!)
  })
  test('стадия за краем списка не оставляет пустую подпись', () => {
    expect(prelaunchStageName({ stage: 99, mode: 'launch' })).toBe(PL_STAGES[PL_STAGES.length - 1]!)
    expect(prelaunchStageName({ stage: -1, mode: 'launch' })).toBe(PL_STAGES[0]!)
    expect(prelaunchStageName({ stage: Number.NaN, mode: 'launch' })).toBe(PL_STAGES[0]!)
  })
  const pcts: Array<[number, number, string]> = [
    [81.6, 82, 'округление'],
    [-5, 0, 'ядро прислало отрицательное — полоса не уходит влево'],
    [140, 100, 'больше ста — полоса не вылезает за тост'],
    [Number.NaN, 0, 'NaN не превращается в «NaN%»'],
  ]
  for (const [raw, want, why] of pcts) test(why, () => expect(prelaunchPct(raw), why).toBe(want))
})
