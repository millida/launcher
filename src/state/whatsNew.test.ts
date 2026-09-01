import { expect, test } from 'bun:test'
import { hasChangelog } from './whatsNew'

/// notes -> verdict. The window must open only when the release actually says
/// what changed: the pipeline writes a stand-in line for tags without a
/// message, and a window whose only content is that line is noise the player
/// has to close after every update.
test('заглушка релиза не считается списком изменений', () => {
  const cases: [string, boolean][] = [
    ['', false],
    ['   \n  \n', false],
    ['Обновление Millida Launcher 1.2.3', false],
    ['обновление millida launcher 1.2.3', false],
    ['Обновление Millida Launcher 1.2.3\n- Починили вход', true],
    ['- Починили вход по Microsoft', true],
    ['Ускорили запуск', true],
  ]
  for (const [notes, want] of cases) {
    expect(hasChangelog(notes), 'окно «Что нового» для «' + notes + '» должно ' + (want ? 'открыться' : 'молчать')).toBe(
      want,
    )
  }
})
