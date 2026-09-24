import { describe, expect, test } from 'bun:test'
import { freshNotes, hasChangelog, notesFingerprints } from './whatsNew'

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

/**
 * Вход → вердикт. Раздел «Не выпущено» копится между выпусками, и окно
 * показывало его целиком: к третьему выпуску за день это простыня из пунктов,
 * которые человек уже читал дважды, а новое в ней теряется.
 */
describe('только непрочитанное', () => {
  const notes = [
    '### Добавлено',
    '- Мод можно выключить',
    '### Исправлено',
    '- Цену больше не закрывает кнопка',
    '- Полоса установки двигается',
  ].join('\n')

  test('в первый раз показывается всё', () => {
    expect(freshNotes(notes, [])).toBe(notes)
  })

  test('прочитанные пункты исчезают вместе с опустевшим заголовком', () => {
    const seen = notesFingerprints(['- Мод можно выключить', '- Полоса установки двигается'].join('\n'))
    expect(freshNotes(notes, seen)).toBe(['### Исправлено', '- Цену больше не закрывает кнопка'].join('\n'))
  })

  test('когда прочитано всё, показывать нечего', () => {
    expect(hasChangelog(freshNotes(notes, notesFingerprints(notes)))).toBe(false)
  })

  test('отступ и регистр не делают пункт новым: иначе правка пробела показала бы его снова', () => {
    const seen = notesFingerprints('-   мод можно ВЫКЛЮЧИТЬ')
    expect(freshNotes('- Мод можно выключить', seen)).toBe('')
  })

  test('заголовки сами по себе непрочитанными не считаются', () => {
    expect(notesFingerprints(notes)).toHaveLength(3)
  })
})
