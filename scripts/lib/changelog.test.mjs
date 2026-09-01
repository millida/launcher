import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { notesFor, releaseNotes, unreleasedNotes } from './changelog.mjs'

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const root = resolve(here, '..', '..')

const SAMPLE = `# Изменения

## [Не выпущено]

### Добавлено
- Что-то, что ещё не вышло

## [1.2.0] — 2026-09-10

### Добавлено
- Перенос сборки на другую версию

### Исправлено
- Две версии модпака больше не затирают друг друга

## 1.1.0 - 2026-09-01

- Мелкие правки

## [1.0.0] — 2026-08-31

## [0.9.0] — 2026-08-01

- Первая публичная сборка
`

/// query -> what reaches the launcher window. A section ends at the next
/// version heading: one missed break and the player reads someone else's
/// release.
test('раздел версии не утекает в соседний', () => {
  const notes = notesFor('1.2.0', SAMPLE)
  expect(notes, 'раздел 1.2.0 обязан начинаться со своего содержимого').toContain('Перенос сборки на другую версию')
  expect(notes, 'и содержать все свои подразделы').toContain('Две версии модпака')
  expect(notes, 'соседний релиз в раздел попадать не должен').not.toContain('Мелкие правки')
  expect(notes, 'незавершённый раздел «Не выпущено» тоже чужой').not.toContain('ещё не вышло')
})

test('версии находятся в любой форме заголовка', () => {
  const cases = [
    ['1.1.0', 'Мелкие правки', 'заголовок без скобок с дефисом-разделителем'],
    ['v1.1.0', 'Мелкие правки', 'префикс v в запросе — тот же релиз'],
    ['0.9.0', 'Первая публичная сборка', 'последний раздел файла не обрывается'],
  ]
  for (const [version, needle, why] of cases) {
    expect(notesFor(version, SAMPLE), why).toContain(needle)
  }
})

/// An empty answer means "no changelog": the launcher then shows no window at
/// all, instead of one holding a heading nobody wrote for a player.
test('нет раздела или он пуст — пустая строка, а не заглушка', () => {
  const cases = [
    ['1.0.0', 'раздел есть, но пустой'],
    ['2.0.0', 'такой версии в файле нет'],
    ['', 'версию не передали'],
    ['Не выпущено', 'незавершённый раздел версией не считается'],
  ]
  for (const [version, why] of cases) {
    expect(notesFor(version, SAMPLE), why).toBe('')
  }
})

/// A push to production is versioned 1.0.<run number>, a number that cannot be
/// in the file beforehand, so such a build ships the unreleased section.
/// Without this rule every ordinary release would go out with a commit
/// subject.
test('версия без своего раздела берёт «Не выпущено»', () => {
  expect(releaseNotes('1.0.57', SAMPLE), 'автоверсия обязана получить незавершённый раздел').toContain(
    'ещё не вышло',
  )
  expect(releaseNotes('1.2.0', SAMPLE), 'у версии со своим разделом «Не выпущено» ничего не перебивает').toContain(
    'Перенос сборки на другую версию',
  )
  expect(releaseNotes('1.2.0', SAMPLE), 'и не подмешивается к нему').not.toContain('ещё не вышло')
  expect(releaseNotes('1.0.57', '# Изменения\n'), 'пустой файл — пустые заметки, а не заглушка').toBe('')
})

/// A push to production takes its notes from the unreleased section. Missing
/// or empty, the release goes out with a commit subject and the player never
/// sees the window.
test('в CHANGELOG.md репозитория есть непустой раздел «Не выпущено»', () => {
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  expect(unreleasedNotes(text), 'раздел «Не выпущено» пуст — следующий релиз выйдет без описания').not.toBe('')
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  expect(releaseNotes(version, text), 'сборщик latest.json обязан получить текст, а не пустоту').not.toBe('')
})
