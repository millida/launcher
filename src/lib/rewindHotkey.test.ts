import { expect, test } from 'bun:test'
import { hotkeyFromEvent } from './rewindHotkey'

const press = (code: string, mods: { alt?: boolean; ctrl?: boolean; shift?: boolean } = {}) =>
  hotkeyFromEvent({ code, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift })

// The core accepts only letters and digits between pluses and falls back to
// Alt+F10 otherwise, so the shape of the string is pinned here.
const cases: Array<[string | null, string | null, string]> = [
  [press('F10', { alt: true }), 'Alt+F10', 'сочетание по умолчанию'],
  [press('KeyR', { ctrl: true, shift: true }), 'Ctrl+Shift+R', 'буква без префикса Key'],
  [press('Digit5', { alt: true }), 'Alt+5', 'цифра без префикса Digit'],
  [press('F10'), null, 'без модификатора клавиша ловилась бы в чате'],
  [press('AltLeft', { alt: true }), null, 'один модификатор ещё не сочетание'],
  [press('Semicolon', { ctrl: true }), null, 'знаки ядро не примет'],
]

for (const [got, want, why] of cases) {
  test(why, () => expect(got).toBe(want))
}
