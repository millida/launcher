import { describe, expect, it } from 'bun:test'
import { sectionTakeOff, type SectionTakeOff } from './sectionTakeOff'

const BACK = ['WINGS', 'BACK']

describe('что снимает «Снять» в разделе', () => {
  const CASES: [string, Parameters<typeof sectionTakeOff>, SectionTakeOff | null, string][] = [
    [
      'плащи: надета только плащ-вещь',
      ['cape', [], [{ slot: 'CAPE' }], false],
      { slots: ['CAPE'], accountCape: false },
      'жалоба 25.09.2026: «Плащ полевых цветов» надет, а кнопки нет или она его не снимает',
    ],
    [
      'плащи: плащ аккаунта и плащ-вещь',
      ['cape', [], [{ slot: 'CAPE' }, { slot: 'WINGS' }], true],
      { slots: ['CAPE'], accountCape: true },
      'снимался только плащ аккаунта, вещь оставалась «Надето»',
    ],
    [
      'плащи: только плащ аккаунта',
      ['cape', [], [], true],
      { slots: ['CAPE'], accountCape: true },
      'прежний случай работает как раньше',
    ],
    [
      'плащи: ничего не надето',
      ['cape', [], [{ slot: 'WINGS' }], false],
      null,
      'крылья - не плащ: кнопки в плащах нет',
    ],
    [
      'спина: надеты крылья',
      ['back', BACK, [{ slot: 'WINGS' }], true],
      { slots: BACK, accountCape: false },
      'в чужом разделе плащ аккаунта не трогается',
    ],
    [
      'спина: надета только плащ-вещь',
      ['back', BACK, [{ slot: 'CAPE' }], false],
      null,
      'плащ-вещь живёт в разделе плащей, а не спины',
    ],
    ['скины', ['skin', [], [{ slot: 'HAT' }], true], null, 'в скинах снимать нечего'],
  ]

  for (const [name, input, wanted, why] of CASES) {
    it(`${name}: ${why}`, () => {
      expect(sectionTakeOff(...input), `${name}: «Снять» решил не то`).toEqual(wanted)
    })
  }
})
