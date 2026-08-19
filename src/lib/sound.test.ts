import { expect, test } from 'bun:test'
import { isPrimaryPress, soundAllowed } from './sound'
import type { SoundEvent, SoundMode } from './sound'

const cases: Array<[string, SoundEvent, SoundMode, boolean, boolean]> = [
  ['сообщение друга звучит в режиме по умолчанию', 'notify', 'notify', false, true],
  ['сообщение друга не глохнет из-за только что нажатой кнопки', 'notify', 'notify', true, true],
  ['сообщение друга звучит и в режиме "все звуки"', 'notify', 'all', true, true],
  ['выключенный звук молчит везде', 'notify', 'off', false, false],
  ['клик не звучит в режиме уведомлений', 'click', 'notify', false, false],
  ['клик звучит в режиме "все звуки"', 'click', 'all', false, true],
  ['клик не дублируется собственным жестом', 'click', 'all', true, false],
  ['падение игры считается уведомлением, а не UI', 'crash', 'notify', true, true],
]

for (const [name, ev, mode, gesture, want] of cases) {
  test(name, () => {
    expect(soundAllowed(ev, mode, gesture)).toBe(want)
  })
}

// Кнопки лаунчера работают по нажатию левой кнопкой: остальные не запускают
// действие, поэтому не должны ни звучать, ни рисовать нажатие.
const pressCases: Array<[string, number, boolean, boolean]> = [
  ['левая кнопка нажимает', 0, true, true],
  ['правая кнопка не нажимает', 2, true, false],
  ['средняя кнопка не нажимает', 1, true, false],
  ['кнопка «назад» не нажимает', 3, true, false],
  ['кнопка «вперёд» не нажимает', 4, true, false],
  ['второе касание мультитача не нажимает', 0, false, false],
]

for (const [name, button, isPrimary, want] of pressCases) {
  test(name, () => {
    expect(isPrimaryPress({ button, isPrimary })).toBe(want)
  })
}
