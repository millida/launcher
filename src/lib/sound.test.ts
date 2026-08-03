import { expect, test } from 'bun:test'
import { soundAllowed } from './sound'
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
