import { expect, test } from 'bun:test'
import { joinPlan, type JoinPlan } from './joinPlan'

const BUILDS = [
  { name: 'HiTech', version: '26.2' },
  { name: 'Ваниль', version: '1.21.4' },
  { name: 'Старьё', version: '1.16.5' },
]

// builds x selected x server versions -> verdict. Каждый случай закреплён потому,
// что молчаливый запуск текущей сборки — это «Outdated client» на сервере друга
// без единой подсказки, что делать.
const CASES: [typeof BUILDS, string, string[], JoinPlan, string][] = [
  [
    BUILDS,
    'HiTech',
    [],
    { kind: 'unknown', build: 'HiTech', version: '26.2' },
    'сервер не сказал версию — спрашиваем, а не запускаем выбранное молча',
  ],
  [
    BUILDS,
    'Ваниль',
    ['1.21'],
    { kind: 'launch', build: 'Ваниль' },
    'выбранная сборка подходит — вопросов нет',
  ],
  [
    BUILDS,
    'HiTech',
    ['1.21'],
    { kind: 'switch', build: 'Ваниль', version: '1.21.4' },
    'подходящая сборка есть — переключаемся сами',
  ],
  [
    BUILDS,
    'HiTech',
    ['1.7.10'],
    { kind: 'mismatch', build: 'HiTech', version: '26.2' },
    'под версию сервера сборки нет — предлагаем создать',
  ],
  [
    [],
    '',
    ['1.20.1'],
    { kind: 'create', version: '1.20.1' },
    'сборок нет вовсе — сразу создание под версию сервера',
  ],
  [
    [],
    '',
    [],
    { kind: 'create', version: '' },
    'ни сборок, ни версии — создание без предзаполнения',
  ],
  [
    BUILDS,
    'Удалённая',
    ['1.21'],
    { kind: 'switch', build: 'Ваниль', version: '1.21.4' },
    'выбранной сборки уже нет — решение считается от первой',
  ],
]

test('решение о сборке для входа на сервер', () => {
  for (const [builds, selected, wanted, want, why] of CASES) {
    expect(joinPlan(builds, selected, wanted), why).toEqual(want)
  }
})
